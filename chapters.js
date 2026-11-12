// The frat portal's API. A student joins their chapter with the chapter's password, then:
// - leaders post and edit parties, answer students' invite requests, and manage the member list;
// - every brother can personally invite people to the chapter's parties by Penn State email.
const { rateLimit } = require('express-rate-limit');
const { PgStore, nameFor } = require('./rate-store.js');
// The IFC chapters, plus practice chapters for trying the portal.
const IDENTITY = require('./data/chapter-identity.js');
const CHAPTERS = [...require('./public/chapters.js'), ...require('./data/test-chapters.js')];
const partyList = require('./party-list.js');

const chapterById = new Map(CHAPTERS.map((c) => [c.id, c]));
const VIBES = ['neon', 'theme', 'day', 'chill', 'formal', 'charity'];
const PSU_EMAIL = /^[a-z0-9._%+-]+@psu\.edu$/;
// Keeps one brother from flooding inboxes, and the site's email account under its daily sending limit.
const INVITES_PER_BROTHER_PER_PARTY = 20;
const SITE_URL = process.env.SITE_URL || 'https://phat-frats.vercel.app';

module.exports = function chapterRoutes(app, { pool, wrap, fail, requireVerified, authLimiter, hashPassword, verifyPassword, mailer, IS_PROD, guests, tickets }) {
  const memberOf = async (userId) => {
    const { rows: [m] } = await pool.query('SELECT chapter_id, role FROM chapter_members WHERE user_id = $1', [userId]);
    return m || null;
  };
  // The site admin can open any chapter's portal from the control room, acting as a leader there.
  // It only works while the admin's control room is unlocked, and the page asks for it with this header.
  const adminView = (req) => {
    const id = Number(req.get('x-pf-chapter'));
    if (!id || !chapterById.has(id) || req.user.role !== 'admin' || !req.user.admin_unlocked) return null;
    return { chapter_id: id, role: 'leader', admin: true };
  };
  const requireMember = [...requireVerified, wrap(async (req, res, next) => {
    // Asking for another chapter without an unlocked control room is refused, never quietly sent to your own chapter.
    if (req.get('x-pf-chapter') && !adminView(req)) {
      return fail(res, 403, 'Open this chapter from the control room, and keep the control room open while you use it.', 'ADMIN_LOCKED');
    }
    req.member = adminView(req) || await memberOf(req.user.id);
    if (!req.member) return fail(res, 403, 'Join your chapter first.', 'NOT_A_MEMBER');
    if (!req.member.admin) {
      const ban = await banOf(req.member.chapter_id);
      if (ban) return fail(res, 403, bannedMessage(ban), 'CHAPTER_BANNED');
    }
    res.set('Cache-Control', 'no-store');
    next();
  })];
  // A banned chapter: its row in chapter_bans, or null.
  async function banOf(chapterId) {
    const { rows: [b] } = await pool.query('SELECT reason, banned_at FROM chapter_bans WHERE chapter_id = $1', [chapterId]);
    return b || null;
  }
  const bannedMessage = (b) => 'This chapter is suspended from PhatFrats' + (b.reason ? ': ' + b.reason : '.') +
    (b.reason && !/[.!?]$/.test(b.reason) ? '.' : '') + ' Its parties are off the map and the chapter tools are locked. To appeal, contact the PhatFrats team from the About page.';

  // The chapter's look: national colors and founding, plus anything its leaders customized.
  async function chapterIdentity(id) {
    const base = IDENTITY[id] || { colors: [], founded: null };
    const { rows: [p] } = await pool.query('SELECT tagline, about, color1, color2 FROM chapter_profiles WHERE chapter_id = $1', [id]);
    const custom = p && p.color1 && p.color2;
    return {
      colors: base.colors,
      theme: custom ? [p.color1, p.color2] : base.colors.map((c) => c.hex),
      customColors: !!custom,
      founded: base.founded || null,
      kind: base.kind || '',
      tagline: p?.tagline || '',
      about: p?.about || '',
    };
  }

  const requireLeader = [...requireMember, (req, res, next) => {
    if (req.member.role !== 'leader') return fail(res, 403, 'Only your chapter leader can do that.', 'NOT_LEADER');
    next();
  }];
  const perUser = (limit, message) => rateLimit({
    windowMs: 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false,
    store: new PgStore(pool, nameFor('chapters', limit, message)), passOnStoreError: true,
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
    return {
      title, date, time, vibe, cap, blurb: str(body?.blurb, 500), dress: str(body?.dress, 80), music: str(body?.music, 80),
      // Off unless the leader switches it on: lets each guest-list member bring one person from outside Penn State.
      allowGuests: body?.allowGuests === true,
      // On means friends never see who's going to this party.
      hideFriends: body?.hideFriends === true,
    };
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
    const { rows: setUp } = await pool.query(
      'SELECT chapter_id, password_hash IS NOT NULL AS brother, leader_password_hash IS NOT NULL AS leader FROM chapter_accounts'
    );
    const ready = new Map(setUp.map((r) => [r.chapter_id, r]));
    const { rows: bans } = await pool.query('SELECT chapter_id FROM chapter_bans');
    const bannedIds = new Set(bans.map((b) => b.chapter_id));
    // ready: brothers can join. leaderReady: the leader sign-in works.
    const chapters = CHAPTERS.map((c) => ({
      id: c.id, name: c.name, gl: c.gl, test: !!c.test,
      ready: !!ready.get(c.id)?.brother && !bannedIds.has(c.id), leaderReady: !!ready.get(c.id)?.leader && !bannedIds.has(c.id),
    }));
    if (req.get('x-pf-chapter') && !adminView(req)) {
      return fail(res, 403, 'Open this chapter from the control room, and keep the control room open while you use it.', 'ADMIN_LOCKED');
    }
    const member = adminView(req) || await memberOf(req.user.id);
    const me = { name: req.user.name, email: req.user.email };
    if (!member) return res.json({ me, chapters, membership: null });

    const ch = member.chapter_id;
    const leader = member.role === 'leader';
    const today = partyList.todayISO();
    const [parties, members, myInvites, myGuests] = await Promise.all([
      pool.query(
        `SELECT hp.id, hp.title, to_char(hp.party_date, 'YYYY-MM-DD') AS day, hp.start_time, hp.vibe, hp.blurb, hp.dress,
           hp.music, hp.cap, hp.status, hp.allow_outside_guests, hp.hide_friends, ${partyList.GOING_SQL} AS going,
           hp.ticketed, hp.ticket_cents, hp.ticket_kind, hp.ticket_cause,
           (SELECT count(*) FROM invite_requests r WHERE r.party_id = 'h' || hp.id AND r.invited_by IS NULL AND r.status = 'pending')::int
             + (SELECT count(*) FROM outside_guests g WHERE g.party_id = hp.id AND g.status = 'pending')::int AS waiting,
           (SELECT count(*) FROM outside_guests g WHERE g.party_id = hp.id AND g.status = 'approved')::int AS outside
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
        `SELECT b.id, 'h' || b.party_id AS party_id, b.email, b.created_at,
           EXISTS (SELECT 1 FROM users u WHERE u.email = b.email) AS has_account
         FROM brother_invites b JOIN hosted_parties hp ON hp.id = b.party_id
         WHERE b.invited_by = $1 AND hp.chapter_id = $2 ORDER BY b.created_at DESC`,
        [req.user.id, ch]
      ),
      pool.query(
        `SELECT g.id, 'h' || g.party_id AS party_id, g.name, g.email, g.phone, g.status, g.created_at
         FROM outside_guests g JOIN hosted_parties hp ON hp.id = g.party_id
         WHERE g.sponsor_id = $1 AND hp.chapter_id = $2 ORDER BY g.created_at DESC`,
        [req.user.id, ch]
      ),
    ]);

    const out = {
      me,
      chapters,
      membership: {
        chapter: chapters.find((c) => c.id === ch), address: chapterById.get(ch)?.addr || '', role: member.role, adminView: !!member.admin,
        nick: chapterById.get(ch)?.nick || '', instagram: chapterById.get(ch)?.ig || '',
        banned: member.admin ? null : await banOf(ch).then((b) => (b ? bannedMessage(b) : null)),
      },
      identity: await chapterIdentity(ch),
      today,
      lastDay: partyList.addDays(today, partyList.DAYS_AHEAD),
      parties: parties.rows.map((p) => ({
        id: 'h' + p.id, title: p.title, day: p.day, dayText: partyList.dayLabel(p.day).long, time: p.start_time, vibe: p.vibe,
        blurb: p.blurb, dress: p.dress, music: p.music, cap: p.cap, status: p.status, going: p.going, waiting: p.waiting,
        allowGuests: p.allow_outside_guests, hideFriends: p.hide_friends, outside: p.outside, past: p.day < today,
        ticketed: p.ticketed, price: p.ticket_cents, ticketKind: p.ticket_kind, cause: p.ticket_cause,
      })),
      members: members.rows.map((m) => ({
        id: String(m.id), name: m.name, role: m.role, joined: m.joined_at, invites: m.invites,
        ...(leader ? { email: m.email } : {}), you: String(m.id) === String(req.user.id),
      })),
      myInvites: myInvites.rows.map((b) => ({ id: String(b.id), partyId: b.party_id, email: b.email, sent: b.created_at, hasAccount: b.has_account })),
      invitesPerParty: INVITES_PER_BROTHER_PER_PARTY,
      myGuests: myGuests.rows.map((g) => ({
        id: String(g.id), partyId: g.party_id, name: g.name, contact: g.email || guests.prettyPhone(g.phone), status: g.status, sent: g.created_at,
      })),
    };

    if (leader) {
      // Every student request and every brother invite for this chapter's parties, Full Access first.
      const [requests, allInvites, allGuests] = await Promise.all([
        pool.query(
          `SELECT r.id, r.party_id, r.note, r.status, r.priority, r.created_at, u.name, u.email, u.plan
           FROM invite_requests r
           JOIN users u ON u.id = r.user_id
           JOIN hosted_parties hp ON 'h' || hp.id = r.party_id
           WHERE hp.chapter_id = $1 AND r.invited_by IS NULL AND u.banned_at IS NULL
           ORDER BY r.priority DESC, r.created_at`,
          [ch]
        ),
        pool.query(
          `SELECT b.id, 'h' || b.party_id AS party_id, b.email, b.created_at, inviter.name AS by_name
           FROM brother_invites b JOIN hosted_parties hp ON hp.id = b.party_id
           LEFT JOIN users inviter ON inviter.id = b.invited_by
           WHERE hp.chapter_id = $1 ORDER BY b.created_at DESC`,
          [ch]
        ),
        // Outside guests, with who vouched for each and whether that person is a brother or a student.
        pool.query(
          `SELECT g.id, 'h' || g.party_id AS party_id, g.name, g.email, g.phone, g.status, g.created_at,
             s.name AS sponsor, s.email AS sponsor_email, m.chapter_id = hp.chapter_id AS by_brother
           FROM outside_guests g JOIN hosted_parties hp ON hp.id = g.party_id JOIN users s ON s.id = g.sponsor_id
           LEFT JOIN chapter_members m ON m.user_id = g.sponsor_id
           WHERE hp.chapter_id = $1 AND s.banned_at IS NULL ORDER BY g.status = 'pending' DESC, g.created_at`,
          [ch]
        ),
      ]);
      out.requests = requests.rows.map((r) => ({
        id: String(r.id), partyId: r.party_id, name: r.name, email: r.email, full: r.plan === 'full',
        note: r.note, status: r.status, sent: r.created_at,
      }));
      out.allInvites = allInvites.rows.map((b) => ({ id: String(b.id), partyId: b.party_id, email: b.email, by: b.by_name || 'A former brother', sent: b.created_at }));
      out.guests = allGuests.rows.map((g) => ({
        id: String(g.id), partyId: g.party_id, name: g.name, contact: g.email || guests.prettyPhone(g.phone), status: g.status,
        sponsor: g.sponsor, sponsorEmail: g.sponsor_email, byBrother: !!g.by_brother, sent: g.created_at,
      }));
    }
    res.json(out);
  }));

  // ---------- joining and leaving ----------
  app.post('/api/chapter/join', authLimiter, ...requireVerified, wrap(async (req, res) => {
    const chapterId = Number(req.body?.chapterId);
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    if (!chapterById.has(chapterId)) return fail(res, 400, 'Pick your chapter.');
    if (await memberOf(req.user.id)) return fail(res, 409, "You're already in a chapter. Leave it first to join another.", 'ALREADY_MEMBER');
    const joinBan = await banOf(chapterId);
    if (joinBan) return fail(res, 403, bannedMessage(joinBan), 'CHAPTER_BANNED');
    const { rows: [acct] } = await pool.query('SELECT password_hash FROM chapter_accounts WHERE chapter_id = $1', [chapterId]);
    if (!acct?.password_hash) return fail(res, 400, "Your chapter isn't set up on PhatFrats yet. Ask your chapter leader to contact PhatFrats.", 'CHAPTER_NOT_READY');
    if (!password || !(await verifyPassword(password, acct.password_hash))) {
      return fail(res, 401, "That chapter password isn't right. Ask your chapter leader for it.", 'BAD_CHAPTER_PASSWORD');
    }
    await pool.query(`INSERT INTO chapter_members (user_id, chapter_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [req.user.id, chapterId]);
    res.json({ ok: true });
  }));

  // Chapter leader sign-in: the leader password makes this account a leader of the chapter.
  app.post('/api/chapter/leader-login', authLimiter, ...requireVerified, wrap(async (req, res) => {
    const chapterId = Number(req.body?.chapterId);
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    if (!chapterById.has(chapterId)) return fail(res, 400, 'Pick your chapter.');
    const leadBan = await banOf(chapterId);
    if (leadBan) return fail(res, 403, bannedMessage(leadBan), 'CHAPTER_BANNED');
    const { rows: [acct] } = await pool.query('SELECT leader_password_hash FROM chapter_accounts WHERE chapter_id = $1', [chapterId]);
    if (!acct?.leader_password_hash) {
      return fail(res, 400, "Leader sign-in isn't set up for this chapter yet. Contact PhatFrats to get your leader password.", 'LEADER_NOT_READY');
    }
    if (!password || !(await verifyPassword(password, acct.leader_password_hash))) {
      return fail(res, 401, "That leader password isn't right.", 'BAD_LEADER_PASSWORD');
    }
    const current = await memberOf(req.user.id);
    if (current && current.chapter_id !== chapterId) {
      return fail(res, 409, "You're in a different chapter. Leave it first, then sign in as this chapter's leader.", 'ALREADY_MEMBER');
    }
    await pool.query(
      `INSERT INTO chapter_members (user_id, chapter_id, role) VALUES ($1, $2, 'leader')
       ON CONFLICT (user_id) DO UPDATE SET role = 'leader'`,
      [req.user.id, chapterId]
    );
    res.json({ ok: true });
  }));

  // Anyone can leave, including the last leader. A chapter left without a leader keeps its brothers,
  // parties and passwords, and a new leader can sign in with the leader password.
  // Leaders (and the admin) can give the chapter page its own tagline, story and colors.
  app.post('/api/chapter/profile', ...requireLeader, wrap(async (req, res) => {
    const tagline = str(req.body?.tagline, 90);
    const about = str(req.body?.about, 700);
    const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
    const reset = req.body?.resetColors === true;
    const c1 = reset ? null : hex(req.body?.color1), c2 = reset ? null : hex(req.body?.color2);
    if (!reset && (req.body?.color1 || req.body?.color2) && (!c1 || !c2)) return fail(res, 400, 'Pick both colors.');
    await pool.query(
      `INSERT INTO chapter_profiles (chapter_id, tagline, about, color1, color2, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (chapter_id) DO UPDATE SET tagline = EXCLUDED.tagline, about = EXCLUDED.about,
         color1 = EXCLUDED.color1, color2 = EXCLUDED.color2, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [req.member.chapter_id, tagline, about, c1, c2, req.user.id]
    );
    res.json({ identity: await chapterIdentity(req.member.chapter_id) });
  }));

  app.post('/api/chapter/leave', ...requireMember, wrap(async (req, res) => {
    if (req.member.admin) return fail(res, 400, "You're viewing this chapter as the admin, so there's nothing to leave.");
    await pool.query('DELETE FROM chapter_members WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  }));

  // ---------- parties (leaders) ----------
  app.post('/api/chapter/parties', ...requireLeader, wrap(async (req, res) => {
    const p = readParty(req.body);
    if (typeof p === 'string') return fail(res, 400, p);
    const { rows: [row] } = await pool.query(
      `INSERT INTO hosted_parties (chapter_id, title, party_date, start_time, vibe, blurb, dress, music, cap, created_by, allow_outside_guests, hide_friends)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [req.member.chapter_id, p.title, p.date, p.time, p.vibe, p.blurb, p.dress, p.music, p.cap, req.user.id, p.allowGuests, p.hideFriends]
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
         cap = $10, allow_outside_guests = $11, hide_friends = $12, updated_at = now()
       WHERE id = $1 AND chapter_id = $2`,
      [id, req.member.chapter_id, p.title, p.date, p.time, p.vibe, p.blurb, p.dress, p.music, p.cap, p.allowGuests, p.hideFriends]
    );
    if (!rowCount) return fail(res, 404, "That party isn't one of your chapter's.");
    await pool.query('UPDATE friend_going SET party_day = $2 WHERE party_id = $1', ['h' + id, p.date]);
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
    // Cancelling a ticketed event refunds everyone who bought a ticket.
    const refunded = status === 'cancelled' && tickets ? await tickets.refundParty('h' + id) : 0;
    res.json({ ok: true, refunded });
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
    if (!partyId) return fail(res, 400, 'Pick a party.');
    if (!PSU_EMAIL.test(email)) return fail(res, 400, 'Use their Penn State email, like abc1234@psu.edu.');
    const party = await partyList.findParty(pool, 'h' + partyId, { includeTest: true });
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
      `INSERT INTO brother_invites (party_id, email, invited_by) VALUES ($1, $2, $3)
       ON CONFLICT (party_id, email) DO NOTHING RETURNING id`,
      [partyId, email, req.user.id]
    );
    if (!made) return fail(res, 409, 'Someone in your chapter already invited that person to this party.', 'ALREADY_INVITED');
    // If they already have an account, they're on the list right away.
    await pool.query(
      `INSERT INTO invite_requests (user_id, party_id, note, status, priority, invited_by)
       SELECT u.id, $2, '', 'approved', u.plan = 'full', $3 FROM users u WHERE u.email = $1
       ON CONFLICT (user_id, party_id) DO UPDATE SET status = 'approved', invited_by = EXCLUDED.invited_by`,
      [email, 'h' + partyId, req.user.id]
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

  // ---------- outside guests ----------
  // Emails a guest once they're approved, if they gave an email. Returns whether an email went out.
  async function notifyGuest(guestId) {
    const { rows: [g] } = await pool.query(
      `SELECT g.id, g.name, g.email, g.notified_at, s.name AS sponsor, hp.chapter_id, hp.title, hp.start_time,
         to_char(hp.party_date, 'YYYY-MM-DD') AS day
       FROM outside_guests g JOIN users s ON s.id = g.sponsor_id JOIN hosted_parties hp ON hp.id = g.party_id
       WHERE g.id = $1 AND g.status = 'approved'`,
      [guestId]
    );
    if (!g || !g.email || g.notified_at) return false;
    try {
      await guests.sendGuestEmail(mailer, {
        to: g.email, guest: g.name, sponsor: g.sponsor, chapter: chapterById.get(g.chapter_id),
        party: { title: g.title, day: g.day, time: g.start_time }, IS_PROD,
      });
      await pool.query('UPDATE outside_guests SET notified_at = now() WHERE id = $1', [g.id]);
      return true;
    } catch (err) {
      console.error('Outside guest email failed:', err.message);
      return false;
    }
  }

  // A brother adds one outside guest of their own. Brothers vouch for their guests, so they go straight on the list.
  app.post('/api/chapter/guests', ...requireMember, inviteLimiter, wrap(async (req, res) => {
    const partyId = partyIdParam(req.body?.partyId);
    if (!partyId) return fail(res, 400, 'Pick a party.');
    const party = await partyList.findParty(pool, 'h' + partyId, { includeTest: true });
    const { rows: [own] } = await pool.query('SELECT chapter_id, allow_outside_guests FROM hosted_parties WHERE id = $1', [partyId]);
    if (!party || !own || own.chapter_id !== req.member.chapter_id) return fail(res, 400, "That party isn't open for invites. It may be cancelled or already over.");
    if (!own.allow_outside_guests) return fail(res, 403, "This party isn't taking outside guests. Your chapter leader can switch them on.", 'GUESTS_OFF');
    const guest = guests.readGuest(req.body);
    if (typeof guest === 'string') return fail(res, 400, guest);
    const { rows: [made] } = await pool.query(
      `INSERT INTO outside_guests (party_id, sponsor_id, name, email, phone, status) VALUES ($1, $2, $3, $4, $5, 'approved')
       ON CONFLICT (party_id, sponsor_id) DO NOTHING RETURNING id`,
      [partyId, req.user.id, guest.name, guest.email, guest.phone]
    );
    if (!made) return fail(res, 409, "You've already added an outside guest to this party. Each person can bring one.", 'GUEST_TAKEN');
    const emailed = await notifyGuest(made.id);
    res.status(201).json({ ok: true, emailed });
  }));

  // The sponsor, or a leader, can take a guest off the list.
  app.post('/api/chapter/guests/:id/delete', ...requireMember, wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return fail(res, 400, 'That guest id is not valid.');
    const { rowCount } = await pool.query(
      `DELETE FROM outside_guests g USING hosted_parties hp
       WHERE g.id = $1 AND hp.id = g.party_id AND hp.chapter_id = $2 AND (g.sponsor_id = $3 OR $4)`,
      [id, req.member.chapter_id, req.user.id, req.member.role === 'leader']
    );
    if (!rowCount) return fail(res, 404, "That guest isn't yours to remove.");
    res.json({ ok: true });
  }));

  // Leaders approve or waitlist students' outside guests. Approving emails the guest.
  app.post('/api/chapter/guests/:id', ...requireLeader, wrap(async (req, res) => {
    const id = idParam(req.params.id);
    const status = req.body?.status;
    if (!id || !['approved', 'waitlist', 'pending'].includes(status)) return fail(res, 400, 'Choose approve or waitlist.');
    const { rowCount } = await pool.query(
      `UPDATE outside_guests g SET status = $3 FROM hosted_parties hp
       WHERE g.id = $1 AND hp.id = g.party_id AND hp.chapter_id = $2`,
      [id, req.member.chapter_id, status]
    );
    if (!rowCount) return fail(res, 404, "That guest isn't for one of your chapter's parties.");
    const emailed = status === 'approved' ? await notifyGuest(id) : false;
    res.json({ ok: true, emailed });
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

  // Changes the brother password, or with kind 'leader', the leader password.
  // Changing a password doesn't remove anyone. Remove members who left the chapter separately.
  app.post('/api/chapter/password', ...requireLeader, wrap(async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const column = req.body?.kind === 'leader' ? 'leader_password_hash' : 'password_hash';
    if (password.length < 8 || password.length > 200) return fail(res, 400, 'Use a password with at least 8 characters.');
    await pool.query(
      `INSERT INTO chapter_accounts (chapter_id, ${column}) VALUES ($1, $2)
       ON CONFLICT (chapter_id) DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = now()`,
      [req.member.chapter_id, await hashPassword(password)]
    );
    res.json({ ok: true });
  }));
  // Ticketed events: payouts, selling tickets for an event, and checking tickets at the door.
  if (tickets) tickets.mount(app, { requireMember, requireLeader });
};
