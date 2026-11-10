// Friends mode, free for everyone: add friends, see which parties they're going to this weekend, open their
// profiles, a friends-only Door Rush leaderboard, and invite friends to a party.
// Privacy rules: friendships are mutual; people only show up at parties they marked "I'm going" themselves;
// plans are deleted once the party's day passes; ghost mode hides you; blocking is silent; and a chapter can
// keep a party's crowd private so it never shows on anyone's friends board.
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const partyList = require('./party-list.js');
const CHAPTERS = require('./public/chapters.js');

const SITE_URL = process.env.SITE_URL || 'https://phat-frats.vercel.app';
const MAX_FRIENDS = 500;
const ID = /^\d{1,18}$/;

module.exports = function mountFriends(app, { pool, wrap, fail, requireVerified, community, WEEK_START_SQL, ops }) {
  const limiter = (limit, message) => rateLimit({
    windowMs: 60 * 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => (req.user ? 'u:' + req.user.id : 'ip:' + ipKeyGenerator(req.ip)),
    message: { error: message, code: 'RATE_LIMITED' },
  });
  const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'A friend';
  const chapterName = (id) => CHAPTERS.find((c) => c.id === Number(id))?.name || null;
  const VISIBLE = (u) => `(${u}.ghost_until IS NULL OR ${u}.ghost_until <= now())`;

  // Plans are forgotten once their party's day has passed.
  let lastCleanup = 0;
  function forgetOldPlans() {
    if (Date.now() - lastCleanup < 60 * 60 * 1000) return;
    lastCleanup = Date.now();
    pool.query('DELETE FROM friend_going WHERE party_day < $1::date', [partyList.todayISO()])
      .catch((err) => console.error('Could not clear old plans:', err.message));
  }

  async function friendIds(userId) {
    const { rows } = await pool.query(
      `SELECT u.id FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE $1 IN (f.requester_id, f.addressee_id) AND f.status = 'accepted' AND u.banned_at IS NULL`,
      [userId]
    );
    return rows.map((r) => String(r.id));
  }
  async function areFriends(a, b) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM friendships WHERE status = 'accepted' AND LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint)
         AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)`,
      [a, b]
    );
    return rowCount > 0;
  }

  // A party friends can see: on the schedule, not hidden by its chapter, and not a hidden demo party.
  async function partyLookup() {
    const s = await ops.settings();
    const cache = new Map();
    return async (id) => {
      if (!cache.has(id)) {
        const p = await partyList.findParty(pool, id);
        cache.set(id, p && !p.hideFriends && !(s.hide_demo && !p.hosted) ? p : null);
      }
      return cache.get(id);
    };
  }
  const partyDay = (p) => (p.hosted ? p.day : partyList.demoDate(p.day));

  // Which visible parties each of these friends is going to, as { partyId: [friendId, ...] }.
  async function friendsGoing(ids) {
    if (!ids.length) return {};
    const { rows } = await pool.query(
      `SELECT g.user_id, g.party_id FROM friend_going g JOIN users u ON u.id = g.user_id
       WHERE g.user_id = ANY($1::bigint[]) AND g.party_day >= $2::date AND u.banned_at IS NULL AND ${VISIBLE('u')}
       ORDER BY g.created_at`,
      [ids, partyList.todayISO()]
    );
    const look = await partyLookup();
    const out = {};
    for (const r of rows) {
      if (!(await look(r.party_id))) continue;
      (out[r.party_id] = out[r.party_id] || []).push(String(r.user_id));
    }
    return out;
  }

  // ---------- the bell: "3 friends are going to ..." ----------
  community.addAlertSource(async (user) => {
    const ids = await friendIds(user.id);
    if (!ids.length) return [];
    const going = await friendsGoing(ids);
    const [{ rows: mine }, { rows: asked }, { rows: names }] = await Promise.all([
      pool.query('SELECT party_id FROM friend_going WHERE user_id = $1', [user.id]),
      pool.query('SELECT party_id FROM invite_requests WHERE user_id = $1', [user.id]),
      pool.query('SELECT id, name FROM users WHERE id = ANY($1::bigint[])', [ids]),
    ]);
    const skip = new Set([...mine, ...asked].map((r) => r.party_id));
    const nameOf = Object.fromEntries(names.map((n) => [String(n.id), first(n.name)]));
    const look = await partyLookup();
    const alerts = [];
    const top = Object.entries(going).filter(([pid]) => !skip.has(pid)).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
    for (const [pid, who] of top) {
      const p = await look(pid);
      const lead = nameOf[who[0]] || 'A friend';
      alerts.push({
        kind: 'friends', party: pid,
        text: who.length === 1 ? `👯 ${lead} is going to ${p.title}. Want to join?` : `👯 ${lead} and ${who.length - 1} more friend${who.length === 2 ? '' : 's'} are going to ${p.title}.`,
      });
    }
    return alerts;
  });

  // ---------- everything the Friends screen needs ----------
  app.get('/api/friends', ...requireVerified, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    forgetOldPlans();
    const me = req.user.id, today = partyList.todayISO();
    const [friends, incoming, outgoing, blocked, mine, meRow] = await Promise.all([
      pool.query(
        `SELECT u.id, u.name, f.accepted_at FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
         WHERE $1 IN (f.requester_id, f.addressee_id) AND f.status = 'accepted' AND u.banned_at IS NULL ORDER BY lower(u.name)`, [me]),
      pool.query(`SELECT u.id, u.name, f.created_at FROM friendships f JOIN users u ON u.id = f.requester_id
                  WHERE f.addressee_id = $1 AND f.status = 'pending' AND u.banned_at IS NULL ORDER BY f.created_at DESC`, [me]),
      pool.query(`SELECT u.id, u.name FROM friendships f JOIN users u ON u.id = f.addressee_id
                  WHERE f.requester_id = $1 AND f.status = 'pending' AND u.banned_at IS NULL ORDER BY f.created_at DESC`, [me]),
      pool.query('SELECT u.id, u.name FROM friend_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC', [me]),
      pool.query('SELECT party_id FROM friend_going WHERE user_id = $1 AND party_day >= $2::date', [me, today]),
      pool.query(`SELECT ghost_until > now() AS ghost, ghost_until = 'infinity' AS always FROM users WHERE id = $1`, [me]),
    ]);
    const ids = friends.rows.map((f) => String(f.id));
    const going = await friendsGoing(ids);
    const plansOf = {};
    for (const [pid, who] of Object.entries(going)) for (const id of who) (plansOf[id] = plansOf[id] || []).push(pid);
    // The friends-only Door Rush leaderboard for this week, with you on it.
    const { rows: scores } = await pool.query(
      `SELECT r.user_id, max(r.score)::int AS score FROM game_runs r
       WHERE r.user_id = ANY($1::bigint[]) AND r.finished_at >= ${WEEK_START_SQL} AND r.score > 0 GROUP BY r.user_id ORDER BY score DESC`,
      [[...ids, String(me)]]
    );
    const nameOf = Object.fromEntries(friends.rows.map((f) => [String(f.id), f.name]));
    nameOf[String(me)] = req.user.name;
    const code = await community.referralCode(me);
    // Your own plans show even on parties a chapter keeps private, with a note.
    const look = await partyLookup();
    const myPlans = [];
    for (const r of mine.rows) {
      const p = await partyList.findParty(pool, r.party_id);
      if (p) myPlans.push({ partyId: r.party_id, private: !(await look(r.party_id)) });
    }
    res.json({
      code, link: code ? `${SITE_URL}/?friend=${code}` : null,
      ghost: { on: !!meRow.rows[0]?.ghost, always: !!meRow.rows[0]?.always },
      friends: friends.rows.map((f) => ({ id: String(f.id), name: f.name, since: f.accepted_at, going: plansOf[String(f.id)] || [] })),
      incoming: incoming.rows.map((u) => ({ id: String(u.id), name: u.name, at: u.created_at })),
      outgoing: outgoing.rows.map((u) => ({ id: String(u.id), name: u.name })),
      blocked: blocked.rows.map((u) => ({ id: String(u.id), name: u.name })),
      board: Object.entries(going).map(([partyId, who]) => ({ partyId, friends: who })).sort((a, b) => b.friends.length - a.friends.length),
      mine: myPlans,
      leaderboard: scores.map((s, i) => ({ place: i + 1, id: String(s.user_id), name: nameOf[String(s.user_id)] || 'Friend', score: s.score, you: String(s.user_id) === String(me) })),
      suggestions: await suggestions(me, ids),
    });
  }));

  // People you probably know: who you brought to PhatFrats (or who brought you), your group plans, and friends of friends.
  async function suggestions(me, ids) {
    const { rows } = await pool.query(
      `WITH cand AS (
         SELECT id AS uid, 'Joined with your link' AS why, 3 AS weight FROM users WHERE referred_by = $1
         UNION ALL SELECT referred_by, 'Brought you to PhatFrats', 3 FROM users WHERE id = $1 AND referred_by IS NOT NULL
         UNION ALL SELECT m2.user_id, 'In a group plan with you', 2 FROM group_members m1 JOIN group_members m2 ON m2.code = m1.code WHERE m1.user_id = $1
         UNION ALL SELECT CASE WHEN f.requester_id = ANY($2::bigint[]) THEN f.addressee_id ELSE f.requester_id END, 'mutual', 1
           FROM friendships f WHERE f.status = 'accepted' AND (f.requester_id = ANY($2::bigint[]) OR f.addressee_id = ANY($2::bigint[]))
       )
       SELECT c.uid, u.name, sum(c.weight)::int AS score, count(*) FILTER (WHERE c.why = 'mutual')::int AS mutual,
              (array_agg(c.why ORDER BY c.weight DESC))[1] AS why
       FROM cand c JOIN users u ON u.id = c.uid
       WHERE c.uid <> $1 AND u.banned_at IS NULL AND u.email_verified_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM friendships f WHERE LEAST(f.requester_id, f.addressee_id) = LEAST($1::bigint, c.uid) AND GREATEST(f.requester_id, f.addressee_id) = GREATEST($1::bigint, c.uid))
         AND NOT EXISTS (SELECT 1 FROM friend_blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = c.uid) OR (b.blocker_id = c.uid AND b.blocked_id = $1))
       GROUP BY c.uid, u.name ORDER BY score DESC, lower(u.name) LIMIT 6`,
      [me, ids]
    );
    const out = [];
    for (const r of rows) {
      const code = await community.referralCode(r.uid);
      if (code) out.push({ code, name: r.name, why: r.why === 'mutual' ? `${r.mutual} friend${r.mutual === 1 ? '' : 's'} in common` : r.why });
    }
    return out;
  }

  // ---------- requests ----------
  const requestLimiter = limiter(60, 'Too many friend requests. Try again in an hour.');
  app.post('/api/friends/request', ...requireVerified, requestLimiter, wrap(async (req, res) => {
    const me = req.user.id;
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase().slice(0, 12) : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 160) : '';
    if (!code && !email) return fail(res, 400, "Add your friend's Penn State email.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(res, 400, 'That email doesn\'t look right.');
    const { rows: [them] } = await pool.query(
      `SELECT id, name FROM users WHERE ${code ? 'referral_code = $1' : 'email = $1'} AND banned_at IS NULL AND email_verified_at IS NOT NULL`,
      [code || email]
    );
    if (!them) return fail(res, 404, code ? "That friend link isn't valid anymore." : 'Nobody with that email is on PhatFrats yet. Send them your friend link instead!', 'NO_ACCOUNT');
    if (String(them.id) === String(me)) return fail(res, 400, "That's you! Send the link to a friend.");
    const { rows: blocks } = await pool.query(
      'SELECT blocker_id FROM friend_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [me, them.id]);
    if (blocks.some((b) => String(b.blocker_id) === String(me))) return fail(res, 400, 'You blocked this person. Unblock them in Friends settings first.');
    // Blocked by them: it looks sent, but nothing happens.
    if (blocks.length) return res.json({ status: 'sent' });
    const { rows: [row] } = await pool.query(
      `SELECT requester_id, status FROM friendships WHERE LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint)
         AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)`, [me, them.id]);
    if (row?.status === 'accepted') return res.json({ status: 'friends', name: first(them.name) });
    if (row && String(row.requester_id) === String(them.id)) {
      // They already asked you, so this accepts.
      await pool.query(`UPDATE friendships SET status = 'accepted', accepted_at = now() WHERE requester_id = $1 AND addressee_id = $2`, [them.id, me]);
      await community.notify(them.id, 'friend', `🤝 ${first(req.user.name)} accepted your friend request.`, { email: false, link: '/?friends=1' });
      return res.json({ status: 'friends', name: first(them.name) });
    }
    if (row) return res.json({ status: 'sent' });
    const { rows: [n] } = await pool.query(`SELECT count(*)::int AS n FROM friendships WHERE $1 IN (requester_id, addressee_id)`, [me]);
    if (n.n >= MAX_FRIENDS) return fail(res, 400, `You've reached ${MAX_FRIENDS} friends and requests. Remove a few to add more.`);
    await pool.query('INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, them.id]);
    await community.notify(them.id, 'friend', `👯 ${req.user.name} wants to be friends on PhatFrats.`, { email: false, link: '/?friends=1' });
    res.status(201).json({ status: 'sent' });
  }));

  const idParam = (v) => (typeof v === 'string' && ID.test(v) ? v : null);
  app.post('/api/friends/respond', ...requireVerified, wrap(async (req, res) => {
    const id = idParam(req.body?.id);
    if (!id) return fail(res, 400, 'That request is gone.');
    if (req.body?.accept === true) {
      const { rowCount } = await pool.query(
        `UPDATE friendships SET status = 'accepted', accepted_at = now() WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`, [id, req.user.id]);
      if (!rowCount) return fail(res, 404, 'That request is gone.');
      await community.notify(id, 'friend', `🤝 ${first(req.user.name)} accepted your friend request.`, { email: false, link: '/?friends=1' });
      ops.activity('friends', 'Two students became friends');
    } else {
      // Declining is quiet: the other person isn't told.
      await pool.query(`DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`, [id, req.user.id]);
    }
    res.json({ ok: true });
  }));

  // Unfriend, or cancel a request you sent. Quiet either way.
  app.post('/api/friends/remove', ...requireVerified, wrap(async (req, res) => {
    const id = idParam(req.body?.id);
    if (!id) return fail(res, 400, 'Not found.');
    await pool.query(`DELETE FROM friendships WHERE LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint)
      AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)`, [req.user.id, id]);
    res.json({ ok: true });
  }));

  app.post('/api/friends/block', ...requireVerified, wrap(async (req, res) => {
    const id = idParam(req.body?.id);
    if (!id || id === String(req.user.id)) return fail(res, 400, 'Not found.');
    const { rowCount } = await pool.query('INSERT INTO friend_blocks (blocker_id, blocked_id) SELECT $1, id FROM users WHERE id = $2 ON CONFLICT DO NOTHING', [req.user.id, id]);
    await pool.query(`DELETE FROM friendships WHERE LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint)
      AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)`, [req.user.id, id]);
    res.json({ ok: true, blocked: rowCount > 0 });
  }));
  app.post('/api/friends/unblock', ...requireVerified, wrap(async (req, res) => {
    const id = idParam(req.body?.id);
    if (!id) return fail(res, 400, 'Not found.');
    await pool.query('DELETE FROM friend_blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, id]);
    res.json({ ok: true });
  }));

  // ---------- your plans and ghost mode ----------
  app.post('/api/friends/going', ...requireVerified, wrap(async (req, res) => {
    const id = typeof req.body?.partyId === 'string' ? req.body.partyId : '';
    if (req.body?.on === false) await pool.query('DELETE FROM friend_going WHERE user_id = $1 AND party_id = $2', [req.user.id, id]);
    else {
      const p = await partyList.findParty(pool, id);
      if (!p) return fail(res, 400, 'That party is not on the schedule.');
      await pool.query('INSERT INTO friend_going (user_id, party_id, party_day) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [req.user.id, p.id, partyDay(p)]);
    }
    const { rows } = await pool.query('SELECT party_id FROM friend_going WHERE user_id = $1 AND party_day >= $2::date', [req.user.id, partyList.todayISO()]);
    res.json({ going: rows.map((r) => r.party_id) });
  }));

  app.post('/api/friends/ghost', ...requireVerified, wrap(async (req, res) => {
    const mode = req.body?.mode;
    // "This weekend" lasts until Monday at midnight in State College.
    const until = mode === 'always' ? `'infinity'::timestamptz` : mode === 'weekend' ? `(${WEEK_START_SQL} + interval '7 days')` : 'NULL';
    await pool.query(`UPDATE users SET ghost_until = ${until} WHERE id = $1`, [req.user.id]);
    res.json({ ok: true, on: mode === 'always' || mode === 'weekend', always: mode === 'always' });
  }));

  // ---------- a friend's profile ----------
  app.get('/api/friends/:id/profile', ...requireVerified, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = idParam(req.params.id);
    if (!id || !(await areFriends(req.user.id, id))) return fail(res, 404, "You can only see your friends' profiles.");
    const { rows: [u] } = await pool.query('SELECT id, name, plan, created_at FROM users WHERE id = $1 AND banned_at IS NULL', [id]);
    if (!u) return fail(res, 404, "You can only see your friends' profiles.");
    const [prof, game, approved, together, mutual, since, going] = await Promise.all([
      community.profile(u),
      pool.query(`SELECT max(score) FILTER (WHERE finished_at >= ${WEEK_START_SQL})::int AS week, max(score)::int AS best,
                    count(*) FILTER (WHERE score IS NOT NULL)::int AS games, (SELECT count(*) FROM game_prizes WHERE user_id = $1)::int AS wins
                  FROM game_runs WHERE user_id = $1 AND finished_at IS NOT NULL`, [id]),
      pool.query(`SELECT r.party_id, hp.chapter_id FROM invite_requests r LEFT JOIN hosted_parties hp ON 'h' || hp.id = r.party_id
                  WHERE r.user_id = $1 AND r.status = 'approved'`, [id]),
      pool.query(`SELECT count(*)::int AS n FROM invite_requests a JOIN invite_requests b ON b.party_id = a.party_id
                  WHERE a.user_id = $1 AND b.user_id = $2 AND a.status = 'approved' AND b.status = 'approved'`, [id, req.user.id]),
      friendIds(id).then(async (theirs) => {
        const mine = new Set(await friendIds(req.user.id));
        const both = theirs.filter((x) => mine.has(x));
        if (!both.length) return [];
        const { rows } = await pool.query('SELECT name FROM users WHERE id = ANY($1::bigint[]) ORDER BY lower(name)', [both]);
        return rows.map((r) => r.name);
      }),
      pool.query(`SELECT accepted_at FROM friendships WHERE status = 'accepted' AND LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint)
                  AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)`, [id, req.user.id]),
      friendsGoing([id]),
    ]);
    // Their favorite house: the chapter they've been approved at most.
    const counts = {};
    for (const r of approved.rows) {
      const ch = r.chapter_id ?? partyList.DEMO_BY_ID.get(r.party_id)?.ch;
      if (ch != null && chapterName(ch)) counts[ch] = (counts[ch] || 0) + 1;
    }
    const fav = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const g = game.rows[0];
    res.json({
      id: String(u.id), name: u.name, joined: u.created_at, friendsSince: since.rows[0]?.accepted_at || null,
      streak: prof.streak, badges: prof.badges,
      doorRush: { week: g.week || 0, best: g.best || 0, games: g.games, wins: g.wins },
      parties: approved.rows.length, together: together.rows[0].n,
      favorite: fav ? { name: chapterName(fav[0]), times: fav[1] } : null,
      mutual: { count: mutual.length, names: mutual.slice(0, 5) },
      going: Object.keys(going),
    });
  }));

  // ---------- bring friends to a party ----------
  // Makes (or reuses) your group plan for the party and sends the chosen friends the link in their bell.
  app.post('/api/friends/bring', ...requireVerified, limiter(30, 'Too many invites. Try again later.'), wrap(async (req, res) => {
    const p = typeof req.body?.partyId === 'string' ? await partyList.findParty(pool, req.body.partyId) : null;
    if (!p) return fail(res, 400, 'That party is not on the schedule.');
    const want = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string' && ID.test(x)).slice(0, 25) : [];
    const mine = new Set(await friendIds(req.user.id));
    const ids = [...new Set(want)].filter((x) => mine.has(x));
    if (!ids.length) return fail(res, 400, 'Pick at least one friend.');
    const { rows: [had] } = await pool.query('SELECT code FROM party_groups WHERE owner_id = $1 AND party_id = $2', [req.user.id, p.id]);
    const code = had?.code || crypto.randomBytes(5).toString('base64url');
    if (!had) {
      await pool.query('INSERT INTO party_groups (code, party_id, owner_id) VALUES ($1, $2, $3)', [code, p.id, req.user.id]);
      await pool.query('INSERT INTO group_members (code, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [code, req.user.id]);
    }
    for (const id of ids) await community.notify(id, 'bring', `👯 ${first(req.user.name)} wants you to come to ${p.title} with them.`, { email: false, link: `/?group=${code}` });
    res.json({ sent: ids.length, link: `${SITE_URL}/?group=${code}` });
  }));
};
