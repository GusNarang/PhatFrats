// The control room's extra powers: live radar, beacon, lockdown, spotlight, money cave, promo codes, gifts,
// Hall of Fame, Night Forecast, growth, global search, the admin log and Door Rush god mode.
const PRICING = require('./public/pricing.js');
const partyList = require('./party-list.js');
const { FULL_SQL } = require('./plan-sql.js');
const TEST_IDS = require('./data/test-chapters.js').map((c) => c.id);
const ZONE = 'America/New_York';
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date());

module.exports = function adminExtras(app, { pool, wrap, fail, requireUser, ops, CHAPTERS, TODAY_SQL, WEEK_START_SQL }) {
  const requireAdmin = [requireUser, (req, res, next) => {
    if (req.user.role !== 'admin' || !req.user.admin_unlocked) return fail(res, 404, 'Not found.');
    res.set('Cache-Control', 'no-store');
    next();
  }];
  const chapterName = (id) => CHAPTERS.find((c) => c.id === Number(id))?.name || '';
  const shortName = (name) => {
    const parts = String(name || '').trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
  };
  const demoTitle = (id) => partyList.DEMO_BY_ID.get(id)?.title;
  async function partyTitle(id) {
    if (demoTitle(id)) return demoTitle(id);
    if (!partyList.isHostedId(id)) return id;
    const { rows: [p] } = await pool.query('SELECT title, chapter_id FROM hosted_parties WHERE id = $1', [id.slice(1)]);
    return p ? `${p.title} (${chapterName(p.chapter_id)})` : id;
  }
  // When the Door Rush week started: Monday midnight, or later if the admin reset the board.
  async function boardStart() {
    const s = await ops.settings();
    const { rows: [r] } = await pool.query(`SELECT GREATEST(${WEEK_START_SQL}, coalesce($1::timestamptz, '-infinity')) AS t`, [s.game_reset_at || null]);
    return r.t;
  }

  // ---------- public: the beacon banner and the presence ping ----------
  app.get('/api/beacon', wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { rows: [a] } = await pool.query(
      `SELECT id, text, tone, audience FROM announcements WHERE active AND (ends_at IS NULL OR ends_at > now()) ORDER BY id DESC LIMIT 1`
    );
    if (!a) return res.json({ beacon: null });
    if (a.audience !== 'all') {
      const token = (req.headers.cookie || '').match(/(?:^|;\s*)pf_session=([^;]+)/);
      let who = null;
      if (token) {
        const { rows: [u] } = await pool.query(
          `SELECT CASE WHEN ${FULL_SQL('u.')} THEN 'full' ELSE 'free' END AS plan,
             EXISTS (SELECT 1 FROM chapter_members m WHERE m.user_id = u.id AND m.role = 'leader') AS leader
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex') AND s.expires_at > now() AND u.banned_at IS NULL`,
          [(() => { try { return decodeURIComponent(token[1]); } catch (e) { return ''; } })()]
        );
        who = u || null;
      }
      const fits = who && ((a.audience === 'free' && who.plan !== 'full') || (a.audience === 'full' && who.plan === 'full') || (a.audience === 'leaders' && who.leader));
      if (!fits) return res.json({ beacon: null });
    }
    res.json({ beacon: { id: a.id, text: a.text, tone: a.tone } });
  }));

  // ---------- Live: radar, ticker, beacon, lockdown, spotlight ----------
  app.get('/api/admin/live', requireAdmin, wrap(async (req, res) => {
    const s = await ops.settings();
    const [online, looking, feed, beacon] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE path LIKE '/game%')::int AS gaming,
                    count(*) FILTER (WHERE path LIKE '/frats%')::int AS frats FROM site_presence WHERE last_seen > now() - interval '2 minutes'`),
      pool.query(`SELECT looking_at, count(*)::int AS n FROM site_presence
                  WHERE last_seen > now() - interval '3 minutes' AND looking_at IS NOT NULL GROUP BY looking_at`),
      pool.query(`SELECT id, kind, text, created_at FROM activity_events ORDER BY id DESC LIMIT 40`),
      pool.query(`SELECT id, text, tone, audience, ends_at FROM announcements WHERE active AND (ends_at IS NULL OR ends_at > now()) ORDER BY id DESC LIMIT 1`),
    ]);
    // Turns "what people are looking at" into viewers per house.
    const houses = {};
    for (const r of looking.rows) {
      let ch = null;
      if (r.looking_at.startsWith('house:')) ch = Number(r.looking_at.slice(6));
      else if (demoTitle(r.looking_at)) ch = partyList.DEMO_BY_ID.get(r.looking_at).ch;
      else if (partyList.isHostedId(r.looking_at)) {
        const { rows: [p] } = await pool.query('SELECT chapter_id FROM hosted_parties WHERE id = $1', [r.looking_at.slice(1)]);
        ch = p?.chapter_id;
      }
      if (ch) houses[ch] = (houses[ch] || 0) + r.n;
    }
    let spotlight = null;
    if (s.spotlight) spotlight = { id: s.spotlight, title: await partyTitle(s.spotlight) };
    res.json({
      online: online.rows[0], houses, feed: feed.rows,
      beacon: beacon.rows[0] || null,
      lockdown: { signups: false, requests: false, checkout: false, ...(s.lockdown || {}) },
      spotlight,
      parties: (await partyList.partiesForSite(pool)).parties.map((p) => ({ id: p.id, title: p.title, ch: p.ch, day: p.day, hosted: !!p.hosted })),
    });
  }));

  app.post('/api/admin/announcement', requireAdmin, wrap(async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 200) : '';
    await pool.query('UPDATE announcements SET active = FALSE WHERE active');
    if (!text) return res.json({ ok: true });
    const tone = ['gold', 'pink', 'cyan', 'red'].includes(req.body?.tone) ? req.body.tone : 'gold';
    const audience = ['all', 'free', 'full', 'leaders'].includes(req.body?.audience) ? req.body.audience : 'all';
    const hours = Number(req.body?.hours);
    await pool.query(
      `INSERT INTO announcements (text, tone, audience, ends_at, created_by)
       VALUES ($1, $2, $3, CASE WHEN $4::int > 0 THEN now() + make_interval(hours => $4::int) END, $5)`,
      [text, tone, audience, Number.isInteger(hours) && hours > 0 && hours <= 24 * 30 ? hours : 0, req.user.id]
    );
    res.json({ ok: true });
  }));

  app.post('/api/admin/lockdown', requireAdmin, wrap(async (req, res) => {
    const now = { signups: false, requests: false, checkout: false, ...((await ops.settings()).lockdown || {}) };
    for (const k of ['signups', 'requests', 'checkout']) if (typeof req.body?.[k] === 'boolean') now[k] = req.body[k];
    await ops.setSetting('lockdown', Object.values(now).some(Boolean) ? now : null);
    res.json({ lockdown: now });
  }));

  app.post('/api/admin/spotlight', requireAdmin, wrap(async (req, res) => {
    const id = req.body?.partyId || null;
    if (id && !(await partyList.findParty(pool, id))) return fail(res, 400, "That party isn't on the schedule.");
    await ops.setSetting('spotlight', id);
    res.json({ ok: true });
  }));

  // ---------- Money: revenue, goal, promo codes, gifts ----------
  app.get('/api/admin/money', requireAdmin, wrap(async (req, res) => {
    const s = await ops.settings();
    const termStart = PRICING.termStart(todayISO());
    const [days, totals, recent, promos] = await Promise.all([
      pool.query(`WITH d AS (SELECT generate_series(${TODAY_SQL} - 29, ${TODAY_SQL}, interval '1 day')::date AS day)
                  SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                    coalesce((SELECT sum(amount_cents) FROM payments p WHERE p.livemode AND (p.paid_at AT TIME ZONE '${ZONE}')::date = d.day), 0)::int AS cents,
                    (SELECT count(*) FROM payments p WHERE p.livemode AND (p.paid_at AT TIME ZONE '${ZONE}')::date = d.day)::int AS sales
                  FROM d ORDER BY d.day`),
      pool.query(`SELECT coalesce(sum(amount_cents) FILTER (WHERE livemode), 0)::int AS all_cents,
                    coalesce(sum(amount_cents) FILTER (WHERE livemode AND paid_at >= ($1::date)::timestamp AT TIME ZONE '${ZONE}'), 0)::int AS term_cents,
                    count(*) FILTER (WHERE livemode AND paid_at >= ($1::date)::timestamp AT TIME ZONE '${ZONE}')::int AS term_sales,
                    count(*) FILTER (WHERE NOT livemode)::int AS test_sales
                  FROM payments`, [termStart]),
      pool.query(`SELECT p.paid_at, p.amount_cents, p.livemode, p.promo_code, u.name FROM payments p LEFT JOIN users u ON u.id = p.user_id
                  ORDER BY p.paid_at DESC LIMIT 12`),
      pool.query(`SELECT code, percent_off, max_uses, uses, ends_at, active, created_at FROM promo_codes ORDER BY created_at DESC`),
    ]);
    res.json({
      termStart, termEnd: PRICING.passEnds(termStart), goalCents: s.money_goal || 0,
      days: days.rows, totals: totals.rows[0],
      recent: recent.rows.map((r) => ({ when: r.paid_at, cents: r.amount_cents, live: r.livemode, promo: r.promo_code, who: shortName(r.name) || 'Deleted account' })),
      promos: promos.rows,
    });
  }));

  app.post('/api/admin/goal', requireAdmin, wrap(async (req, res) => {
    const dollars = Number(req.body?.dollars);
    if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1e6) return fail(res, 400, 'Enter a goal in dollars.');
    await ops.setSetting('money_goal', Math.round(dollars * 100) || null);
    res.json({ ok: true });
  }));

  app.post('/api/admin/promo', requireAdmin, wrap(async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const pct = Number(req.body?.percentOff);
    // Blank means no limit. (Number('') is 0, which would make the code used up before anyone tries it.)
    const rawMax = req.body?.maxUses;
    const maxUses = rawMax === '' || rawMax == null ? null : Number(rawMax);
    const ends = typeof req.body?.endsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.endsOn) ? req.body.endsOn : null;
    if (!/^[A-Z0-9-]{3,24}$/.test(code)) return fail(res, 400, 'Codes are 3 to 24 letters, numbers or dashes.');
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return fail(res, 400, 'Pick a discount from 1% to 100%.');
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000)) return fail(res, 400, 'Uses must be a whole number, or leave it blank for no limit.');
    const { rowCount } = await pool.query(
      `INSERT INTO promo_codes (code, percent_off, max_uses, ends_at) VALUES ($1, $2, $3, CASE WHEN $4::date IS NULL THEN NULL ELSE ($4::date + 1)::timestamp AT TIME ZONE '${ZONE}' END)
       ON CONFLICT (code) DO NOTHING`,
      [code, pct, maxUses, ends]
    );
    if (!rowCount) return fail(res, 409, 'That code already exists.');
    res.status(201).json({ ok: true });
  }));

  app.post('/api/admin/promo/:code/off', requireAdmin, wrap(async (req, res) => {
    const { rowCount } = await pool.query('UPDATE promo_codes SET active = FALSE WHERE code = $1', [String(req.params.code).toUpperCase()]);
    if (!rowCount) return fail(res, 404, 'No such code.');
    res.json({ ok: true });
  }));

  // Gives Full Access to a group at once. With an end date the passes end then; without, they never end.
  app.post('/api/admin/gift', requireAdmin, wrap(async (req, res) => {
    const audience = req.body?.audience;
    const until = typeof req.body?.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.until) ? req.body.until : null;
    if (until && until < todayISO()) return fail(res, 400, 'Pick an end date in the future, or leave it empty.');
    let where, params = [];
    if (audience === 'leaders') where = `id IN (SELECT user_id FROM chapter_members WHERE role = 'leader' AND chapter_id <> ALL($1::int[]))`, params = [TEST_IDS];
    else if (audience === 'brothers') where = `id IN (SELECT user_id FROM chapter_members WHERE chapter_id <> ALL($1::int[]))`, params = [TEST_IDS];
    else if (audience === 'emails') {
      const emails = String(req.body?.emails || '').toLowerCase().split(/[\s,;]+/).filter((e) => /^[a-z0-9._%+-]+@psu\.edu$/.test(e)).slice(0, 500);
      if (!emails.length) return fail(res, 400, 'Add at least one Penn State email.');
      where = 'email = ANY($1::text[])'; params = [emails];
    } else return fail(res, 400, 'Choose who gets it.');
    const n = params.length;
    const { rowCount } = await pool.query(
      `UPDATE users SET plan = 'full', plan_paid_at = coalesce(plan_paid_at, now()),
         plan_paid_until = CASE
           WHEN $${n + 1}::date IS NULL THEN NULL
           WHEN plan = 'full' AND plan_paid_until IS NULL THEN NULL
           ELSE GREATEST(coalesce(plan_paid_until, now()), ($${n + 1}::date + 1)::timestamp AT TIME ZONE '${ZONE}')
         END
       WHERE banned_at IS NULL AND email_verified_at IS NOT NULL AND ${where}`,
      [...params, until]
    );
    res.json({ gifted: rowCount });
  }));

  // ---------- Fame: Hall of Fame, Night Forecast, growth, Door Rush ----------
  app.get('/api/admin/fame', requireAdmin, wrap(async (req, res) => {
    const s = await ops.settings();
    const since = await boardStart();
    const [topParty, hotChapter, gamers, topBrother, fastest, forecast, refs, convert, accounts] = await Promise.all([
      pool.query(`SELECT party_id, count(*)::int AS n FROM invite_requests WHERE created_at >= ${WEEK_START_SQL} AND invited_by IS NULL
                  GROUP BY party_id ORDER BY n DESC LIMIT 1`),
      pool.query(`SELECT hp.chapter_id, count(*)::int AS n FROM invite_requests r JOIN hosted_parties hp ON 'h' || hp.id = r.party_id
                  WHERE r.created_at >= ${WEEK_START_SQL} AND hp.chapter_id <> ALL($1::int[]) GROUP BY hp.chapter_id ORDER BY n DESC LIMIT 1`, [TEST_IDS]),
      pool.query(`SELECT r.user_id, u.name, max(r.score)::int AS score FROM game_runs r JOIN users u ON u.id = r.user_id
                  WHERE r.finished_at >= $1 AND u.banned_at IS NULL GROUP BY r.user_id, u.name ORDER BY score DESC LIMIT 10`, [since]),
      pool.query(`SELECT u.name, m.chapter_id, count(*)::int AS n FROM brother_invites b JOIN users u ON u.id = b.invited_by
                  LEFT JOIN chapter_members m ON m.user_id = u.id WHERE coalesce(m.chapter_id, 0) <> ALL($1::int[])
                  GROUP BY u.name, m.chapter_id ORDER BY n DESC LIMIT 1`, [TEST_IDS]),
      pool.query(`WITH a AS (SELECT party_id, created_at, row_number() OVER (PARTITION BY party_id ORDER BY created_at) AS n
                             FROM invite_requests WHERE status = 'approved' AND party_id LIKE 'h%')
                  SELECT hp.title, hp.chapter_id, extract(epoch FROM a.created_at - hp.created_at)::int AS seconds
                  FROM a JOIN hosted_parties hp ON 'h' || hp.id = a.party_id
                  WHERE a.n = hp.cap AND hp.chapter_id <> ALL($1::int[]) ORDER BY seconds LIMIT 1`, [TEST_IDS]),
      pool.query(`SELECT hp.id, hp.title, hp.chapter_id, to_char(hp.party_date, 'YYYY-MM-DD') AS day, hp.cap, ${partyList.GOING_SQL} AS going,
                    (SELECT count(*) FROM invite_requests r WHERE r.party_id = 'h' || hp.id AND r.created_at > now() - interval '24 hours')::int AS last_day
                  FROM hosted_parties hp WHERE hp.status = 'live' AND hp.party_date >= ${TODAY_SQL} AND hp.chapter_id <> ALL($1::int[])
                  ORDER BY hp.party_date, hp.id`, [TEST_IDS]),
      pool.query(`SELECT referrer, count(DISTINCT visitor)::int AS n FROM site_visits
                  WHERE day > ${TODAY_SQL} - 30 AND referrer IS NOT NULL GROUP BY referrer ORDER BY n DESC LIMIT 8`),
      pool.query(`SELECT (SELECT count(DISTINCT user_id) FROM payments WHERE livemode)::int AS buyers,
                    (SELECT count(*) FROM users WHERE email_verified_at IS NOT NULL)::int AS verified`),
      pool.query(`SELECT count(*)::int AS n FROM users`),
    ]);
    const forecastRows = forecast.rows.map((p) => {
      const going = Math.min(p.going, p.cap), left = p.cap - going, perHour = p.last_day / 24;
      const hours = left === 0 ? 0 : perHour > 0 ? left / perHour : null;
      return { id: 'h' + p.id, title: p.title, chapter: chapterName(p.chapter_id), day: p.day, cap: p.cap, going, lastDay: p.last_day, hoursToFull: hours };
    }).sort((a, b) => (a.hoursToFull ?? 1e9) - (b.hoursToFull ?? 1e9));
    res.json({
      fame: {
        topParty: topParty.rows[0] ? { title: await partyTitle(topParty.rows[0].party_id), requests: topParty.rows[0].n } : null,
        hotChapter: hotChapter.rows[0] ? { name: chapterName(hotChapter.rows[0].chapter_id), requests: hotChapter.rows[0].n } : null,
        topBrother: topBrother.rows[0] ? { name: shortName(topBrother.rows[0].name), chapter: chapterName(topBrother.rows[0].chapter_id), invites: topBrother.rows[0].n } : null,
        fastest: fastest.rows[0] ? { title: fastest.rows[0].title, chapter: chapterName(fastest.rows[0].chapter_id), seconds: fastest.rows[0].seconds } : null,
        gamers: gamers.rows.map((g, i) => ({ place: i + 1, userId: String(g.user_id), name: shortName(g.name), score: g.score })),
      },
      forecast: forecastRows,
      growth: { referrers: refs.rows, buyers: convert.rows[0].buyers, verified: convert.rows[0].verified, accounts: accounts.rows[0].n },
      game: { eventUntil: s.game_event_until || null, resetAt: s.game_reset_at || null },
    });
  }));

  app.post('/api/admin/game/reset', requireAdmin, wrap(async (req, res) => {
    await ops.setSetting('game_reset_at', new Date().toISOString());
    res.json({ ok: true });
  }));
  app.post('/api/admin/game/event', requireAdmin, wrap(async (req, res) => {
    const days = Number(req.body?.days);
    if (days && (!Number.isInteger(days) || days < 1 || days > 14)) return fail(res, 400, 'Events last 1 to 14 days.');
    await ops.setSetting('game_event_until', days ? new Date(Date.now() + days * 864e5).toISOString() : null);
    res.json({ ok: true });
  }));
  app.post('/api/admin/game/remove/:id', requireAdmin, wrap(async (req, res) => {
    if (!/^\d{1,18}$/.test(req.params.id)) return fail(res, 400, 'That account id is not valid.');
    const { rowCount } = await pool.query('DELETE FROM game_runs WHERE user_id = $1 AND finished_at >= $2', [req.params.id, await boardStart()]);
    res.json({ removed: rowCount });
  }));

  // ---------- Search everything ----------
  app.get('/api/admin/search', requireAdmin, wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    if (q.length < 2) return res.json({ results: [] });
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const [users, parties, pays] = await Promise.all([
      pool.query(`SELECT id, name, email, plan, banned_at IS NOT NULL AS banned FROM users WHERE name ILIKE $1 OR email ILIKE $1 ORDER BY name LIMIT 8`, [like]),
      pool.query(`SELECT id, title, chapter_id, status, to_char(party_date, 'YYYY-MM-DD') AS day FROM hosted_parties WHERE title ILIKE $1 ORDER BY party_date DESC LIMIT 8`, [like]),
      pool.query(`SELECT p.stripe_session_id, p.amount_cents, p.livemode, p.paid_at, u.email FROM payments p LEFT JOIN users u ON u.id = p.user_id
                  WHERE p.stripe_session_id ILIKE $1 OR u.email ILIKE $1 ORDER BY p.paid_at DESC LIMIT 5`, [like]),
    ]);
    const ql = q.toLowerCase();
    const chapters = CHAPTERS.filter((c) => [c.name, c.gl, c.nick || ''].some((v) => v.toLowerCase().includes(ql))).slice(0, 8);
    const demo = [...partyList.DEMO_BY_ID.values()].filter((p) => p.title.toLowerCase().includes(ql)).slice(0, 5);
    res.json({ results: [
      ...users.rows.map((u) => ({ type: 'account', id: String(u.id), title: u.name, sub: `${u.email} · ${u.banned ? 'Banned' : u.plan === 'full' ? 'Full Access' : 'Free'}`, email: u.email })),
      ...chapters.map((c) => ({ type: 'chapter', id: c.id, title: `${c.gl}  ${c.name}`, sub: c.test ? 'Practice chapter' : 'Chapter' })),
      ...parties.rows.map((p) => ({ type: 'party', id: 'h' + p.id, title: p.title, sub: `${chapterName(p.chapter_id)} · ${p.day} · ${p.status}`, chapter: p.chapter_id })),
      ...demo.map((p) => ({ type: 'party', id: p.id, title: p.title, sub: `Demo party · ${chapterName(p.ch)}` })),
      ...pays.rows.map((p) => ({ type: 'payment', id: p.stripe_session_id, title: `$${(p.amount_cents / 100).toFixed(2)} ${p.livemode ? 'sale' : 'test payment'}`, sub: `${p.email || 'Deleted account'} · ${new Date(p.paid_at).toLocaleDateString('en-US')}` })),
    ] });
  }));

  // ---------- Activity log ----------
  app.get('/api/admin/log', requireAdmin, wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT l.action, l.created_at, u.name FROM admin_log l LEFT JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 150`);
    res.json({ log: rows.map((r) => ({ action: r.action, when: r.created_at, by: r.name || 'A former admin' })) });
  }));
};
