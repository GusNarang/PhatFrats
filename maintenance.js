// Maintenance mode: the control room can lock the whole site, right now or at a scheduled time.
// - While it's on, everyone except admin accounts gets a "back soon" screen (beacon.js) and the API answers 503.
// - Stripe webhooks, the Monday prize job, logging in and the control room keep working, so no payment is lost
//   and the admin can always get back in to unlock it.
// - A scheduled window shows a heads-up banner for the 24 hours before it starts, and unlocks itself at the end.
// Stored in admin_settings as maintenance = { start, end|null, message } (ISO times).
const DEFAULT_MESSAGE = "PhatFrats is down for a quick tune-up. We'll be back soon!";
const WARN_MS = 24 * 60 * 60 * 1000;
const MAX_MS = 7 * 24 * 60 * 60 * 1000;

// Paths that stay open while the site is locked.
const OPEN = [/^\/api\/stripe\//, /^\/api\/cron\//, /^\/api\/admin(\/|$)/, /^\/api\/(login|logout|me|maintenance|beacon|hit|health|client-error)$/];

function stateOf(m, now = Date.now()) {
  if (!m || !m.start) return { active: false, upcoming: false };
  const start = Date.parse(m.start), end = m.end ? Date.parse(m.end) : null;
  if (end && now >= end) return { active: false, upcoming: false };
  const active = now >= start;
  return {
    active,
    upcoming: !active,
    warn: !active && start - now <= WARN_MS,
    start: m.start, end: m.end || null,
    message: m.message || DEFAULT_MESSAGE,
  };
}

function create({ pool, ops, currentUser }) {
  const now = () => Date.now();
  async function current() { return stateOf((await ops.settings()).maintenance, now()); }

  // Goes in front of every API route. Admin accounts pass, so they can check the site while it's locked.
  function gate(app) {
    app.use('/api', async (req, res, next) => {
      try {
        const st = await current();
        if (!st.active || OPEN.some((re) => re.test(req.originalUrl.split('?')[0]))) return next();
        const user = await currentUser(req);
        if (user && user.role === 'admin') return next();
        if (st.end) res.set('Retry-After', String(Math.max(60, Math.round((Date.parse(st.end) - now()) / 1000))));
        res.set('Cache-Control', 'no-store');
        res.status(503).json({ error: st.message, code: 'MAINTENANCE', until: st.end });
      } catch (err) { next(err); }
    });
  }

  function mount(app, { wrap, fail, requireUser }) {
    // Every public page asks this (beacon.js). bypass tells an admin they're seeing the site while it's locked.
    app.get('/api/maintenance', wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const st = await current();
      if (!st.active && !st.warn) return res.json({ active: false });
      let bypass = false;
      if (st.active) { const u = await currentUser(req); bypass = !!(u && u.role === 'admin'); }
      res.json({ active: st.active, warn: !!st.warn, start: st.start, end: st.end, message: st.message, bypass });
    }));

    const requireAdmin = [requireUser, (req, res, next) => {
      if (req.user.role !== 'admin' || !req.user.admin_unlocked) return fail(res, 404, 'Not found.');
      res.set('Cache-Control', 'no-store');
      next();
    }];

    app.get('/api/admin/maintenance', requireAdmin, wrap(async (req, res) => {
      res.json({ ...(await current()), defaultMessage: DEFAULT_MESSAGE, now: new Date(now()).toISOString() });
    }));

    // { action: 'now', minutes? } locks straight away (minutes: when it unlocks by itself; none = until you unlock it).
    // { action: 'schedule', start, end } sets a future window. { action: 'off' } unlocks or cancels.
    app.post('/api/admin/maintenance', requireAdmin, wrap(async (req, res) => {
      const b = req.body || {};
      const message = typeof b.message === 'string' && b.message.trim() ? b.message.trim().slice(0, 240) : null;
      if (b.action === 'off') {
        await ops.setSetting('maintenance', null);
        return res.json(await current());
      }
      if (b.action === 'now') {
        const minutes = Number(b.minutes);
        if (b.minutes != null && b.minutes !== '' && !(Number.isInteger(minutes) && minutes >= 5 && minutes <= MAX_MS / 60000)) {
          return fail(res, 400, 'Pick between 5 minutes and 7 days.', 'BAD_TIME');
        }
        const start = new Date(now());
        await ops.setSetting('maintenance', {
          start: start.toISOString(),
          end: minutes ? new Date(start.getTime() + minutes * 60000).toISOString() : null,
          message,
        });
        return res.json(await current());
      }
      if (b.action === 'schedule') {
        const start = Date.parse(b.start), end = Date.parse(b.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return fail(res, 400, 'Pick a start and an end time.', 'BAD_TIME');
        if (start < now() - 60000) return fail(res, 400, 'The start time has already passed. Use "Lock now" instead.', 'BAD_TIME');
        if (end <= start + 4 * 60000) return fail(res, 400, 'The end has to be at least 5 minutes after the start.', 'BAD_TIME');
        if (end - start > MAX_MS) return fail(res, 400, 'Maintenance can last at most 7 days.', 'BAD_TIME');
        if (start - now() > 90 * 24 * 60 * 60 * 1000) return fail(res, 400, 'Schedule it within the next 90 days.', 'BAD_TIME');
        await ops.setSetting('maintenance', { start: new Date(start).toISOString(), end: new Date(end).toISOString(), message });
        return res.json(await current());
      }
      fail(res, 400, 'Unknown action.', 'BAD_ACTION');
    }));
  }

  return { gate, mount, current };
}

module.exports = { create, stateOf, DEFAULT_MESSAGE };
