// Control room plumbing shared across the site:
// - settings: switches the admin flips (lockdown, spotlight, Door Rush event, money goal), cached briefly;
// - activity: the live ticker of what's happening on the site (no names, emails or other personal details);
// - admin log: a record of every change made from the control room.
const partyList = require('./party-list.js');

const CACHE_MS = 15 * 1000;

function create({ pool, CHAPTERS }) {
  const chapterName = (id) => CHAPTERS.find((c) => c.id === Number(id))?.name || `chapter ${id}`;

  // ---------- settings ----------
  let cache = null, cachedAt = 0;
  async function settings() {
    if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
    const { rows } = await pool.query('SELECT key, value FROM admin_settings');
    cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    cachedAt = Date.now();
    return cache;
  }
  async function setSetting(key, value) {
    if (value === null || value === undefined) await pool.query('DELETE FROM admin_settings WHERE key = $1', [key]);
    else {
      await pool.query(
        `INSERT INTO admin_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)]
      );
    }
    cache = null;
  }
  // Which parts of the site are paused right now.
  async function paused(what) {
    const s = await settings();
    return !!(s.lockdown && s.lockdown[what]);
  }

  // ---------- activity feed ----------
  function activity(kind, text) {
    pool.query('INSERT INTO activity_events (kind, text) VALUES ($1, $2)', [kind, String(text).slice(0, 160)])
      .catch((err) => console.error('Could not record activity:', err.message));
    if (Math.random() < .02) pool.query(`DELETE FROM activity_events WHERE created_at < now() - interval '30 days'`).catch(() => {});
  }
  // Records successful site actions for the ticker, after the response has gone out.
  function mountActivity(app) {
    const after = (req, res, fn) => res.on('finish', () => { if (res.statusCode < 300) fn().catch(() => {}); });
    app.post('/api/signup', (req, res, next) => { after(req, res, async () => activity('signup', 'New sign-up')); next(); });
    app.post('/api/verify', (req, res, next) => { after(req, res, async () => activity('verify', 'Someone confirmed their email')); next(); });
    app.post('/api/requests', (req, res, next) => {
      after(req, res, async () => {
        const p = await partyList.findParty(pool, req.body?.partyId);
        activity('request', `Someone requested ${p ? p.title : 'a party'}`);
      });
      next();
    });
    app.post('/api/requests/guest', (req, res, next) => { after(req, res, async () => activity('guest', 'An outside guest was added to a list')); next(); });
    app.post('/api/chapter/parties', (req, res, next) => {
      after(req, res, async () => {
        const m = await pool.query('SELECT chapter_id FROM chapter_members WHERE user_id = $1', [req.user?.id]);
        const ch = req.get('x-pf-chapter') || m.rows[0]?.chapter_id;
        activity('party', `${ch ? chapterName(ch) : 'A chapter'} posted ${String(req.body?.title || 'a party').slice(0, 60)}`);
      });
      next();
    });
    app.post('/api/chapter/join', (req, res, next) => { after(req, res, async () => activity('brother', `A brother joined ${chapterName(req.body?.chapterId)}`)); next(); });
    app.post('/api/chapter/invites', (req, res, next) => { after(req, res, async () => activity('invite', 'A brother sent an invite')); next(); });
  }

  // ---------- admin log ----------
  const describe = {
    ban: (t, b) => `Banned ${t}${b.reason ? ` ("${String(b.reason).slice(0, 80)}")` : ''}`,
    unban: (t) => `Unbanned ${t}`,
    plan: (t, b) => (b.plan === 'full' ? `Gave Full Access to ${t}` : `Removed Full Access from ${t}`),
  };
  async function userLabel(id) {
    const { rows: [u] } = await pool.query('SELECT name, email FROM users WHERE id = $1', [id]);
    return u ? `${u.name} (${u.email})` : `account #${id}`;
  }
  // Works out a readable line for each control room change.
  async function summarize(req, p) {
    const b = req.body || {};
    let m;
    if ((m = /^\/users\/(\d+)\/(ban|unban|plan)$/.exec(p))) return describe[m[2]](await userLabel(m[1]), b);
    if ((m = /^\/chapters\/(\d+)\/password$/.exec(p))) return `Set the ${b.kind === 'leader' ? 'leader' : 'brother'} password for ${chapterName(m[1])}`;
    if ((m = /^\/chapters\/(\d+)\/leader$/.exec(p))) return `Made ${String(b.email || '').slice(0, 80)} a leader of ${chapterName(m[1])}`;
    if ((m = /^\/parties\/(h\d+)\/status$/.exec(p))) {
      const party = await pool.query('SELECT title FROM hosted_parties WHERE id = $1', [m[1].slice(1)]);
      return `${b.status === 'cancelled' ? 'Took down' : 'Put back'} "${party.rows[0]?.title || m[1]}"`;
    }
    if (p === '/announcement') return b.text ? `Lit the beacon: "${String(b.text).slice(0, 80)}" for ${b.audience || 'everyone'}` : 'Turned off the beacon';
    if (p === '/lockdown') return `Lockdown: ${Object.entries(b).map(([k, v]) => `${k} ${v ? 'paused' : 'open'}`).join(', ')}`;
    if (p === '/spotlight') return b.partyId ? `Spotlighted ${b.partyId}` : 'Cleared the spotlight';
    if (p === '/promo') return `Created promo code ${String(b.code || '').toUpperCase()} (${b.percentOff}% off)`;
    if ((m = /^\/promo\/([A-Z0-9-]+)\/off$/.exec(p))) return `Turned off promo code ${m[1]}`;
    if (p === '/gift') return `Gifted Full Access to ${b.audience}${b.until ? ` through ${b.until}` : ' with no end date'}`;
    if (p === '/goal') return `Set the money goal to $${b.dollars}`;
    if (p === '/demo') return b.hide ? 'Hid the demo parties' : 'Showed the demo parties';
    if (p === '/weekend-drop') return `Sent the Weekend Drop: "${String(b.message || '').slice(0, 80)}"`;
    if ((m = /^\/inbox\/(report|message)\/(\d+)\/close$/.exec(p))) return `Closed ${m[1]} #${m[2]} in the inbox`;
    if (p === '/game/reset') return 'Reset the Door Rush weekly leaderboard';
    if (p === '/game/event') return b.days ? `Started a Door Rush double-points event for ${b.days} days` : 'Ended the Door Rush event';
    if ((m = /^\/game\/remove\/(\d+)$/.exec(p))) return `Removed ${await userLabel(m[1])} from this week's Door Rush board`;
    return `${req.method} ${p}`;
  }
  // Logs every successful change made through the control room, plus anything done in a chapter's admin view.
  function mountAdminLog(app) {
    const log = (req, res, action) => res.on('finish', () => {
      if (res.statusCode >= 300 || !req.user || req.user.role !== 'admin') return;
      action().then((text) => pool.query('INSERT INTO admin_log (admin_id, action) VALUES ($1, $2)', [req.user.id, text.slice(0, 300)]))
        .catch((err) => console.error('Could not write the admin log:', err.message));
    });
    // req.path is relative to the mount point only while this runs, so it's read now, not after the response.
    app.use('/api/admin', (req, res, next) => {
      const path = req.path;
      if (req.method === 'POST' && !['/unlock', '/lock'].includes(path)) log(req, res, () => summarize(req, path));
      next();
    });
    app.use('/api/chapter', (req, res, next) => {
      const ch = req.get('x-pf-chapter'), path = req.path;
      if (req.method === 'POST' && ch) log(req, res, async () => `In ${chapterName(ch)}'s admin view: ${path.replace(/^\//, '').replace(/\//g, ' ')}`);
      next();
    });
  }

  return { settings, setSetting, paused, activity, mountActivity, mountAdminLog };
}

module.exports = { create };
