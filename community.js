// Things that bring students back: saved parties, the notification bell and emails, streaks and badges,
// referrals, group plans, the Door Rush weekly prize, safety reports, the contact form and the Weekend Drop.
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { PgStore, nameFor } = require('./rate-store.js');
const PRICING = require('./public/pricing.js');
const partyList = require('./party-list.js');

const ZONE = 'America/New_York';
const SITE_URL = process.env.SITE_URL || 'https://phat-frats.vercel.app';
const REFERRALS_NEEDED = 3;
const FOUNDING_UNTIL = '2027-01-10';
// The most extra invites anyone can save up.
const MAX_BONUS = 10;
const TOP_PLACES = 10;
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date());
const endOfDay = (iso) => `(($${iso}::date + 1)::timestamp AT TIME ZONE '${ZONE}')`;

function create({ pool, wrap, fail, requireUser, mailer, IS_PROD, ops, WEEK_START_SQL, CHAPTERS }) {
  const chapterName = (id) => CHAPTERS.find((c) => c.id === Number(id))?.name || 'a chapter';
  const limiter = (limit, message) => rateLimit({
    windowMs: 60 * 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false,
    store: new PgStore(pool, nameFor('community', limit, message)), passOnStoreError: true,
    keyGenerator: (req) => (req.user ? 'u:' + req.user.id : 'ip:' + ipKeyGenerator(req.ip)),
    message: { error: message, code: 'RATE_LIMITED' },
  });

  // ---------- notifications ----------
  async function sendMail(to, subject, text) {
    if (!mailer) { if (!IS_PROD) console.log(`[dev only] Email to ${to}: ${subject}\n${text}`); return; }
    await mailer.sendMail({ from: `"PhatFrats" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`, to, subject, text });
  }
  // Puts a note in someone's bell, and emails them too unless they turned emails off.
  async function notify(userId, kind, text, { email = true, link = null } = {}) {
    await pool.query('INSERT INTO notifications (user_id, kind, text, link) VALUES ($1, $2, $3, $4)', [userId, kind, text.slice(0, 240), link]);
    if (!email) return;
    const { rows: [u] } = await pool.query('SELECT email, email_opt_in FROM users WHERE id = $1 AND banned_at IS NULL', [userId]);
    if (!u || !u.email_opt_in) return;
    sendMail(u.email, text.length > 70 ? 'News from PhatFrats' : text, `${text}\n\nOpen PhatFrats: ${SITE_URL}${link || ''}\n\nTo stop these emails, open your profile on PhatFrats and switch off email updates.`)
      .catch((err) => console.error('Notification email failed:', err.message));
  }

  // ---------- passes as rewards ----------
  // Extends someone's Full Access through a date. Never shortens a pass, and never touches a pass with no end.
  async function extendPass(userId, through) {
    const { rows } = await pool.query(
      `UPDATE users SET plan = 'full', plan_paid_at = coalesce(plan_paid_at, now()),
         plan_paid_until = CASE WHEN plan = 'full' AND plan_paid_until IS NULL THEN NULL
           ELSE GREATEST(coalesce(plan_paid_until, now()), ${endOfDay(2)}) END
       WHERE id = $1 RETURNING plan_paid_until IS NULL AS forever`,
      [userId, through]
    );
    return { forever: !!rows[0]?.forever };
  }

  // ---------- referrals ----------
  async function referralCode(userId) {
    const { rows: [u] } = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
    if (u?.referral_code) return u.referral_code;
    for (let i = 0; i < 5; i++) {
      const code = crypto.randomBytes(4).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
      if (code.length < 5) continue;
      const { rowCount } = await pool.query('UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE referral_code = $2)', [userId, code]);
      if (rowCount) return code;
    }
    return null;
  }
  // When a friend confirms their email, their referrer may have earned a free semester.
  async function checkReferralReward(newUserId) {
    // Claims this friend's confirmation first, so repeating the confirm step can't earn the referrer more.
    const { rowCount: fresh } = await pool.query(
      `UPDATE users SET referral_counted_at = now()
       WHERE id = $1 AND referral_counted_at IS NULL AND referred_by IS NOT NULL AND email_verified_at IS NOT NULL`,
      [newUserId]
    );
    if (!fresh) return;
    const { rows: [r] } = await pool.query(
      `SELECT ref.id, ref.ref_reward_at, (SELECT count(*) FROM users f WHERE f.referred_by = ref.id AND f.email_verified_at IS NOT NULL)::int AS n
       FROM users u JOIN users ref ON ref.id = u.referred_by WHERE u.id = $1 AND ref.banned_at IS NULL`,
      [newUserId]
    );
    if (!r) return;
    await pool.query('UPDATE users SET bonus_invites = LEAST(bonus_invites + 1, $2) WHERE id = $1', [r.id, MAX_BONUS]);
    if (r.n < REFERRALS_NEEDED) {
      await notify(r.id, 'referral', `🎟️ A friend joined PhatFrats with your link, so you earned an extra invite! And ${r.n} of ${REFERRALS_NEEDED} for a free semester of Full Access.`, { email: false });
      return;
    }
    const { rowCount } = await pool.query('UPDATE users SET ref_reward_at = now() WHERE id = $1 AND ref_reward_at IS NULL', [r.id]);
    if (!rowCount) return;
    const through = PRICING.passEnds(todayISO());
    const { forever } = await extendPass(r.id, through);
    await notify(r.id, 'reward', forever
      ? `🎁 ${REFERRALS_NEEDED} friends joined with your link! You already have Full Access with no end date, so this one is pure bragging rights. Thank you!`
      : `🎁 ${REFERRALS_NEEDED} friends joined with your link, so you have Full Access through ${PRICING.passEndLabel(through)}. Thank you!`);
  }

  // ---------- Door Rush weekly prize ----------
  // Last week's champion wins a free semester. A scheduled job runs this every Monday just after midnight;
  // loading Door Rush or the bell also checks, as a backup. A week's prize can only ever be given once.
  // Once a week's prize is settled, nothing more is checked until next week; otherwise it rechecks each minute.
  let lastPrizeCheck = 0, settledWeek = null;
  async function awardDoorRushPrize({ force = false } = {}) {
    if (!force && Date.now() - lastPrizeCheck < 60 * 1000) return { result: 'skipped' };
    lastPrizeCheck = Date.now();
    const { rows: [w] } = await pool.query(`SELECT (${WEEK_START_SQL} - interval '7 days') AS start, ${WEEK_START_SQL} AS stop,
      to_char((${WEEK_START_SQL} - interval '7 days') AT TIME ZONE '${ZONE}', 'YYYY-MM-DD') AS week`);
    if (settledWeek === w.week) return { result: 'already-awarded', week: w.week };
    const { rows: [champ] } = await pool.query(
      // Ties go to whoever reached the score first.
      `SELECT r.user_id, max(r.score)::int AS score, (array_agg(r.finished_at ORDER BY r.score DESC, r.finished_at))[1] AS reached
       FROM game_runs r JOIN users u ON u.id = r.user_id
       WHERE r.finished_at >= $1 AND r.finished_at < $2 AND u.banned_at IS NULL AND r.score > 0
       GROUP BY r.user_id ORDER BY score DESC, reached ASC LIMIT 1`,
      [w.start, w.stop]
    );
    if (!champ) return { result: 'nobody-played', week: w.week };
    const { rowCount } = await pool.query(
      'INSERT INTO game_prizes (week_start, user_id, score) VALUES ($1, $2, $3) ON CONFLICT (week_start) DO NOTHING',
      [w.week, champ.user_id, champ.score]
    );
    settledWeek = w.week;
    await awardTopTen(w, champ.user_id);
    if (!rowCount) return { result: 'already-awarded', week: w.week };
    // A free semester: through the end of next term, so it's worth something even to someone with a pass.
    const through = PRICING.passEnds(PRICING.passEnds(todayISO()));
    const { forever } = await extendPass(champ.user_id, through);
    await notify(champ.user_id, 'prize', `🏆 You were last week's Door Rush champion with ${champ.score.toLocaleString('en-US')} points! ${forever ? 'Your Full Access already has no end date, so enjoy the crown.' : `Your Full Access now runs through ${PRICING.passEndLabel(through)}.`}`, { link: '/game' });
    ops.activity('prize', `A Door Rush champion won a free semester`);
    return { result: 'awarded', week: w.week, score: champ.score };
  }

  // Places 2 to 10 in last week's Door Rush each get an extra invite. Runs once per week.
  async function awardTopTen(w, champId) {
    const { rowCount } = await pool.query('UPDATE game_prizes SET top10_done = TRUE WHERE week_start = $1 AND NOT top10_done', [w.week]);
    if (!rowCount) return;
    const { rows } = await pool.query(
      `SELECT r.user_id, max(r.score)::int AS score, (array_agg(r.finished_at ORDER BY r.score DESC, r.finished_at))[1] AS first
       FROM game_runs r JOIN users u ON u.id = r.user_id
       WHERE r.finished_at >= $1 AND r.finished_at < $2 AND u.banned_at IS NULL AND r.score > 0
       GROUP BY r.user_id ORDER BY score DESC, first ASC LIMIT $3`,
      [w.start, w.stop, TOP_PLACES]
    );
    for (const [i, r] of rows.entries()) {
      if (String(r.user_id) === String(champId)) continue;
      await pool.query('UPDATE users SET bonus_invites = LEAST(bonus_invites + 1, $2) WHERE id = $1', [r.user_id, MAX_BONUS]);
      await notify(r.user_id, 'bonus', `🎟️ You finished #${i + 1} in Door Rush last week, so you earned an extra invite! It's saved for whenever you need it.`, { email: false, link: '/game' });
    }
  }

  // Vercel's scheduler calls this every Monday. With CRON_SECRET set in Vercel, only the scheduler can call it;
  // without it, anyone could trigger it, which is harmless because each week's prize is given once, to the right person.
  function mountCron(app) {
    // Rate limited too, so nobody can call it over and over to load the database.
    app.get('/api/cron/door-rush-prize', limiter(20, 'Too many tries.'), wrap(async (req, res) => {
      const secret = process.env.CRON_SECRET;
      if (secret && req.get('authorization') !== `Bearer ${secret}`) return fail(res, 401, 'Not allowed.');
      res.set('Cache-Control', 'no-store');
      res.json(await awardDoorRushPrize({ force: true }));
    }));
  }

  // ---------- badges and streaks ----------
  async function profile(user) {
    const [weeks, firsts, approved, prizes, refs, me] = await Promise.all([
      pool.query(`SELECT DISTINCT to_char(date_trunc('week', created_at AT TIME ZONE '${ZONE}'), 'YYYY-MM-DD') AS wk FROM invite_requests WHERE user_id = $1 ORDER BY wk DESC`, [user.id]),
      pool.query(`SELECT count(*)::int AS n FROM invite_requests r WHERE r.user_id = $1 AND r.status = 'approved'
                  AND NOT EXISTS (SELECT 1 FROM invite_requests o WHERE o.party_id = r.party_id AND o.status = 'approved' AND o.created_at < r.created_at)`, [user.id]),
      pool.query(`SELECT count(*)::int AS n FROM invite_requests WHERE user_id = $1 AND status = 'approved'`, [user.id]),
      pool.query(`SELECT count(*)::int AS n FROM game_prizes WHERE user_id = $1`, [user.id]),
      pool.query(`SELECT count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS joined FROM users WHERE referred_by = $1`, [user.id]),
      pool.query(`SELECT created_at, email_opt_in, ref_reward_at, bonus_invites FROM users WHERE id = $1`, [user.id]),
    ]);
    // Weekends in a row with at least one invite, counting back from this week or last week.
    const set = new Set(weeks.rows.map((r) => r.wk));
    const monday = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
    const back = (iso, days) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - days); return x.toISOString().slice(0, 10); };
    let wk = monday(todayISO()), streak = 0;
    if (!set.has(wk)) wk = back(wk, 7);
    while (set.has(wk)) { streak++; wk = back(wk, 7); }
    const m = me.rows[0];
    const badges = [];
    if (streak >= 2) badges.push({ icon: '🔥', name: `${streak}-weekend streak`, about: 'Requested an invite this many weekends in a row' });
    if (firsts.rows[0].n) badges.push({ icon: '🥇', name: 'First on the list', about: `First approved guest at ${firsts.rows[0].n} part${firsts.rows[0].n === 1 ? 'y' : 'ies'}` });
    if (approved.rows[0].n >= 5) badges.push({ icon: '🎉', name: 'Party regular', about: `${approved.rows[0].n} approved invites` });
    if (prizes.rows[0].n) badges.push({ icon: '🕹️', name: 'Door Rush champion', about: `Won the weekly prize ${prizes.rows[0].n} time${prizes.rows[0].n === 1 ? '' : 's'}` });
    if (refs.rows[0].joined >= REFERRALS_NEEDED) badges.push({ icon: '🤝', name: 'Connector', about: `Brought ${refs.rows[0].joined} friends to PhatFrats` });
    if (user.plan === 'full') badges.push({ icon: '💎', name: 'Full Access', about: 'Unlimited invites and priority with hosts' });
    if (new Date(m.created_at) < new Date(FOUNDING_UNTIL + 'T05:00:00Z')) badges.push({ icon: '🌱', name: 'Founding member', about: 'Joined in PhatFrats\' first semester' });
    return {
      streak, badges, emailUpdates: m.email_opt_in, bonusInvites: m.bonus_invites,
      referral: { code: await referralCode(user.id), joined: refs.rows[0].joined, needed: REFERRALS_NEEDED, rewarded: !!m.ref_reward_at, link: `${SITE_URL}/?ref=` },
    };
  }

  // ---------- hooks on existing routes (run after the response, like the activity ticker) ----------
  function mountHooks(app) {
    const after = (res, fn) => res.on('finish', () => { if (res.statusCode < 300) fn().catch((err) => console.error('Community hook failed:', err.message)); });
    app.post('/api/signup', (req, res, next) => {
      const ref = typeof req.body?.ref === 'string' ? req.body.ref.trim().toUpperCase().slice(0, 12) : '';
      if (ref) after(res, () => pool.query(
        `UPDATE users SET referred_by = (SELECT id FROM users WHERE referral_code = $2 AND banned_at IS NULL)
         WHERE email = $1 AND referred_by IS NULL AND email <> coalesce((SELECT email FROM users WHERE referral_code = $2), '')`,
        [String(req.body.email || '').trim().toLowerCase(), ref]
      ));
      next();
    });
    app.get('/api/game/status', (req, res, next) => { awardDoorRushPrize().catch(() => {}); next(); });
    app.post('/api/verify', (req, res, next) => { after(res, async () => { if (req.user) await checkReferralReward(req.user.id); }); next(); });
    app.post('/api/requests', (req, res, next) => {
      const code = typeof req.body?.groupCode === 'string' ? req.body.groupCode : '';
      if (code) after(res, () => pool.query(
        `INSERT INTO group_members (code, user_id) SELECT g.code, $2 FROM party_groups g WHERE g.code = $1 AND g.party_id = $3 ON CONFLICT DO NOTHING`,
        [code, req.user?.id, req.body.partyId]
      ));
      next();
    });
    // A leader's answer reaches the student's bell (and inbox) right away.
    app.post('/api/chapter/requests/:id', (req, res, next) => {
      if (req.body?.status === 'approved' || req.body?.status === 'waitlist') after(res, async () => {
        const { rows: [r] } = await pool.query(`SELECT r.user_id, hp.title, hp.chapter_id FROM invite_requests r JOIN hosted_parties hp ON 'h' || hp.id = r.party_id WHERE r.id = $1`, [req.params.id]);
        if (!r) return;
        if (req.body.status === 'approved') await notify(r.user_id, 'approved', `✅ You're on the list for ${r.title} at ${chapterName(r.chapter_id)}!`, { link: '/#parties' });
        else await notify(r.user_id, 'waitlist', `${chapterName(r.chapter_id)} waitlisted you for ${r.title}. It's packed, but spots open up.`, { email: false });
      });
      next();
    });
    app.post('/api/chapter/guests/:id', (req, res, next) => {
      if (req.body?.status === 'approved') after(res, async () => {
        const { rows: [g] } = await pool.query('SELECT g.sponsor_id, g.name, hp.title FROM outside_guests g JOIN hosted_parties hp ON hp.id = g.party_id WHERE g.id = $1', [req.params.id]);
        if (g) await notify(g.sponsor_id, 'guest', `Your guest ${g.name} is on the list for ${g.title}.`, { email: false });
      });
      next();
    });
    app.post('/api/chapter/invites', (req, res, next) => {
      after(res, async () => {
        const { rows: [u] } = await pool.query('SELECT id FROM users WHERE email = $1', [String(req.body?.email || '').trim().toLowerCase()]);
        const party = await partyList.findParty(pool, 'h' + String(req.body?.partyId || '').replace(/^h/, ''), { includeTest: true, includePrivate: true });
        if (u && party) await notify(u.id, 'invited', `💌 ${req.user.name.split(' ')[0]} invited you to ${party.title}. You're on the list!`, { email: false });
      });
      next();
    });
  }

  // ---------- routes ----------
  const alertSources = [];
  function mountRoutes(app, requireVerified) {
    // Saved parties, for alerts when they start filling up.
    app.post('/api/saved', ...requireVerified, wrap(async (req, res) => {
      const id = req.body?.partyId;
      if (typeof id !== 'string' || !(await partyList.findParty(pool, id, { viewerId: req.user.id }))) return fail(res, 400, 'That party is not on the schedule.');
      if (req.body.on === false) await pool.query('DELETE FROM saved_parties WHERE user_id = $1 AND party_id = $2', [req.user.id, id]);
      else await pool.query('INSERT INTO saved_parties (user_id, party_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, id]);
      const { rows } = await pool.query('SELECT party_id FROM saved_parties WHERE user_id = $1', [req.user.id]);
      res.json({ saved: rows.map((r) => r.party_id) });
    }));

    // The bell: stored notes plus live alerts worked out on the spot.
    app.get('/api/notifications', ...requireVerified, wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      awardDoorRushPrize().catch(() => {});
      const [{ rows: notes }, { rows: saved }, { rows: [wk] }] = await Promise.all([
        pool.query('SELECT id, kind, text, link, read_at IS NOT NULL AS read, created_at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 30', [req.user.id]),
        pool.query('SELECT party_id FROM saved_parties WHERE user_id = $1', [req.user.id]),
        pool.query(`SELECT count(*) FILTER (WHERE created_at >= ${WEEK_START_SQL} AND invited_by IS NULL)::int AS this_week, count(*)::int AS ever FROM invite_requests WHERE user_id = $1`, [req.user.id]),
      ]);
      const alerts = [];
      const { rows: mine } = await pool.query('SELECT party_id FROM invite_requests WHERE user_id = $1', [req.user.id]);
      const asked = new Set(mine.map((r) => r.party_id));
      for (const s of saved) {
        if (asked.has(s.party_id)) continue;
        const p = await partyList.findParty(pool, s.party_id);
        if (p && p.going / p.cap >= .8) alerts.push({ kind: 'filling', text: `🔥 ${p.title} is ${Math.round(p.going / p.cap * 100)}% full. Request before it's gone!`, party: p.id });
      }
      if (req.user.plan !== 'full' && wk.ever > 0 && wk.this_week === 0) alerts.push({ kind: 'reset', text: '🎟️ Your free invite for this week is ready.' });
      if (req.user.on_trial) alerts.push({ kind: 'trial', text: `🎉 Your free Full Access weekend ends Sunday at midnight. Keep unlimited invites for ${PRICING.money(PRICING.current())} a ${PRICING.term}.` });
      // Other features (like friends) add their own live alerts.
      for (const source of alertSources) { try { alerts.push(...(await source(req.user))); } catch (err) { console.error('Alert source failed:', err.message); } }
      res.json({ alerts, notes, unread: notes.filter((n) => !n.read).length });
    }));
    app.post('/api/notifications/read', ...requireVerified, wrap(async (req, res) => {
      await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
      res.json({ ok: true });
    }));

    app.get('/api/profile', ...requireVerified, wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const { rows: saved } = await pool.query('SELECT party_id FROM saved_parties WHERE user_id = $1', [req.user.id]);
      res.json({ ...(await profile(req.user)), saved: saved.map((s) => s.party_id) });
    }));
    app.post('/api/profile/email', ...requireVerified, wrap(async (req, res) => {
      await pool.query('UPDATE users SET email_opt_in = $2 WHERE id = $1', [req.user.id, req.body?.on !== false]);
      res.json({ ok: true });
    }));

    // Group plans: one link for friends going together. Everyone still requests their own invite.
    const groupLimiter = limiter(30, 'Too many group links. Try again later.');
    app.post('/api/groups', ...requireVerified, groupLimiter, wrap(async (req, res) => {
      const party = typeof req.body?.partyId === 'string' ? await partyList.findParty(pool, req.body.partyId) : null;
      if (!party) return fail(res, 400, 'That party is not on the schedule.');
      const { rows: [had] } = await pool.query('SELECT code FROM party_groups WHERE owner_id = $1 AND party_id = $2', [req.user.id, party.id]);
      const code = had?.code || crypto.randomBytes(5).toString('base64url');
      if (!had) {
        await pool.query('INSERT INTO party_groups (code, party_id, owner_id) VALUES ($1, $2, $3)', [code, party.id, req.user.id]);
        await pool.query('INSERT INTO group_members (code, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [code, req.user.id]);
      }
      res.json({ code, link: `${SITE_URL}/?group=${code}` });
    }));
    app.get('/api/groups/:code', ...requireVerified, wrap(async (req, res) => {
      const { rows: [g] } = await pool.query(
        `SELECT g.code, g.party_id, u.name AS owner FROM party_groups g JOIN users u ON u.id = g.owner_id WHERE g.code = $1`,
        [String(req.params.code).slice(0, 20)]
      );
      if (!g) return fail(res, 404, 'That group link has expired.');
      const { rows: members } = await pool.query(
        `SELECT u.name, EXISTS (SELECT 1 FROM invite_requests r WHERE r.user_id = u.id AND r.party_id = $2) AS requested
         FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.code = $1 AND u.banned_at IS NULL ORDER BY m.joined_at`,
        [g.code, g.party_id]
      );
      res.json({ code: g.code, partyId: g.party_id, owner: g.owner.split(' ')[0], members: members.map((m) => ({ name: m.name.split(' ')[0], requested: m.requested })) });
    }));

    // Reports from the Party Smart kit go to the control room inbox.
    app.post('/api/report', ...requireVerified, limiter(10, 'Too many reports. If this is an emergency, call 911.'), wrap(async (req, res) => {
      const kind = ['party', 'person', 'safety', 'other'].includes(req.body?.kind) ? req.body.kind : 'other';
      const details = typeof req.body?.details === 'string' ? req.body.details.trim().slice(0, 1500) : '';
      if (details.length < 10) return fail(res, 400, 'Tell us a little more, at least a sentence.');
      const about = typeof req.body?.about === 'string' ? req.body.about.trim().slice(0, 120) : '';
      if (await isBlocked(req.user.email)) return res.status(201).json({ ok: true });
      await pool.query('INSERT INTO reports (reporter_id, kind, about, details) VALUES ($1, $2, $3, $4)', [req.user.id, kind, about, details]);
      res.status(201).json({ ok: true });
    }));

    // The About page's contact form. Open to everyone, so it's rate limited per network.
    app.post('/api/contact', limiter(5, 'Too many messages. Try again later.'), wrap(async (req, res) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 120) : '';
      const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';
      const kind = ['student', 'chapter', 'press', 'other'].includes(req.body?.kind) ? req.body.kind : 'other';
      if (!name) return fail(res, 400, 'Add your name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(res, 400, 'Add an email we can reply to.');
      if (message.length < 10) return fail(res, 400, 'Write a little more, at least a sentence.');
      if (await isBlocked(email)) return res.status(201).json({ ok: true });
      await pool.query('INSERT INTO contact_messages (name, email, kind, message) VALUES ($1, $2, $3, $4)', [name, email, kind, message]);
      res.status(201).json({ ok: true });
    }));
  }

  async function isBlocked(email) {
    const { rowCount } = await pool.query('SELECT 1 FROM inbox_blocks WHERE email = lower($1)', [email || '']);
    return rowCount > 0;
  }

  // ---------- control room: inbox, Weekend Drop, demo parties, prizes ----------
  function mountAdmin(app) {
    const requireAdmin = [requireUser, (req, res, next) => {
      if (req.user.role !== 'admin' || !req.user.admin_unlocked) return fail(res, 404, 'Not found.');
      res.set('Cache-Control', 'no-store');
      next();
    }];
    app.get('/api/admin/inbox', requireAdmin, wrap(async (req, res) => {
      const [reports, messages, prizes, s] = await Promise.all([
        pool.query(`SELECT r.id, r.kind, r.about, r.details, r.created_at, r.closed_at IS NOT NULL AS closed, r.status, r.reply, u.name, u.email
                    FROM reports r LEFT JOIN users u ON u.id = r.reporter_id ORDER BY r.closed_at IS NOT NULL, r.id DESC LIMIT 60`),
        pool.query(`SELECT id, name, email, kind, message, created_at, closed_at IS NOT NULL AS closed, status, reply FROM contact_messages ORDER BY closed_at IS NOT NULL, id DESC LIMIT 60`),
        pool.query(`SELECT p.week_start, p.score, u.name FROM game_prizes p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.week_start DESC LIMIT 10`),
        ops.settings(),
      ]);
      res.json({
        reports: reports.rows, messages: messages.rows,
        prizes: prizes.rows.map((p) => ({ week: p.week_start, score: p.score, name: p.name || 'Deleted account' })),
        hideDemo: !!s.hide_demo, lastDrop: s.last_drop || null,
      });
    }));
    // Each inbox item can be answered (Reply), set aside (Dismiss) or flagged as spam or abuse (Report).
    async function inboxItem(req, res) {
      const type = req.params.type;
      if (!['report', 'message'].includes(type) || !/^\d{1,18}$/.test(req.params.id)) { fail(res, 404, 'Not found.'); return null; }
      const { rows: [it] } = type === 'report'
        ? await pool.query(`SELECT r.id, r.reporter_id AS user_id, u.name, u.email FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.id = $1`, [req.params.id])
        : await pool.query('SELECT id, NULL::bigint AS user_id, name, email FROM contact_messages WHERE id = $1', [req.params.id]);
      if (!it) { fail(res, 404, 'That item is gone.'); return null; }
      return { ...it, table: type === 'report' ? 'reports' : 'contact_messages', type };
    }
    app.post('/api/admin/inbox/:type/:id/reply', requireAdmin, wrap(async (req, res) => {
      const it = await inboxItem(req, res); if (!it) return;
      const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 2000) : '';
      if (text.length < 2) return fail(res, 400, 'Write your reply first.');
      if (!it.email) return fail(res, 400, "That account was deleted, so there's no one to reply to.");
      const first = (it.name || '').split(' ')[0] || 'there';
      const what = it.type === 'report' ? 'your report' : 'your message';
      try {
        await sendMail(it.email, `Re: ${what} to PhatFrats`, `Hi ${first},\n\n${text}\n\nThe PhatFrats team\n${SITE_URL}`);
      } catch (err) {
        console.error('Inbox reply email failed:', err.message);
        return fail(res, 502, "The email didn't send. Try again in a minute.");
      }
      // Students who sent a report also see the answer in their bell.
      if (it.user_id) await pool.query('INSERT INTO notifications (user_id, kind, text) VALUES ($1, $2, $3)', [it.user_id, 'reply', `📬 The PhatFrats team answered your report: ${text}`.slice(0, 240)]);
      await pool.query(`UPDATE ${it.table} SET status = 'replied', reply = $2, closed_at = now() WHERE id = $1`, [it.id, text]);
      res.json({ ok: true });
    }));
    app.post('/api/admin/inbox/:type/:id/dismiss', requireAdmin, wrap(async (req, res) => {
      const it = await inboxItem(req, res); if (!it) return;
      await pool.query(`UPDATE ${it.table} SET status = 'dismissed', closed_at = now() WHERE id = $1`, [it.id]);
      res.json({ ok: true });
    }));
    app.post('/api/admin/inbox/:type/:id/report', requireAdmin, wrap(async (req, res) => {
      const it = await inboxItem(req, res); if (!it) return;
      await pool.query(`UPDATE ${it.table} SET status = 'reported', closed_at = now() WHERE id = $1`, [it.id]);
      if (it.email) {
        const email = it.email.toLowerCase();
        await pool.query('INSERT INTO inbox_blocks (email) VALUES ($1) ON CONFLICT DO NOTHING', [email]);
        // Anything else still open from the same sender goes with it.
        await pool.query(`UPDATE contact_messages SET status = 'reported', closed_at = now() WHERE lower(email) = $1 AND closed_at IS NULL`, [email]);
        await pool.query(`UPDATE reports r SET status = 'reported', closed_at = now() FROM users u WHERE u.id = r.reporter_id AND lower(u.email) = $1 AND r.closed_at IS NULL`, [email]);
      }
      res.json({ ok: true });
    }));
    app.post('/api/admin/inbox/unblock', requireAdmin, wrap(async (req, res) => {
      await pool.query('DELETE FROM inbox_blocks WHERE email = lower($1)', [String(req.body?.email || '')]);
      res.json({ ok: true });
    }));
    app.post('/api/admin/demo', requireAdmin, wrap(async (req, res) => {
      await ops.setSetting('hide_demo', req.body?.hide === true ? true : null);
      res.json({ ok: true });
    }));
    // The Weekend Drop: a note in everyone's bell, an email to everyone who wants them, and the beacon.
    app.post('/api/admin/weekend-drop', requireAdmin, wrap(async (req, res) => {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 300) : '';
      if (message.length < 5) return fail(res, 400, "Write what's dropping this weekend.");
      const { rowCount } = await pool.query(
        `INSERT INTO notifications (user_id, kind, text, link)
         SELECT id, 'drop', $1, '/#parties' FROM users WHERE email_verified_at IS NOT NULL AND banned_at IS NULL`,
        [`🔥 The Weekend Drop: ${message}`]
      );
      // Emails go out in small blind-copied batches, capped to stay under the sending account's daily limit.
      const { rows } = await pool.query(`SELECT email FROM users WHERE email_verified_at IS NOT NULL AND banned_at IS NULL AND email_opt_in ORDER BY id LIMIT 400`);
      let emailed = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50).map((r) => r.email);
        try {
          if (mailer) await mailer.sendMail({ from: `"PhatFrats" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`, to: process.env.EMAIL_FROM || process.env.SMTP_USER, bcc: batch, subject: '🔥 The Weekend Drop is live', text: `${message}\n\nSee the lineup: ${SITE_URL}/#parties\n\nTo stop these emails, open your profile on PhatFrats and switch off email updates.` });
          else if (!IS_PROD) console.log(`[dev only] Weekend Drop email to ${batch.length} people`);
          emailed += batch.length;
        } catch (err) { console.error('Weekend Drop email batch failed:', err.message); }
      }
      if (req.body?.beacon !== false) {
        await pool.query('UPDATE announcements SET active = FALSE WHERE active');
        await pool.query(`INSERT INTO announcements (text, tone, audience, ends_at, created_by) VALUES ($1, 'pink', 'all', now() + interval '3 days', $2)`, [`🔥 The Weekend Drop: ${message}`, req.user.id]);
      }
      await ops.setSetting('last_drop', { at: new Date().toISOString(), message, notified: rowCount, emailed });
      ops.activity('drop', 'The Weekend Drop went out');
      res.json({ notified: rowCount, emailed });
    }));
  }

  return { mountHooks, mountRoutes, mountAdmin, mountCron, awardDoorRushPrize, notify, profile, referralCode, addAlertSource: (fn) => alertSources.push(fn) };
}

module.exports = { create };
