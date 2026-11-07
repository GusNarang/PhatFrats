// The frat portal's API. A student joins their chapter with the chapter's password, then:
// - leaders post and edit parties, answer students' invite requests, and manage the member list;
// - every brother can personally invite people to the chapter's parties by Penn State email.
const { rateLimit } = require('express-rate-limit');
const CHAPTERS = require('./public/chapters.js');
const partyList = require('./party-list.js');

const chapterById = new Map(CHAPTERS.map((c) => [c.id, c]));
const VIBES = ['neon', 'theme', 'day', 'chill', 'formal', 'charity'];
const PSU_EMAIL = /^[a-z0-9._%+-]+@psu\.edu$/;
// Keeps one brother from flooding inboxes, and the site's email account under its daily sending limit.
const INVITES_PER_BROTHER_PER_PARTY = 20;
const SITE_URL = process.env.SITE_URL || 'https://phat-frats.vercel.app';

module.exports = function chapterRoutes(app, { pool, wrap, fail, requireVerified, authLimiter, hashPassword, verifyPassword, mailer, IS_PROD }) {
  const memberOf = async (userId) => {
    const { rows: [m] } = await pool.query('SELECT chapter_id, role FROM chapter_members WHERE user_id = $1', [userId]);
    return m || null;
  };
  const requireMember = [...requireVerified, wrap(async (req, res, next) => {
    req.member = await memberOf(req.user.id);
    if (!req.member) return fail(res, 403, 'Join your chapter first.', 'NOT_A_MEMBER');
    res.set('Cache-Control', 'no-store');
    next();
  })];
  const requireLeader = [...requireMember, (req, res, next) => {
    if (req.member.role !== 'leader') return fail(res, 403, 'Only your chapter leader can do that.', 'NOT_LEADER');
    next();
  }];
  const perUser = (limit, message) => rateLimit({
    windowMs: 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
    message: { error: message, code: 'RATE_LIMITED' },
  });
  const inviteLimiter = perUser(30, "You're sending invites too fast. Wait a minute.");
  const idParam = (v) => (/^\d{1,18}$/.test(String(v)) ? String(v) : null);
  const partyIdParam = (v) => (partyList.isHostedId(v) ? v.slice(1) : idParam(v));
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // "21:30" from a time picker becomes "9:30 PM".
  function niceTime(v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(typeof v === 'string' ? v.trim() : '');
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    const h = Number(m[1]);
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
  }
  // Checks a party form. Returns the clean values, or a message saying what to fix.
  function readParty(body) {
    const title = str(body?.title, 80);
    if (!title) return 'Give the party a name.';
    const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
    const today = partyList.todayISO();
    const last = partyList.addDays(today, partyList.DAYS_AHEAD);
    if (!date || date < today || date > last) {
      return `Pick a date between today and ${partyList.dayLabel(last).long}. Parties can be posted up to two weeks ahead.`;
    }
    const time = niceTime(body?.time);
    if (!time) return 'Pick a start time.';
    const vibe = VIBES.includes(body?.vibe) ? body.vibe : null;
    if (!vibe) return 'Pick a vibe.';
    const cap = Number(body?.cap);
    if (!Number.isInteger(cap) || cap < 1 || cap > 5000) return 'Set how many people can come, between 1 and 5000.';
    return { title, date, time, vibe, cap, blurb: str(body?.blurb, 500), dress: str(body?.dress, 80), music: str(body?.music, 80) };
  }

  async function sendInviteEmail({ to, brother, chapter, party }) {
    const when = `${partyList.dayLabel(party.day).long} at ${party.time}`;
    const text = `${brother} from ${chapter.name} invited you to "${party.title}" on ${when}.\n\n` +
      `You're already on the list. Log in to PhatFrats with this email (${to}) to see the details, or sign up with it if you're new:\n${SITE_URL}\n\n` +
      `If you don't know who this is, you can ignore this email.`;
    if (!mailer) {
      if (!IS_PROD) console.log(`[dev only] Invite email to ${to}:\n${text}`);
      return;
    }
    await mailer.sendMail({
      from: `"PhatFrats" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
      to,
      subject: `${brother} invited you to ${party.title}`,
      text,
    });
  }

  // ---------- what the portal shows ----------
  app.get('/api/chapter/me', ...requireVerified, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { rows: setUp } = await pool.query('SELECT chapter_id FROM chapter_accounts');
    const ready = new Set(setUp.map((r) => r.chapter_id));
    const chapters = CHAPTERS.map((c) => ({ id: c.id, name: c.name, gl: c.gl, ready: ready.has(c.id) }));
    const member = await memberOf(req.user.id);
    const me = { name: req.user.name, email: req.user.email };
    if (!member) return res.json({ me, chapters, membership: null });

    const ch = member.chapter_id;
    const leader = member.role === 'leader';
    const today = partyList.todayISO();
    const [parties, members, myInvites] = await Promise.all([
      pool.query(
        `SELECT hp.id, hp.title, to_char(hp.party_date, 'YYYY-MM-DD') AS day, hp.start_time, hp.vibe, hp.blurb, hp.dress,
           hp.music, hp.cap, hp.status, ${partyList.GOING_SQL} AS going,
           (SELECT count(*) FROM invite_requests r WHERE r.party_id = 'h' || hp.id AND r.invited_by IS NULL AND r.status = 'pending')::int AS waiting
         FROM hosted_parties hp WHERE hp.chapter_id = $1 AND hp.party_date >= $2::date - 30
         ORDER BY hp.party_date DESC, hp.id DESC`,
        [ch, today]
      ),
      pool.query(
        `SELECT u.id, u.name, u.email, m.role, m.joined_at,
           (SELECT count(*) FROM brother_invites b WHERE b.invited_by = u.id)::int AS invites
         FROM chapter_members m JOIN users u ON u.id = m.user_id
         WHERE m.chapter_id = $1 AND u.banned_at IS NULL ORDER BY m.role = 'leader' DESC, u.name`,
        [ch]
      ),
      pool.query(
        `SELECT b.id, 'h' || b.party_id AS party_id, b.email, b.guests, b.created_at,
           EXISTS (SELECT 1 FROM users u WHERE u.email = b.email) AS has_account
         FROM brother_invites b JOIN hosted_parties hp ON hp.id = b.party_id
         WHERE b.invited_by = $1 AND hp.chapter_id = $2 ORDER BY b.created_at DESC`,
        [req.user.id, ch]
      ),
    ]);

    const out = {
      me,
      chapters,
      membership: { chapter: chapters.find((c) => c.id === ch), address: chapterById.get(ch)?.addr || '', role: member.role },
      today,
      lastDay: partyList.addDays(today, partyList.DAYS_AHEAD),
      parties: parties.rows.map((p) => ({
        id: 'h' + p.id, title: p.title, day: p.day, dayText: partyList.dayLabel(p.day).long, time: p.start_time, vibe: p.vibe,
        blurb: p.blurb, dress: p.dress, music: p.music, cap: p.cap, status: p.status, going: p.going, waiting: p.waiting,
        past: p.day < today,
      })),
      members: members.rows.map((m) => ({
        id: String(m.id), name: m.name, role: m.role, joined: m.joined_at, invites: m.invites,
        ...(leader ? { email: m.email } : {}), you: String(m.id) === String(req.user.id),
      })),
      myInvites: myInvites.rows.map((b) => ({ id: String(b.id), partyId: b.party_id, email: b.email, guests: b.guests, sent: b.created_at, hasAccount: b.has_account })),
      invitesPerParty: INVITES_PER_BROTHER_PER_PARTY,
    };

    if (leader) {
      // Every student request and every brother invite for this chapter's parties, Full Access first.
      const [requests, allInvites] = await Promise.all([
        pool.query(
          `SELECT r.id, r.party_id, r.guests, r.note, r.status, r.priority, r.created_at, u.name, u.email, u.plan
           FROM invite_requests r
           JOIN users u ON u.id = r.user_id
           JOIN hosted_parties hp ON 'h' || hp.id = r.party_id
           WHERE hp.chapter_id = $1 AND r.invited_by IS NULL AND u.banned_at IS NULL
           ORDER BY r.priority DESC, r.created_at`,
          [ch]
        ),
        pool.query(
          `SELECT b.id, 'h' || b.party_id AS party_id, b.email, b.guests, b.created_at, inviter.name AS by_name
           FROM brother_invites b JOIN hosted_parties hp ON hp.id = b.party_id
           LEFT JOIN users inviter ON inviter.id = b.invited_by
           WHERE hp.chapter_id = $1 ORDER BY b.created_at DESC`,
          [ch]
        ),
      ]);
      out.requests = requests.rows.map((r) => ({
        id: String(r.id), partyId: r.party_id, name: r.name, email: r.email, full: r.plan === 'full', guests: r.guests,
        note: r.note, status: r.status, sent: r.created_at,
      }));
      out.allInvites = allInvites.rows.map((b) => ({ id: String(b.id), partyId: b.party_id, email: b.email, guests: b.guests, by: b.by_name || 'A former brother', sent: b.created_at }));
    }
    res.json(out);
  }));

  // ---------- joining and leaving ----------
  app.post('/api/chapter/join', authLimiter, ...requireVerified, wrap(async (req, res) => {
    const chapterId = Number(req.body?.chapterId);
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    if (!chapterById.has(chapterId)) return fail(res, 400, 'Pick your chapter.');
    if (await memberOf(req.user.id)) return fail(res, 409, "You're already in a chapter. Leave it first to join another.", 'ALREADY_MEMBER');
    const { rows: [acct] } = await pool.query('SELECT password_hash FROM chapter_accounts WHERE chapter_id = $1', [chapterId]);
    if (!acct) return fail(res, 400, "Your chapter isn't set up on PhatFrats yet. Ask your chapter leader to contact PhatFrats.", 'CHAPTER_NOT_READY');
    if (!password || !(await verifyPassword(password, acct.password_hash))) {
      return fail(res, 401, "That chapter password isn't right. Ask your chapter leader for it.", 'BAD_CHAPTER_PASSWORD');
    }
    await pool.query(`INSERT INTO chapter_members (user_id, chapter_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [req.user.id, chapterId]);
    res.json({ ok: true });
  }));

  app.post('/api/chapter/leave', ...requireMember, wrap(async (req, res) => {
    if (req.member.role === 'leader') {
      const { rows: [n] } = await pool.query(`SELECT count(*)::int AS n FROM chapter_members WHERE chapter_id = $1 AND role = 'leader'`, [req.member.chapter_id]);
      if (n.n <= 1) return fail(res, 400, "You're the only leader. Make another brother a leader first, so the chapter isn't left without one.", 'LAST_LEADER');
    }
    await pool.query('DELETE FROM chapter_members WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  }));

  // ---------- parties (leaders) ----------
  app.post('/api/chapter/parties', ...requireLeader, wrap(async (req, res) => {
    const p = readParty(req.body);
    if (typeof p === 'string') return fail(res, 400, p);
    const { rows: [row] } = await pool.query(
      `INSERT INTO hosted_parties (chapter_id, title, party_date, start_time, vibe, blurb, dress, music, cap, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [req.member.chapter_id, p.title, p.date, p.time, p.vibe, p.blurb, p.dress, p.music, p.cap, req.user.id]
    );
    res.status(201).json({ id: 'h' + row.id });
  }));

  app.post('/api/chapter/parties/:id', ...requireLeader, wrap(async (req, res) => {
    const id = partyIdParam(req.params.id);
    const p = readParty(req.body);
    if (!id) return fail(res, 400, 'That party id is not valid.');
    if (typeof p === 'string') return fail(res, 400, p);
    const { rowCount } = await pool.query(
      `UPDATE hosted_parties SET title = $3, party_date = $4, start_time = $5, vibe = $6, blurb = $7, dress = $8, music = $9,
         cap = $10, updated_at = now()
       WHERE id = $1 AND chapter_id = $2`,
      [id, req.member.chapter_id, p.title, p.date, p.time, p.vibe, p.blurb, p.dress, p.music, p.cap]
    );
    if (!rowCount) return fail(res, 404, "That party isn't one of your chapter's.");
    res.json({ ok: true });
  }));

  app.post('/api/chapter/parties/:id/status', ...requireLeader, wrap(async (req, res) => {
    const id = partyIdParam(req.params.id);
    const status = req.body?.status;
    if (!id || (status !== 'live' && status !== 'cancelled')) return fail(res, 400, 'Choose live or cancelled.');
    const { rowCount } = await pool.query(
      'UPDATE hosted_parties SET status = $3, updated_at = now() WHERE id = $1 AND chapter_id = $2',
      [id, req.member.chapter_id, status]
    );
    if (!rowCount) return fail(res, 404, "That party isn't one of your chapter's.");
    res.json({ ok: true });
  }));

  // ---------- answering students' requests (leaders) ----------
  app.post('/api/chapter/requests/:id', ...requireLeader, wrap(async (req, res) => {
    const id = idParam(req.params.id);
    const status = req.body?.status;
    if (!id || !['approved', 'waitlist', 'pending'].includes(status)) return fail(res, 400, 'Choose approve or waitlist.');
    const { rowCount } = await pool.query(
      `UPDATE invite_requests r SET status = $3 FROM hosted_parties hp
       WHERE r.id = $1 AND 'h' || hp.id = r.party_id AND hp.chapter_id = $2`,
      [id, req.member.chapter_id, status]
    );
    if (!rowCount) return fail(res, 404, "That request isn't for one of your chapter's parties.");
    res.json({ ok: true });
  }));

  // ---------- brothers' personal invites ----------
  app.post('/api/chapter/invites', ...requireMember, inviteLimiter, wrap(async (req, res) => {
    const partyId = partyIdParam(req.body?.partyId);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const guests = Number.isInteger(req.body?.guests) ? req.body.guests : 0;
    if (!partyId) return fail(res, 400, 'Pick a party.');
    if (!PSU_EMAIL.test(email)) return fail(res, 400, 'Use their Penn State email, like abc1234@psu.edu.');
    if (guests < 0 || guests > 3) return fail(res, 400, 'They can bring up to 3 plus-ones.');
    const party = await partyList.findParty(pool, 'h' + partyId);
    const { rows: [own] } = await pool.query('SELECT chapter_id FROM hosted_parties WHERE id = $1', [partyId]);
    if (!party || !own || own.chapter_id !== req.member.chapter_id) return fail(res, 400, "That party isn't open for invites. It may be cancelled or already over.");
    const { rows: [sent] } = await pool.query(
      'SELECT count(*)::int AS n FROM brother_invites WHERE party_id = $1 AND invited_by = $2',
      [partyId, req.user.id]
    );
    if (sent.n >= INVITES_PER_BROTHER_PER_PARTY) {
      return fail(res, 429, `You've used all ${INVITES_PER_BROTHER_PER_PARTY} of your invites for this party.`, 'INVITE_LIMIT');
    }
    const { rows: [made] } = await pool.query(
      `INSERT INTO brother_invites (party_id, email, guests, invited_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (party_id, email) DO NOTHING RETURNING id`,
      [partyId, email, guests, req.user.id]
    );
    if (!made) return fail(res, 409, 'Someone in your chapter already invited that person to this party.', 'ALREADY_INVITED');
    // If they already have an account, they're on the list right away.
    await pool.query(
      `INSERT INTO invite_requests (user_id, party_id, guests, note, status, priority, invited_by)
       SELECT u.id, $2, $3, '', 'approved', u.plan = 'full', $4 FROM users u WHERE u.email = $1
       ON CONFLICT (user_id, party_id) DO UPDATE SET status = 'approved', invited_by = EXCLUDED.invited_by`,
      [email, 'h' + partyId, guests, req.user.id]
    );
    let emailed = true;
    try {
      await sendInviteEmail({ to: email, brother: req.user.name, chapter: chapterById.get(req.member.chapter_id), party });
    } catch (err) {
      emailed = false;
      console.error('Invite email failed:', err.message);
    }
    res.status(201).json({ ok: true, emailed });
  }));

  app.post('/api/chapter/invites/:id/delete', ...requireMember, wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return fail(res, 400, 'That invite id is not valid.');
    const { rows: [gone] } = await pool.query(
      `DELETE FROM brother_invites b USING hosted_parties hp
       WHERE b.id = $1 AND hp.id = b.party_id AND hp.chapter_id = $2 AND (b.invited_by = $3 OR $4)
       RETURNING b.party_id, b.email`,
      [id, req.member.chapter_id, req.user.id, req.member.role === 'leader']
    );
    if (!gone) return fail(res, 404, "That invite isn't yours to take back.");
    // Takes them off the list too, unless they had asked on their own.
    await pool.query(
      `DELETE FROM invite_requests r USING users u
       WHERE r.user_id = u.id AND u.email = $2 AND r.party_id = 'h' || $1 AND r.invited_by IS NOT NULL`,
      [gone.party_id, gone.email]
    );
    res.json({ ok: true });
  }));

  // ---------- members (leaders) ----------
  app.post('/api/chapter/members/:id/role', ...requireLeader, wrap(async (req, res) => {
    const id = idParam(req.params.id);
    const role = req.body?.role;
    if (!id || (role !== 'leader' && role !== 'brother')) return fail(res, 400, 'Choose leader or brother.');
    if (id === String(req.user.id) && role === 'brother') {
      const { rows: [n] } = await pool.query(`SELECT count(*)::int AS n FROM chapter_members WHERE chapter_id = $1 AND role = 'leader'`, [req.member.chapter_id]);
      if (n.n <= 1) return fail(res, 400, "You're the only leader. Make someone else a leader first.", 'LAST_LEADER');
    }
    const { rowCount } = await pool.query('UPDATE chapter_members SET role = $3 WHERE user_id = $1 AND chapter_id = $2', [id, req.member.chapter_id, role]);
    if (!rowCount) return fail(res, 404, "That person isn't in your chapter.");
    res.json({ ok: true });
  }));

  app.post('/api/chapter/members/:id/remove', ...requireLeader, wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return fail(res, 400, 'That member id is not valid.');
    if (id === String(req.user.id)) return fail(res, 400, 'To leave the chapter yourself, use Leave chapter.');
    const { rowCount } = await pool.query('DELETE FROM chapter_members WHERE user_id = $1 AND chapter_id = $2', [id, req.member.chapter_id]);
    if (!rowCount) return fail(res, 404, "That person isn't in your chapter.");
    res.json({ ok: true });
  }));

  // Changing the password doesn't remove anyone. Remove members who left the chapter separately.
  app.post('/api/chapter/password', ...requireLeader, wrap(async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 8 || password.length > 200) return fail(res, 400, 'Use a chapter password with at least 8 characters.');
    await pool.query(
      'UPDATE chapter_accounts SET password_hash = $2, updated_at = now() WHERE chapter_id = $1',
      [req.member.chapter_id, await hashPassword(password)]
    );
    res.json({ ok: true });
  }));
};
