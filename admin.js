// The control room's API. Every route here is for accounts with role 'admin' only.
// To anyone else these routes look like they don't exist.

// Dollars per million tokens, from Anthropic's price list. Add a row if PhatBot moves to another model.
const AI_PRICES = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
};
// Stripe's standard card fee, used to estimate what each sale leaves you once payments are connected.
const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED = 0.30;
// The prepaid Anthropic credit, so the page can show how much is left. Change it in Vercel with AI_CREDIT_DOLLARS.
const AI_CREDIT = Number(process.env.AI_CREDIT_DOLLARS) || 5;
const DAYS = 30;
const PARTY_TITLES = new Map(require('./data/parties.js').map((p) => [p.id, p.title]));
const partyList = require('./party-list.js');

// Entering the admin password opens the control room for one visit. Leaving it, or opening the main
// site, locks it again. This limit only matters if the tab is left open or the lock message gets lost.
const UNLOCK_MINUTES = 120;

module.exports = function adminRoutes(app, { pool, wrap, fail, requireUser, PRICING, phatbot, TODAY_SQL, authLimiter, hashPassword, verifyPassword, hashToken, readSessionToken }) {
  // Being an admin isn't enough on its own: this login must also have been unlocked with the admin password.
  const requireAdmin = [requireUser, (req, res, next) => {
    if (req.user.role !== 'admin' || !req.user.admin_unlocked) return fail(res, 404, 'Not found.');
    res.set('Cache-Control', 'no-store');
    next();
  }];

  app.post('/api/admin/unlock', authLimiter, requireUser, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.user.role !== 'admin') return fail(res, 404, 'Not found.');
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    const { rows: [u] } = await pool.query('SELECT admin_password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = !!u?.admin_password_hash && password && (await verifyPassword(password, u.admin_password_hash));
    if (!ok) return fail(res, 401, "That password isn't right.", 'BAD_ADMIN_PASSWORD');
    await pool.query(
      `UPDATE sessions SET admin_until = now() + make_interval(mins => $2) WHERE token_hash = $1`,
      [hashToken(readSessionToken(req)), UNLOCK_MINUTES]
    );
    res.json({ ok: true });
  }));

  app.post('/api/admin/lock', requireUser, wrap(async (req, res) => {
    await pool.query('UPDATE sessions SET admin_until = NULL WHERE token_hash = $1', [hashToken(readSessionToken(req))]);
    res.json({ ok: true });
  }));

  const aiCost = (t) => {
    const p = AI_PRICES[phatbot.MODEL];
    if (!p) return null;
    return (Number(t.input) * p.input + Number(t.output) * p.output +
      Number(t.cache_read) * p.cacheRead + Number(t.cache_write) * p.cacheWrite) / 1e6;
  };

  app.get('/api/admin/overview', requireAdmin, wrap(async (req, res) => {
    const [accounts, visits, series, invites, topParties, chat] = await Promise.all([
      pool.query(`SELECT
          count(*)                                                        AS total,
          count(*) FILTER (WHERE email_verified_at IS NOT NULL)           AS verified,
          count(*) FILTER (WHERE plan = 'full')                           AS full,
          count(*) FILTER (WHERE plan = 'full' AND role <> 'admin')       AS paying,
          count(*) FILTER (WHERE banned_at IS NOT NULL)                   AS banned,
          count(*) FILTER (WHERE created_at >= now() - interval '1 day')  AS new_1d,
          count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS new_7d,
          count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS new_30d
        FROM users`),
      pool.query(`SELECT
          count(DISTINCT visitor) FILTER (WHERE day = ${TODAY_SQL})                 AS today,
          count(DISTINCT visitor) FILTER (WHERE day > ${TODAY_SQL} - 7)             AS week,
          count(DISTINCT visitor) FILTER (WHERE day > ${TODAY_SQL} - 30)            AS month,
          coalesce(sum(views) FILTER (WHERE day > ${TODAY_SQL} - 30), 0)            AS views_month
        FROM site_visits`),
      pool.query(`WITH days AS (SELECT generate_series(${TODAY_SQL} - ${DAYS - 1}, ${TODAY_SQL}, interval '1 day')::date AS day)
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
          (SELECT count(*) FROM site_visits v WHERE v.day = d.day)                                   AS visitors,
          (SELECT coalesce(sum(views), 0) FROM site_visits v WHERE v.day = d.day)                    AS views,
          (SELECT count(*) FROM users u WHERE (u.created_at AT TIME ZONE 'America/New_York')::date = d.day) AS signups,
          (SELECT count(*) FROM invite_requests r WHERE (r.created_at AT TIME ZONE 'America/New_York')::date = d.day) AS invites,
          (SELECT coalesce(sum(messages), 0) FROM chat_usage c WHERE c.day = d.day)                  AS chats
        FROM days d ORDER BY d.day`),
      pool.query(`SELECT count(*) AS total,
          count(*) FILTER (WHERE status = 'approved') AS approved,
          count(*) FILTER (WHERE status = 'waitlist') AS waitlist,
          count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS week
        FROM invite_requests`),
      pool.query(`SELECT r.party_id, count(*) AS requests, (SELECT hp.title FROM hosted_parties hp WHERE 'h' || hp.id = r.party_id) AS hosted_title
                  FROM invite_requests r GROUP BY r.party_id ORDER BY requests DESC, r.party_id LIMIT 6`),
      pool.query(`SELECT coalesce(sum(messages), 0) AS messages,
          coalesce(sum(messages) FILTER (WHERE day = ${TODAY_SQL}), 0) AS today,
          coalesce(sum(input_tokens), 0) AS input, coalesce(sum(output_tokens), 0) AS output,
          coalesce(sum(cache_read_tokens), 0) AS cache_read, coalesce(sum(cache_write_tokens), 0) AS cache_write,
          coalesce(sum(input_tokens) FILTER (WHERE day > ${TODAY_SQL} - 30), 0) AS m_input,
          coalesce(sum(output_tokens) FILTER (WHERE day > ${TODAY_SQL} - 30), 0) AS m_output,
          coalesce(sum(cache_read_tokens) FILTER (WHERE day > ${TODAY_SQL} - 30), 0) AS m_cache_read,
          coalesce(sum(cache_write_tokens) FILTER (WHERE day > ${TODAY_SQL} - 30), 0) AS m_cache_write,
          count(DISTINCT user_id) AS people
        FROM chat_usage`),
    ]);

    const a = accounts.rows[0];
    const c = chat.rows[0];
    const num = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
    const paying = Number(a.paying);
    const gross = paying * PRICING.price;
    const fees = paying * (PRICING.price * STRIPE_PERCENT + STRIPE_FIXED);
    const aiAll = aiCost(c);
    const aiMonth = aiCost({ input: c.m_input, output: c.m_output, cache_read: c.m_cache_read, cache_write: c.m_cache_write });

    res.json({
      generatedAt: new Date().toISOString(),
      accounts: num(a),
      visits: num(visits.rows[0]),
      series: series.rows.map((r) => ({ day: r.day, ...num({ visitors: r.visitors, views: r.views, signups: r.signups, invites: r.invites, chats: r.chats }) })),
      invites: num(invites.rows[0]),
      topParties: topParties.rows.map((r) => ({ id: r.party_id, title: r.hosted_title || PARTY_TITLES.get(r.party_id) || r.party_id, requests: Number(r.requests) })),
      chat: { messages: Number(c.messages), today: Number(c.today), people: Number(c.people), model: phatbot.MODEL, enabled: phatbot.isEnabled() },
      money: {
        connected: false,
        price: PRICING.price,
        term: PRICING.term,
        paying,
        gross,
        fees,
        aiAll,
        aiMonth,
        aiCredit: AI_CREDIT,
        net: aiAll == null ? null : gross - fees - aiAll,
      },
    });
  }));

  app.get('/api/admin/users', requireAdmin, wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT u.id, u.name, u.email, u.plan, u.role, u.created_at, u.email_verified_at,
        u.banned_at, u.ban_reason, u.plan_paid_at,
        (SELECT count(*) FROM invite_requests r WHERE r.user_id = u.id) AS invites,
        (SELECT coalesce(sum(messages), 0) FROM chat_usage c WHERE c.user_id = u.id) AS chats,
        (SELECT max(created_at) FROM sessions s WHERE s.user_id = u.id) AS last_login
      FROM users u ORDER BY u.created_at DESC LIMIT 2000`);
    res.json({
      users: rows.map((u) => ({
        id: String(u.id),
        name: u.name,
        email: u.email,
        plan: u.plan,
        admin: u.role === 'admin',
        joined: u.created_at,
        verified: !!u.email_verified_at,
        banned: !!u.banned_at,
        bannedAt: u.banned_at,
        banReason: u.ban_reason || '',
        paidAt: u.plan_paid_at,
        invites: Number(u.invites),
        chats: Number(u.chats),
        lastLogin: u.last_login,
      })),
    });
  }));

  const targetId = (req) => (/^\d{1,18}$/.test(req.params.id) ? req.params.id : null);

  app.post('/api/admin/users/:id/ban', requireAdmin, wrap(async (req, res) => {
    const id = targetId(req);
    if (!id) return fail(res, 400, 'That account id is not valid.');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE users SET banned_at = now(), ban_reason = $2 WHERE id = $1 AND role <> 'admin' AND banned_at IS NULL RETURNING id`,
        [id, reason]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return fail(res, 400, "That account can't be banned. It may be an admin, already banned, or gone.");
      }
      // Logs them out everywhere, right now.
      await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      // Anyone they vouched for comes off the list too.
      await client.query('DELETE FROM outside_guests WHERE sponsor_id = $1', [id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }));

  app.post('/api/admin/users/:id/unban', requireAdmin, wrap(async (req, res) => {
    const id = targetId(req);
    if (!id) return fail(res, 400, 'That account id is not valid.');
    const { rowCount } = await pool.query('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = $1 AND banned_at IS NOT NULL', [id]);
    if (!rowCount) return fail(res, 400, "That account isn't banned.");
    res.json({ ok: true });
  }));

  // Until Stripe is connected, this is how Full Access gets switched on or off by hand.
  app.post('/api/admin/users/:id/plan', requireAdmin, wrap(async (req, res) => {
    const id = targetId(req);
    const plan = req.body?.plan;
    if (!id || (plan !== 'full' && plan !== 'free')) return fail(res, 400, 'Choose free or full.');
    const { rowCount } = await pool.query(
      `UPDATE users SET plan = $2, plan_paid_at = CASE WHEN $2 = 'full' THEN now() ELSE NULL END WHERE id = $1`,
      [id, plan]
    );
    if (!rowCount) return fail(res, 404, 'That account is gone.');
    res.json({ ok: true });
  }));

  // ---------- chapters (the frat portal) ----------
  const CHAPTERS = [...require('./public/chapters.js'), ...require('./data/test-chapters.js')];
  const chapterIds = new Set(CHAPTERS.map((c) => c.id));
  const chapterParam = (req) => (chapterIds.has(Number(req.params.id)) ? Number(req.params.id) : null);

  // Everything for the control room's Frats page: every chapter with its numbers, the totals,
  // a 30-day trend, the upcoming parties and the brothers sending the most invites.
  // Practice chapters are listed but left out of the totals, the trend and the leaderboard.
  app.get('/api/admin/frats', requireAdmin, wrap(async (req, res) => {
    const testIds = CHAPTERS.filter((c) => c.test).map((c) => c.id);
    const testIdSet = new Set(testIds);
    const [accts, members, parties, requests, invites, upcoming, series, brothers] = await Promise.all([
      pool.query('SELECT chapter_id, updated_at, password_hash IS NOT NULL AS brother, leader_password_hash IS NOT NULL AS leader FROM chapter_accounts'),
      pool.query(`SELECT m.chapter_id, m.role, m.joined_at, u.name, u.email FROM chapter_members m JOIN users u ON u.id = m.user_id
                  WHERE u.banned_at IS NULL ORDER BY u.name`),
      pool.query(`SELECT chapter_id,
                    count(*) FILTER (WHERE status = 'live' AND party_date >= ${TODAY_SQL})::int AS upcoming,
                    count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
                    count(*)::int AS total, max(created_at) AS last_posted
                  FROM hosted_parties GROUP BY chapter_id`),
      pool.query(`SELECT hp.chapter_id,
                    count(*) FILTER (WHERE r.status = 'pending')::int AS pending,
                    count(*) FILTER (WHERE r.status = 'approved')::int AS approved,
                    count(*) FILTER (WHERE r.status = 'waitlist')::int AS waitlist,
                    count(*) FILTER (WHERE u.plan = 'full')::int AS full
                  FROM invite_requests r JOIN hosted_parties hp ON 'h' || hp.id = r.party_id JOIN users u ON u.id = r.user_id
                  WHERE r.invited_by IS NULL GROUP BY hp.chapter_id`),
      pool.query(`SELECT hp.chapter_id, count(*)::int AS sent,
                    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM users u WHERE u.email = b.email))::int AS claimed
                  FROM brother_invites b JOIN hosted_parties hp ON hp.id = b.party_id GROUP BY hp.chapter_id`),
      pool.query(`SELECT hp.id, hp.chapter_id, hp.title, to_char(hp.party_date, 'YYYY-MM-DD') AS day, hp.start_time, hp.vibe, hp.cap, hp.status,
                    hp.created_at, creator.name AS created_by, ${partyList.GOING_SQL} AS going,
                    (SELECT count(*) FROM invite_requests r WHERE r.party_id = 'h' || hp.id AND r.invited_by IS NULL AND r.status = 'pending')::int AS pending,
                    (SELECT count(*) FROM invite_requests r WHERE r.party_id = 'h' || hp.id AND r.invited_by IS NULL)::int AS requests,
                    (SELECT count(*) FROM brother_invites b WHERE b.party_id = hp.id)::int AS invites,
                    hp.allow_outside_guests,
                    (SELECT count(*) FROM outside_guests g WHERE g.party_id = hp.id AND g.status = 'approved')::int AS outside,
                    (SELECT count(*) FROM outside_guests g WHERE g.party_id = hp.id AND g.status = 'pending')::int AS outside_pending
                  FROM hosted_parties hp LEFT JOIN users creator ON creator.id = hp.created_by
                  WHERE hp.party_date >= ${TODAY_SQL} ORDER BY hp.party_date, hp.start_time, hp.id`),
      pool.query(`WITH days AS (SELECT generate_series(${TODAY_SQL} - ${DAYS - 1}, ${TODAY_SQL}, interval '1 day')::date AS day)
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
          (SELECT count(*) FROM hosted_parties hp WHERE (hp.created_at AT TIME ZONE 'America/New_York')::date = d.day
             AND hp.chapter_id <> ALL($1::int[]))::int AS parties,
          (SELECT count(*) FROM invite_requests r JOIN hosted_parties hp ON 'h' || hp.id = r.party_id
             WHERE r.invited_by IS NULL AND (r.created_at AT TIME ZONE 'America/New_York')::date = d.day AND hp.chapter_id <> ALL($1::int[]))::int AS requests,
          (SELECT count(*) FROM brother_invites b JOIN hosted_parties hp ON hp.id = b.party_id
             WHERE (b.created_at AT TIME ZONE 'America/New_York')::date = d.day AND hp.chapter_id <> ALL($1::int[]))::int AS invites,
          (SELECT count(*) FROM chapter_members m WHERE (m.joined_at AT TIME ZONE 'America/New_York')::date = d.day
             AND m.chapter_id <> ALL($1::int[]))::int AS brothers
        FROM days d ORDER BY d.day`, [testIds]),
      pool.query(`SELECT u.name, u.email, m.chapter_id, m.role, count(b.id)::int AS invites,
                    count(b.id) FILTER (WHERE EXISTS (SELECT 1 FROM users x WHERE x.email = b.email))::int AS claimed
                  FROM brother_invites b JOIN users u ON u.id = b.invited_by JOIN chapter_members m ON m.user_id = u.id
                  WHERE m.chapter_id <> ALL($1::int[])
                  GROUP BY u.id, u.name, u.email, m.chapter_id, m.role ORDER BY invites DESC, u.name LIMIT 10`, [testIds]),
    ]);

    const byChapter = (rows) => new Map(rows.map((r) => [r.chapter_id, r]));
    const acct = byChapter(accts.rows), pc = byChapter(parties.rows), rq = byChapter(requests.rows), iv = byChapter(invites.rows);
    const up = upcoming.rows.map((p) => ({
      id: 'h' + p.id, ch: p.chapter_id, title: p.title, day: p.day, time: p.start_time, vibe: p.vibe, cap: p.cap,
      status: p.status, going: Math.min(p.going, p.cap), pending: p.pending, requests: p.requests, invites: p.invites,
      createdBy: p.created_by || 'A former leader', posted: p.created_at,
      allowGuests: p.allow_outside_guests, outside: p.outside, outsidePending: p.outside_pending,
    }));
    const chapters = CHAPTERS.map((c) => {
      const mine = members.rows.filter((m) => m.chapter_id === c.id);
      const live = up.filter((p) => p.ch === c.id && p.status === 'live');
      const cap = live.reduce((s, p) => s + p.cap, 0);
      return {
        id: c.id, name: c.name, gl: c.gl, test: !!c.test,
        ready: !!acct.get(c.id)?.brother, leaderReady: !!acct.get(c.id)?.leader, passwordSet: acct.get(c.id)?.updated_at || null,
        members: mine.length,
        leaders: mine.filter((m) => m.role === 'leader').map((m) => ({ name: m.name, email: m.email })),
        upcoming: pc.get(c.id)?.upcoming || 0,
        parties: pc.get(c.id)?.total || 0,
        cancelled: pc.get(c.id)?.cancelled || 0,
        lastPosted: pc.get(c.id)?.last_posted || null,
        pending: rq.get(c.id)?.pending || 0,
        approved: rq.get(c.id)?.approved || 0,
        waitlist: rq.get(c.id)?.waitlist || 0,
        fullRequests: rq.get(c.id)?.full || 0,
        invitesSent: iv.get(c.id)?.sent || 0,
        invitesClaimed: iv.get(c.id)?.claimed || 0,
        // How full this chapter's upcoming parties are, from 0 to 1.
        fill: cap ? live.reduce((s, p) => s + p.going, 0) / cap : null,
      };
    });

    const real = chapters.filter((c) => !c.test);
    const sum = (k) => real.reduce((s, c) => s + c[k], 0);
    const answered = sum('approved') + sum('waitlist');
    res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        chapters: real.length,
        live: real.filter((c) => c.ready || c.leaderReady).length,
        withLeader: real.filter((c) => c.leaders.length).length,
        brothers: sum('members'),
        leaders: real.reduce((s, c) => s + c.leaders.length, 0),
        upcoming: sum('upcoming'),
        parties: sum('parties'),
        cancelled: sum('cancelled'),
        pending: sum('pending'),
        approved: sum('approved'),
        waitlist: sum('waitlist'),
        requests: sum('pending') + answered,
        approvalRate: answered ? sum('approved') / answered : null,
        invitesSent: sum('invitesSent'),
        invitesClaimed: sum('invitesClaimed'),
        outsideGuests: up.filter((p) => !testIdSet.has(p.ch)).reduce((s, p) => s + p.outside, 0),
        outsidePending: up.filter((p) => !testIdSet.has(p.ch)).reduce((s, p) => s + p.outsidePending, 0),
        partiesWithGuests: up.filter((p) => !testIdSet.has(p.ch) && p.status === 'live' && p.allowGuests).length,
      },
      series: series.rows,
      chapters,
      upcoming: up,
      topBrothers: brothers.rows.map((b) => ({
        name: b.name, email: b.email, chapter: CHAPTERS.find((c) => c.id === b.chapter_id)?.name || '', leader: b.role === 'leader',
        invites: b.invites, claimed: b.claimed,
      })),
    });
  }));

  // Takes a chapter's party off the map, or puts it back, if something about it isn't right.
  app.post('/api/admin/parties/:id/status', requireAdmin, wrap(async (req, res) => {
    const id = partyList.isHostedId(req.params.id) ? req.params.id.slice(1) : null;
    const status = req.body?.status;
    if (!id || (status !== 'live' && status !== 'cancelled')) return fail(res, 400, 'Choose live or cancelled.');
    const { rowCount } = await pool.query('UPDATE hosted_parties SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
    if (!rowCount) return fail(res, 404, 'That party is gone.');
    res.json({ ok: true });
  }));

  // Sets or replaces a chapter's brother (join) password, or with kind 'leader', its leader sign-in password.
  app.post('/api/admin/chapters/:id/password', requireAdmin, wrap(async (req, res) => {
    const id = chapterParam(req);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const column = req.body?.kind === 'leader' ? 'leader_password_hash' : 'password_hash';
    if (!id) return fail(res, 400, 'That chapter is not on the list.');
    if (password.length < 8 || password.length > 200) return fail(res, 400, 'Use a password with at least 8 characters.');
    await pool.query(
      `INSERT INTO chapter_accounts (chapter_id, ${column}) VALUES ($1, $2)
       ON CONFLICT (chapter_id) DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = now()`,
      [id, await hashPassword(password)]
    );
    res.json({ ok: true });
  }));

  // Makes an existing PhatFrats account a leader of this chapter, moving them from any other chapter.
  app.post('/api/admin/chapters/:id/leader', requireAdmin, wrap(async (req, res) => {
    const id = chapterParam(req);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!id) return fail(res, 400, 'That chapter is not on the list.');
    const { rows: [u] } = await pool.query('SELECT id, email_verified_at, banned_at FROM users WHERE email = $1', [email]);
    if (!u) return fail(res, 404, "No PhatFrats account uses that email. They need to sign up first.");
    if (!u.email_verified_at) return fail(res, 400, "That account hasn't confirmed its email yet.");
    if (u.banned_at) return fail(res, 400, 'That account is banned.');
    await pool.query(
      `INSERT INTO chapter_members (user_id, chapter_id, role) VALUES ($1, $2, 'leader')
       ON CONFLICT (user_id) DO UPDATE SET chapter_id = EXCLUDED.chapter_id, role = 'leader',
         joined_at = CASE WHEN chapter_members.chapter_id = EXCLUDED.chapter_id THEN chapter_members.joined_at ELSE now() END`,
      [u.id, id]
    );
    res.json({ ok: true });
  }));
};

