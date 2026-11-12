// Sororities on PhatFrats. Sisters join their sorority with the sister password and chairs sign in with
// the chair password, just like brothers and leaders in the frat portal (chapters.js).
// A frat's leaders can send a group invite to a whole sorority: every sister is then on that party's list
// (even an invite-only party) without requesting, and the sorority's chairs can turn it down for the house.
const SORORITIES = require('./public/sororities.js');
const partyList = require('./party-list.js');
const CHAPTERS = [...require('./public/chapters.js'), ...require('./data/test-chapters.js')];
const IDENTITY = require('./data/sorority-identity.js');
// The house emojis chairs can pick for their page. It floats in the banner and rains down with the confetti.
const EMOJIS = ['💗', '🎀', '🌸', '🌹', '🌷', '🦋', '✨', '💎', '👑', '🕊️', '🦁', '🦉', '⚓', '🔑', '🌙', '⭐', '🐢', '🐼', '🐬', '🏹', '🪁', '🐚', '🌻', '🍒'];

const sororityById = new Map(SORORITIES.map((s) => [s.id, s]));
const chapterById = new Map(CHAPTERS.map((c) => [c.id, c]));

function create({ pool, wrap, fail, requireUser, requireVerified, authLimiter, hashPassword, verifyPassword }) {
  const idParam = (v) => (/^\d{1,18}$/.test(String(v)) ? String(v) : null);
  const memberOf = async (userId) => {
    const { rows: [m] } = await pool.query('SELECT sorority_id, role FROM sorority_members WHERE user_id = $1', [userId]);
    return m || null;
  };
  // The site admin opens any sorority's portal from the control room (with an unlocked control room), acting as a chair.
  const adminView = (req) => {
    const id = Number(req.get('x-pf-sorority'));
    if (!id || !sororityById.has(id) || req.user.role !== 'admin' || !req.user.admin_unlocked) return null;
    return { sorority_id: id, role: 'chair', admin: true };
  };
  const ADMIN_LOCKED = 'Open this sorority from the control room, and keep the control room open while you use it.';
  const requireSister = [...requireVerified, wrap(async (req, res, next) => {
    if (req.get('x-pf-sorority') && !adminView(req)) return fail(res, 403, ADMIN_LOCKED, 'ADMIN_LOCKED');
    req.sister = adminView(req) || await memberOf(req.user.id);
    if (!req.sister) return fail(res, 403, 'Join your sorority first.', 'NOT_A_SISTER');
    res.set('Cache-Control', 'no-store');
    next();
  })];
  const requireChair = [...requireSister, (req, res, next) => {
    if (req.sister.role !== 'chair') return fail(res, 403, 'Only your sorority chairs can do that.', 'NOT_CHAIR');
    next();
  }];
  const requireAdmin = [requireUser, (req, res, next) => {
    if (req.user.role !== 'admin' || !req.user.admin_unlocked) return fail(res, 404, 'Not found.');
    res.set('Cache-Control', 'no-store');
    next();
  }];

  // ---------- the list ----------
  // Puts a sister on the list of every upcoming party her sorority is invited to. Called whenever her account
  // loads its requests (server.js listRequests), so sisters who join later are on the list too.
  async function claim(user) {
    await pool.query(
      `INSERT INTO invite_requests (user_id, party_id, note, status, priority, invited_by, via_sorority)
       SELECT $1, 'h' || si.party_id, '', 'approved', $2, si.invited_by, si.sorority_id
       FROM sorority_invites si
       JOIN sorority_members sm ON sm.sorority_id = si.sorority_id AND sm.user_id = $1
       JOIN hosted_parties hp ON hp.id = si.party_id
       WHERE si.status = 'active' AND hp.status = 'live' AND hp.party_date >= $3::date
       ON CONFLICT (user_id, party_id) DO UPDATE SET status = 'approved', invited_by = EXCLUDED.invited_by, via_sorority = EXCLUDED.via_sorority
         WHERE invite_requests.status <> 'approved'`,
      [user.id, user.plan === 'full', partyList.todayISO()]
    );
  }
  // Takes sisters' spots back off a list: for one party, or for one sister (when she leaves or is removed).
  async function dropSpots(sororityId, { partyId = null, userId = null } = {}) {
    await pool.query(
      `DELETE FROM invite_requests WHERE via_sorority = $1 AND ($2::text IS NULL OR party_id = $2) AND ($3::bigint IS NULL OR user_id = $3)`,
      [sororityId, partyId, userId]
    );
  }
  // The sorority's look: national colors and facts, plus whatever its chairs customized.
  async function identity(sid) {
    const base = IDENTITY[sid] || { colors: [] };
    const { rows: [p] } = await pool.query(
      `SELECT sp.*, u.name AS announcement_name FROM sorority_profiles sp LEFT JOIN users u ON u.id = sp.announcement_by WHERE sp.sorority_id = $1`, [sid]
    );
    const custom = !!(p && p.color1 && p.color2);
    return {
      colors: base.colors, kind: base.kind || 'Sorority', founded: base.founded || null, flower: base.flower || '', symbol: base.symbol || '',
      theme: custom ? [p.color1, p.color2] : base.colors.map((c) => c.hex), customColors: custom,
      tagline: p?.tagline || '', about: p?.about || '', emoji: p?.emoji || '',
      announcement: p?.announcement ? { text: p.announcement, at: p.announcement_at, by: p.announcement_name || 'A chair' } : null,
    };
  }

  // A sorority's upcoming invites, with the party and how many sisters are on its list so far.
  async function invitesFor(sororityId, userId = null) {
    const { rows } = await pool.query(
      `SELECT si.id, si.status, si.note, si.created_at, 'h' || hp.id AS party_id, hp.title, hp.chapter_id, hp.vibe, hp.start_time,
         to_char(hp.party_date, 'YYYY-MM-DD') AS day, hp.invite_only, u.name AS by_name,
         (SELECT count(*) FROM invite_requests r WHERE r.party_id = 'h' || hp.id AND r.via_sorority = si.sorority_id)::int AS on_list
       FROM sorority_invites si JOIN hosted_parties hp ON hp.id = si.party_id LEFT JOIN users u ON u.id = si.invited_by
       WHERE si.sorority_id = $1 AND hp.status = 'live' AND hp.party_date >= $2::date
       ORDER BY hp.party_date, hp.id`,
      [sororityId, partyList.todayISO()]
    );
    // Who tapped "I'm going" on each invite (current sisters only).
    const { rows: going } = rows.length ? await pool.query(
      `SELECT v.invite_id, v.user_id, u.name FROM sorority_rsvps v JOIN users u ON u.id = v.user_id
       JOIN sorority_members m ON m.user_id = v.user_id AND m.sorority_id = $2
       WHERE v.invite_id = ANY($1::bigint[]) ORDER BY v.created_at`,
      [rows.map((r) => r.id), sororityId]
    ) : { rows: [] };
    const goingFor = (id) => going.filter((g) => String(g.invite_id) === String(id));
    return rows.map((r) => ({
      going: goingFor(r.id).length, goingMe: goingFor(r.id).some((g) => String(g.user_id) === String(userId)),
      goingNames: goingFor(r.id).slice(0, 12).map((g) => g.name.split(' ')[0]),
      id: String(r.id), status: r.status, note: r.note, sent: r.created_at, partyId: r.party_id, title: r.title,
      chapter: chapterById.get(r.chapter_id)?.name || 'A chapter', gl: chapterById.get(r.chapter_id)?.gl || '',
      day: r.day, dayText: partyList.dayLabel(r.day).long, time: r.start_time, vibe: r.vibe, inviteOnly: r.invite_only,
      by: r.by_name || 'A chapter leader', onList: r.on_list,
    }));
  }

  function mount(app) {
    // ---------- sorority portal ----------
    app.get('/api/sorority/me', ...requireVerified, wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const { rows: setUp } = await pool.query(
        'SELECT sorority_id, sister_password_hash IS NOT NULL AS sister, chair_password_hash IS NOT NULL AS chair FROM sorority_accounts'
      );
      const ready = new Map(setUp.map((r) => [r.sorority_id, r]));
      const sororities = SORORITIES.map((s) => ({ id: s.id, name: s.name, gl: s.gl, ready: !!ready.get(s.id)?.sister, chairReady: !!ready.get(s.id)?.chair }));
      if (req.get('x-pf-sorority') && !adminView(req)) return fail(res, 403, ADMIN_LOCKED, 'ADMIN_LOCKED');
      const member = adminView(req) || await memberOf(req.user.id);
      const me = { name: req.user.name, email: req.user.email };
      if (!member) return res.json({ me, sororities, membership: null });
      const sid = member.sorority_id;
      const chair = member.role === 'chair';
      const { rows: sisters } = await pool.query(
        `SELECT u.id, u.name, u.email, m.role, m.joined_at FROM sorority_members m JOIN users u ON u.id = m.user_id
         WHERE m.sorority_id = $1 AND u.banned_at IS NULL ORDER BY m.role = 'chair' DESC, u.name`,
        [sid]
      );
      res.json({
        me, sororities,
        membership: { sorority: sororities.find((s) => s.id === sid), role: member.role, adminView: !!member.admin },
        invites: await invitesFor(sid, req.user.id),
        identity: await identity(sid),
        emojis: EMOJIS,
        sisters: sisters.map((s) => ({
          id: String(s.id), name: s.name, role: s.role, joined: s.joined_at, you: String(s.id) === String(req.user.id),
          ...(chair ? { email: s.email } : {}),
        })),
      });
    }));

    app.post('/api/sorority/join', authLimiter, ...requireVerified, wrap(async (req, res) => {
      const sid = Number(req.body?.sororityId);
      const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
      if (!sororityById.has(sid)) return fail(res, 400, 'Pick your sorority.');
      if (await memberOf(req.user.id)) return fail(res, 409, "You're already in a sorority. Leave it first to join another.", 'ALREADY_SISTER');
      const { rows: [acct] } = await pool.query('SELECT sister_password_hash FROM sorority_accounts WHERE sorority_id = $1', [sid]);
      if (!acct?.sister_password_hash) return fail(res, 400, "Your sorority isn't set up on PhatFrats yet. Ask your chair to contact PhatFrats.", 'SORORITY_NOT_READY');
      if (!password || !(await verifyPassword(password, acct.sister_password_hash))) {
        return fail(res, 401, "That sister password isn't right. Ask your chair for it.", 'BAD_SORORITY_PASSWORD');
      }
      await pool.query('INSERT INTO sorority_members (user_id, sorority_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING', [req.user.id, sid]);
      res.json({ ok: true });
    }));

    // Chair sign-in: the chair password makes this account a chair of the sorority.
    app.post('/api/sorority/chair-login', authLimiter, ...requireVerified, wrap(async (req, res) => {
      const sid = Number(req.body?.sororityId);
      const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
      if (!sororityById.has(sid)) return fail(res, 400, 'Pick your sorority.');
      const { rows: [acct] } = await pool.query('SELECT chair_password_hash FROM sorority_accounts WHERE sorority_id = $1', [sid]);
      if (!acct?.chair_password_hash) return fail(res, 400, "Chair sign-in isn't set up for this sorority yet. Contact PhatFrats to get your chair password.", 'CHAIR_NOT_READY');
      if (!password || !(await verifyPassword(password, acct.chair_password_hash))) return fail(res, 401, "That chair password isn't right.", 'BAD_CHAIR_PASSWORD');
      const current = await memberOf(req.user.id);
      if (current && current.sorority_id !== sid) return fail(res, 409, "You're in a different sorority. Leave it first, then sign in as this sorority's chair.", 'ALREADY_SISTER');
      await pool.query(
        `INSERT INTO sorority_members (user_id, sorority_id, role) VALUES ($1, $2, 'chair') ON CONFLICT (user_id) DO UPDATE SET role = 'chair'`,
        [req.user.id, sid]
      );
      res.json({ ok: true });
    }));

    app.post('/api/sorority/leave', ...requireSister, wrap(async (req, res) => {
      if (req.sister.admin) return fail(res, 400, "You're viewing this sorority as the admin, so there's nothing to leave.");
      await pool.query('DELETE FROM sorority_members WHERE user_id = $1', [req.user.id]);
      await dropSpots(req.sister.sorority_id, { userId: req.user.id });
      await pool.query('DELETE FROM sorority_rsvps WHERE user_id = $1', [req.user.id]);
      res.json({ ok: true });
    }));

    // Sisters tap "I'm going" (or take it back) on one of their sorority's invites.
    app.post('/api/sorority/invites/:id/rsvp', ...requireSister, wrap(async (req, res) => {
      const id = idParam(req.params.id);
      if (!id) return fail(res, 400, 'That invite id is not valid.');
      if (req.sister.admin) return fail(res, 400, "You're viewing this sorority as the admin, so you can't RSVP.");
      const { rows: [inv] } = await pool.query(
        `SELECT si.status FROM sorority_invites si JOIN hosted_parties hp ON hp.id = si.party_id
         WHERE si.id = $1 AND si.sorority_id = $2 AND hp.status = 'live' AND hp.party_date >= $3::date`,
        [id, req.sister.sorority_id, partyList.todayISO()]
      );
      if (!inv) return fail(res, 404, "That invite isn't one of your sorority's, or the party is over.");
      if (inv.status !== 'active') return fail(res, 400, 'Your chairs turned this invite down.', 'DECLINED');
      if (req.body?.going === false) await pool.query('DELETE FROM sorority_rsvps WHERE invite_id = $1 AND user_id = $2', [id, req.user.id]);
      else await pool.query('INSERT INTO sorority_rsvps (invite_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
      const { rows: [n] } = await pool.query('SELECT count(*)::int AS n FROM sorority_rsvps WHERE invite_id = $1', [id]);
      res.json({ ok: true, going: n.n });
    }));

    // Chairs make the page their own: tagline, story, colors, house emoji and a note pinned for every sister.
    app.post('/api/sorority/profile', ...requireChair, wrap(async (req, res) => {
      const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
      const reset = req.body?.resetColors === true;
      const c1 = reset ? null : hex(req.body?.color1), c2 = reset ? null : hex(req.body?.color2);
      if (!reset && (req.body?.color1 || req.body?.color2) && (!c1 || !c2)) return fail(res, 400, 'Pick both colors.');
      const emoji = EMOJIS.includes(req.body?.emoji) ? req.body.emoji : null;
      const sid = req.sister.sorority_id;
      const { rows: [old] } = await pool.query('SELECT announcement FROM sorority_profiles WHERE sorority_id = $1', [sid]);
      const note = req.body?.announcement === undefined ? (old?.announcement || '') : str(req.body.announcement, 240);
      const noteChanged = note !== (old?.announcement || '');
      await pool.query(
        `INSERT INTO sorority_profiles (sorority_id, tagline, about, color1, color2, emoji, announcement, announcement_at, announcement_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = '' THEN NULL ELSE now() END, CASE WHEN $7 = '' THEN NULL ELSE $8::bigint END, $8)
         ON CONFLICT (sorority_id) DO UPDATE SET tagline = EXCLUDED.tagline, about = EXCLUDED.about, color1 = EXCLUDED.color1,
           color2 = EXCLUDED.color2, emoji = EXCLUDED.emoji, updated_by = EXCLUDED.updated_by, updated_at = now(),
           announcement = EXCLUDED.announcement,
           announcement_at = CASE WHEN $9 THEN EXCLUDED.announcement_at ELSE sorority_profiles.announcement_at END,
           announcement_by = CASE WHEN $9 THEN EXCLUDED.announcement_by ELSE sorority_profiles.announcement_by END`,
        [sid, str(req.body?.tagline, 90), str(req.body?.about, 700), c1, c2, emoji, note, req.user.id, noteChanged]
      );
      // A new pinned note pings every sister's bell.
      if (noteChanged && note) {
        await pool.query(
          `INSERT INTO notifications (user_id, kind, text, link) SELECT user_id, 'sorority', $2, '/sororities' FROM sorority_members WHERE sorority_id = $1 AND user_id <> $3`,
          [sid, ('📣 ' + (sororityById.get(sid)?.gl || '') + ': ' + note).slice(0, 240), req.user.id]
        );
      }
      res.json({ identity: await identity(sid) });
    }));

    // Chairs turn a frat's invite down for the whole house, or take it back.
    app.post('/api/sorority/invites/:id/:act', ...requireChair, wrap(async (req, res) => {
      const id = idParam(req.params.id);
      const act = req.params.act;
      if (!id || (act !== 'decline' && act !== 'accept')) return fail(res, 400, 'Choose accept or decline.');
      const { rows: [inv] } = await pool.query(
        `UPDATE sorority_invites SET status = $3 WHERE id = $1 AND sorority_id = $2 RETURNING 'h' || party_id AS party_id`,
        [id, req.sister.sorority_id, act === 'decline' ? 'declined' : 'active']
      );
      if (!inv) return fail(res, 404, "That invite isn't one of your sorority's.");
      if (act === 'decline') await dropSpots(req.sister.sorority_id, { partyId: inv.party_id });
      res.json({ ok: true });
    }));

    app.post('/api/sorority/members/:id/role', ...requireChair, wrap(async (req, res) => {
      const id = idParam(req.params.id);
      const role = req.body?.role;
      if (!id || (role !== 'chair' && role !== 'sister')) return fail(res, 400, 'Choose chair or sister.');
      if (id === String(req.user.id) && role === 'sister') {
        const { rows: [n] } = await pool.query(`SELECT count(*)::int AS n FROM sorority_members WHERE sorority_id = $1 AND role = 'chair'`, [req.sister.sorority_id]);
        if (n.n <= 1) return fail(res, 400, "You're the only chair. Make someone else a chair first.", 'LAST_CHAIR');
      }
      const { rowCount } = await pool.query('UPDATE sorority_members SET role = $3 WHERE user_id = $1 AND sorority_id = $2', [id, req.sister.sorority_id, role]);
      if (!rowCount) return fail(res, 404, "That person isn't in your sorority.");
      res.json({ ok: true });
    }));

    app.post('/api/sorority/members/:id/remove', ...requireChair, wrap(async (req, res) => {
      const id = idParam(req.params.id);
      if (!id) return fail(res, 400, 'That member id is not valid.');
      if (id === String(req.user.id)) return fail(res, 400, 'To leave the sorority yourself, use Leave sorority.');
      const { rowCount } = await pool.query('DELETE FROM sorority_members WHERE user_id = $1 AND sorority_id = $2', [id, req.sister.sorority_id]);
      if (!rowCount) return fail(res, 404, "That person isn't in your sorority.");
      await dropSpots(req.sister.sorority_id, { userId: id });
      await pool.query('DELETE FROM sorority_rsvps WHERE user_id = $1', [id]);
      res.json({ ok: true });
    }));

    app.post('/api/sorority/password', ...requireChair, wrap(async (req, res) => {
      await setPassword(req.sister.sorority_id, req.body, res);
    }));

    // ---------- control room ----------
    app.get('/api/admin/sororities', requireAdmin, wrap(async (req, res) => {
      const today = partyList.todayISO();
      const [{ rows: accts }, { rows: counts }, { rows: chairs }, { rows: invites }] = await Promise.all([
        pool.query('SELECT sorority_id, sister_password_hash IS NOT NULL AS sister, chair_password_hash IS NOT NULL AS chair FROM sorority_accounts'),
        pool.query(`SELECT sorority_id, count(*)::int AS n FROM sorority_members GROUP BY sorority_id`),
        pool.query(`SELECT m.sorority_id, u.name, u.email FROM sorority_members m JOIN users u ON u.id = m.user_id WHERE m.role = 'chair' ORDER BY u.name`),
        pool.query(
          `SELECT si.sorority_id, count(*) FILTER (WHERE si.status = 'active' AND hp.party_date >= $1::date AND hp.status = 'live')::int AS upcoming,
             count(*) FILTER (WHERE si.status = 'declined')::int AS declined, count(*)::int AS total, max(si.created_at) AS last_at
           FROM sorority_invites si JOIN hosted_parties hp ON hp.id = si.party_id GROUP BY si.sorority_id`,
          [today]
        ),
      ]);
      const acct = new Map(accts.map((a) => [a.sorority_id, a]));
      const count = new Map(counts.map((c) => [c.sorority_id, c.n]));
      const inv = new Map(invites.map((i) => [i.sorority_id, i]));
      res.json({
        sororities: SORORITIES.map((s) => ({
          id: s.id, name: s.name, gl: s.gl,
          sisterPw: !!acct.get(s.id)?.sister, chairPw: !!acct.get(s.id)?.chair,
          members: count.get(s.id) || 0,
          chairs: chairs.filter((c) => c.sorority_id === s.id).map((c) => ({ name: c.name, email: c.email })),
          invites: { upcoming: inv.get(s.id)?.upcoming || 0, declined: inv.get(s.id)?.declined || 0, total: inv.get(s.id)?.total || 0, lastAt: inv.get(s.id)?.last_at || null },
        })),
      });
    }));
    app.post('/api/admin/sororities/:id/password', requireAdmin, wrap(async (req, res) => {
      const sid = Number(req.params.id);
      if (!sororityById.has(sid)) return fail(res, 400, 'That sorority is not on the list.');
      await setPassword(sid, req.body, res);
    }));
    // Makes an existing account a chair of this sorority, moving them from any other sorority.
    app.post('/api/admin/sororities/:id/chair', requireAdmin, wrap(async (req, res) => {
      const sid = Number(req.params.id);
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (!sororityById.has(sid)) return fail(res, 400, 'That sorority is not on the list.');
      const { rows: [u] } = await pool.query('SELECT id, email_verified_at, banned_at FROM users WHERE email = $1', [email]);
      if (!u) return fail(res, 404, 'No PhatFrats account uses that email. They need to sign up first.');
      if (!u.email_verified_at) return fail(res, 400, "That account hasn't confirmed its email yet.");
      if (u.banned_at) return fail(res, 400, 'That account is banned.');
      const was = await memberOf(u.id);
      if (was && was.sorority_id !== sid) await dropSpots(was.sorority_id, { userId: u.id });
      await pool.query(
        `INSERT INTO sorority_members (user_id, sorority_id, role) VALUES ($1, $2, 'chair')
         ON CONFLICT (user_id) DO UPDATE SET sorority_id = $2, role = 'chair', joined_at = CASE WHEN sorority_members.sorority_id = $2 THEN sorority_members.joined_at ELSE now() END`,
        [u.id, sid]
      );
      res.json({ ok: true });
    }));
  }

  // kind 'chair' sets the chair password, anything else the sister password.
  async function setPassword(sid, body, res) {
    const password = typeof body?.password === 'string' ? body.password : '';
    const column = body?.kind === 'chair' ? 'chair_password_hash' : 'sister_password_hash';
    if (password.length < 8 || password.length > 200) return fail(res, 400, 'Use a password with at least 8 characters.');
    await pool.query(
      `INSERT INTO sorority_accounts (sorority_id, ${column}) VALUES ($1, $2)
       ON CONFLICT (sorority_id) DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = now()`,
      [sid, await hashPassword(password)]
    );
    res.json({ ok: true });
  }

  // ---------- the frat side (mounted from chapters.js, which owns the chapter sign-in checks) ----------
  function mountChapter(app, { requireMember, requireLeader }) {
    // Every sorority, how many sisters are on PhatFrats, and the group invites this chapter has sent.
    app.get('/api/chapter/sorority-invites', ...requireMember, wrap(async (req, res) => {
      const [{ rows: counts }, { rows: sent }] = await Promise.all([
        pool.query('SELECT sorority_id, count(*)::int AS n FROM sorority_members GROUP BY sorority_id'),
        pool.query(
          `SELECT si.id, si.sorority_id, si.status, si.note, si.created_at, 'h' || hp.id AS party_id, u.name AS by_name,
             (SELECT count(*) FROM invite_requests r WHERE r.party_id = 'h' || hp.id AND r.via_sorority = si.sorority_id)::int AS on_list
           FROM sorority_invites si JOIN hosted_parties hp ON hp.id = si.party_id LEFT JOIN users u ON u.id = si.invited_by
           WHERE hp.chapter_id = $1 AND hp.party_date >= $2::date ORDER BY si.created_at DESC`,
          [req.member.chapter_id, partyList.todayISO()]
        ),
      ]);
      const n = new Map(counts.map((c) => [c.sorority_id, c.n]));
      res.json({
        sororities: SORORITIES.map((s) => ({ id: s.id, name: s.name, gl: s.gl, sisters: n.get(s.id) || 0 })),
        sent: sent.map((s) => ({
          id: String(s.id), sororityId: s.sorority_id, sorority: sororityById.get(s.sorority_id)?.name || '', gl: sororityById.get(s.sorority_id)?.gl || '',
          status: s.status, note: s.note, partyId: s.party_id, by: s.by_name || 'A former leader', sent: s.created_at, onList: s.on_list,
        })),
      });
    }));

    // Leaders invite one or more sororities (or all of them) to a party. Every sister goes on the list.
    app.post('/api/chapter/sorority-invites', ...requireLeader, wrap(async (req, res) => {
      const partyId = typeof req.body?.partyId === 'string' && partyList.isHostedId(req.body.partyId) ? req.body.partyId : null;
      if (!partyId) return fail(res, 400, 'Pick a party.');
      const ids = req.body?.all === true ? SORORITIES.map((s) => s.id)
        : [...new Set((Array.isArray(req.body?.sororityIds) ? req.body.sororityIds : []).map(Number))].filter((id) => sororityById.has(id));
      if (!ids.length) return fail(res, 400, 'Pick at least one sorority.');
      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
      const party = await partyList.findParty(pool, partyId, { includeTest: true, includePrivate: true });
      const { rows: [own] } = await pool.query('SELECT chapter_id FROM hosted_parties WHERE id = $1', [partyId.slice(1)]);
      if (!party || !own || own.chapter_id !== req.member.chapter_id) return fail(res, 400, "That party isn't open for invites. It may be cancelled or already over.");
      const { rows: made } = await pool.query(
        `INSERT INTO sorority_invites (party_id, sorority_id, invited_by, note)
         SELECT $1, s, $2, $3 FROM unnest($4::int[]) AS s
         ON CONFLICT (party_id, sorority_id) DO NOTHING RETURNING sorority_id`,
        [partyId.slice(1), req.user.id, note, ids]
      );
      const newIds = made.map((m) => m.sorority_id);
      if (newIds.length) {
        // A bell note for every sister of each newly invited sorority, in one go.
        const chapter = chapterById.get(req.member.chapter_id)?.name || 'A chapter';
        const when = partyList.dayLabel(party.day).long;
        await pool.query(
          `INSERT INTO notifications (user_id, kind, text, link)
           SELECT m.user_id, 'sorority', left('💌 ' || $1 || ' invited your sorority to ' || $2 || ' (' || $3 || '). Every sister is on the list!', 240), $4
           FROM sorority_members m WHERE m.sorority_id = ANY($5::int[])`,
          [chapter, party.title, when, '/?party=' + partyId, newIds]
        );
      }
      res.status(201).json({ ok: true, invited: newIds.length, already: ids.length - newIds.length });
    }));

    // Leaders take back a sorority invite. Sisters it put on the list come off it.
    app.post('/api/chapter/sorority-invites/:id/delete', ...requireLeader, wrap(async (req, res) => {
      const id = idParam(req.params.id);
      if (!id) return fail(res, 400, 'That invite id is not valid.');
      const { rows: [gone] } = await pool.query(
        `DELETE FROM sorority_invites si USING hosted_parties hp
         WHERE si.id = $1 AND hp.id = si.party_id AND hp.chapter_id = $2 RETURNING si.sorority_id, 'h' || si.party_id AS party_id`,
        [id, req.member.chapter_id]
      );
      if (!gone) return fail(res, 404, "That invite isn't one of your chapter's.");
      await dropSpots(gone.sorority_id, { partyId: gone.party_id });
      res.json({ ok: true });
    }));
  }

  return { mount, mountChapter, claim, sororityById };
}

module.exports = { create, SORORITIES };
