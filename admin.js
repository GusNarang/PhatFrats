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
  const CHAPTERS = require('./public/chapters.js');
  const chapterIds = new Set(CHAPTERS.map((c) => c.id));
  const chapterParam = (req) => (chapterIds.has(Number(req.params.id)) ? Number(req.params.id) : null);

  app.get('/api/admin/chapters', requireAdmin, wrap(async (req, res) => {
    const [accts, members, parties] = await Promise.all([
      pool.query('SELECT chapter_id, updated_at FROM chapter_accounts'),
      pool.query(`SELECT m.chapter_id, m.role, u.name, u.email FROM chapter_members m JOIN users u ON u.id = m.user_id ORDER BY u.name`),
      pool.query(`SELECT chapter_id, count(*) FILTER (WHERE status = 'live' AND party_date >= ${TODAY_SQL})::int AS upcoming, count(*)::int AS total
                  FROM hosted_parties GROUP BY chapter_id`),
    ]);
    const acct = new Map(accts.rows.map((r) => [r.chapter_id, r.updated_at]));
    const partyCounts = new Map(parties.rows.map((r) => [r.chapter_id, r]));
    res.json({
      chapters: CHAPTERS.map((c) => {
        const mine = members.rows.filter((m) => m.chapter_id === c.id);
        return {
          id: c.id, name: c.name, gl: c.gl,
          ready: acct.has(c.id), passwordSet: acct.get(c.id) || null,
          members: mine.length,
          leaders: mine.filter((m) => m.role === 'leader').map((m) => ({ name: m.name, email: m.email })),
          upcoming: partyCounts.get(c.id)?.upcoming || 0,
          parties: partyCounts.get(c.id)?.total || 0,
        };
      }),
    });
  }));

  // Sets or replaces a chapter's join password. Setting one is what switches the chapter on.
  app.post('/api/admin/chapters/:id/password', requireAdmin, wrap(async (req, res) => {
    const id = chapterParam(req);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!id) return fail(res, 400, 'That chapter is not on the list.');
    if (password.length < 8 || password.length > 200) return fail(res, 400, 'Use a chapter password with at least 8 characters.');
    await pool.query(
      `INSERT INTO chapter_accounts (chapter_id, password_hash) VALUES ($1, $2)
       ON CONFLICT (chapter_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
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

