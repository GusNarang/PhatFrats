// Error tracking: every crash on the server and every script error in students' browsers is recorded, grouped
// (the same error happening 50 times is one row with a count of 50), shown on the control room's Maintenance page,
// and the admins get a bell note and an email the first time each new error shows up.
// Also /api/health, for an outside uptime monitor to check every few minutes.
// Nothing personal is stored: no request bodies, no account, no query strings; just the error and where it happened.
const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname);
const MAIL_GAP_MS = 10 * 60 * 1000; // at most one alert email every 10 minutes
// Browser errors that aren't PhatFrats bugs: flaky phone signal, browser extensions, a known Chrome quirk.
const NOISE = [/^script error\.?$/i, /resizeobserver loop/i, /^(typeerror: )?(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|the network connection was lost\.?)$/i,
  /^aborterror/i, /the operation was aborted/i, /^(uncaught )?(\[object |)undefined\]?$/i];
const EXTENSION = /(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;

const clip = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
// Strips this server's folder from stack traces, so they read "chapters.js:120" instead of a full path.
const tidyStack = (s) => clip(s, 6000).split(ROOT + path.sep).join('').split(ROOT.replace(/\\/g, '/') + '/').join('').slice(0, 4000);
// Numbers and ids change between occurrences of the same error, so they're left out of the grouping.
const normal = (m) => clip(m, 300).replace(/\b[0-9a-f]{16,}\b/gi, '…').replace(/\d{3,}/g, '#');
const firstFrame = (stack) => (String(stack || '').split('\n').find((l) => /\.js:\d+/.test(l) && !/node_modules|node:internal/.test(l)) || '').trim().replace(/:\d+\)?$/, '');

function create({ pool, ops, sendMail }) {
  async function alertAdmins(row) {
    // One email at most every 10 minutes, across every server copy.
    const { rowCount } = await pool.query(
      `INSERT INTO admin_settings (key, value) VALUES ('err_alert_at', jsonb_build_object('at', now()))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       WHERE (admin_settings.value->>'at')::timestamptz < now() - make_interval(secs => $1)`, [MAIL_GAP_MS / 1000]);
    const text = `⚠️ New ${row.source === 'browser' ? 'browser' : 'server'} error on PhatFrats: "${clip(row.message, 120)}"${row.path ? ` (${row.path})` : ''}. See the control room's Maintenance page.`;
    const { rows: admins } = await pool.query(`SELECT id, email FROM users WHERE role = 'admin' AND banned_at IS NULL`);
    await pool.query(`INSERT INTO notifications (user_id, kind, text, link) SELECT unnest($1::bigint[]), 'admin', $2, '/admin#maintenance'`, [admins.map((a) => a.id), text.slice(0, 240)]);
    await pool.query('UPDATE error_events SET alerted_at = now() WHERE id = $1', [row.id]);
    if (!rowCount || !sendMail) return;
    const body = `A new error just happened on PhatFrats.\n\nWhat: ${row.message}\nWhere: ${row.source === 'browser' ? 'a student\'s browser' : 'the server'}${row.path ? `, ${row.method ? row.method + ' ' : ''}${row.path}` : ''}\nWhen: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} (Eastern)\n\nSee the details and mark it fixed in the control room: Maintenance page, Errors.\n(You get at most one of these emails every 10 minutes. Errors that repeat are counted, not emailed again.)`;
    await Promise.all(admins.map((a) => sendMail(a.email, `⚠️ PhatFrats error: ${clip(row.message, 60)}`, body).catch(() => {})));
  }

  // Records one error. Never throws: tracking must not cause a second failure.
  async function record({ source, message, stack, path: where, method, status }) {
    try {
      const msg = clip(message, 500).trim() || 'Unknown error';
      const fp = crypto.createHash('sha1').update([source, normal(msg), firstFrame(stack), source === 'browser' ? clip(where, 80) : ''].join('|')).digest('hex');
      const { rows: [row] } = await pool.query(
        `INSERT INTO error_events (fingerprint, source, message, stack, path, method, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (fingerprint) DO UPDATE SET count = error_events.count + 1, last_at = now(), message = EXCLUDED.message,
           stack = coalesce(EXCLUDED.stack, error_events.stack), path = EXCLUDED.path, method = EXCLUDED.method, status = EXCLUDED.status,
           resolved_at = NULL, alerted_at = CASE WHEN error_events.resolved_at IS NOT NULL THEN NULL ELSE error_events.alerted_at END
         RETURNING id, source, message, path, method, alerted_at`,
        [fp, source, msg, stack ? tidyStack(stack) : null, clip(where, 200) || null, clip(method, 10) || null, Number.isInteger(status) ? status : null]);
      if (!row.alerted_at) await alertAdmins(row);
    } catch (err) {
      console.error('Could not record an error:', err.message);
    }
  }

  // Express error handler: records the crash (waiting at most 2 seconds), then answers as before.
  function handler(fail) {
    return async (err, req, res, next) => {
      if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return fail(res, 400, 'That request could not be read.');
      console.error(err);
      await Promise.race([
        record({ source: 'server', message: err.message || String(err), stack: err.stack, path: (req.originalUrl || '').split('?')[0], method: req.method, status: 500 }),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
      if (res.headersSent) return next(err);
      fail(res, 500, 'Something went wrong on our end. Try again in a moment.');
    };
  }

  function mount(app, { wrap, fail, requireUser, clientLimiter, healthLimiter }) {
    // Script errors from students' browsers (public/error-report.js).
    app.post('/api/client-error', clientLimiter, wrap(async (req, res) => {
      const b = req.body || {};
      const message = clip(b.message, 500).trim();
      const src = clip(b.src, 300), stack = clip(b.stack, 4000);
      const origin = `${req.protocol}://${req.get('host')}`;
      const ours = !src || src.startsWith(origin) || src.startsWith('/');
      if (message && ours && !NOISE.some((re) => re.test(message)) && !EXTENSION.test(src) && !EXTENSION.test(stack)) {
        const page = clip(b.page, 80).replace(/[?#].*$/, '') || '/';
        const where = src ? src.replace(origin, '').replace(/[?#].*$/, '') + (Number.isInteger(b.line) ? `:${b.line}` : '') : '';
        await record({ source: 'browser', message, stack: stack || (where ? `at ${where}` : ''), path: page + (where ? ` (${where})` : ''), method: null, status: null });
      }
      res.status(204).end();
    }));

    // For an uptime monitor (UptimeRobot, Better Stack): 200 when the site and its database answer, 503 when not.
    // While the site lock is on it still answers 200, so planned maintenance doesn't page you.
    app.get('/api/health', healthLimiter, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const t0 = Date.now();
      try {
        await Promise.race([pool.query('SELECT 1'), new Promise((_, no) => setTimeout(() => no(new Error('The database took over 8 seconds.')), 8000))]);
        const m = (await ops.settings()).maintenance;
        const locked = !!(m && Date.parse(m.start) <= Date.now() && (!m.end || Date.parse(m.end) > Date.now()));
        res.json({ ok: true, database: 'ok', ms: Date.now() - t0, locked });
      } catch (err) {
        res.status(503).json({ ok: false, database: 'down', error: err.message });
      }
    });

    const requireAdmin = [requireUser, (req, res, next) => {
      if (req.user.role !== 'admin' || !req.user.admin_unlocked) return fail(res, 404, 'Not found.');
      res.set('Cache-Control', 'no-store');
      next();
    }];
    app.get('/api/admin/errors', requireAdmin, wrap(async (req, res) => {
      const [{ rows: open }, { rows: [n] }] = await Promise.all([
        pool.query(`SELECT id, source, message, stack, path, method, count, first_at, last_at FROM error_events
                    WHERE resolved_at IS NULL ORDER BY last_at DESC LIMIT 50`),
        pool.query(`SELECT count(*) FILTER (WHERE resolved_at IS NULL)::int AS open,
                      coalesce(sum(count) FILTER (WHERE resolved_at IS NULL AND last_at > now() - interval '1 day'), 0)::int AS today,
                      count(*) FILTER (WHERE resolved_at > now() - interval '30 days')::int AS fixed
                    FROM error_events`),
      ]);
      res.json({ errors: open.map((e) => ({ ...e, id: Number(e.id) })), counts: n });
    }));
    app.post('/api/admin/errors/:id/resolve', requireAdmin, wrap(async (req, res) => {
      if (!/^\d{1,18}$/.test(req.params.id)) return fail(res, 404, 'Not found.');
      const { rowCount } = await pool.query('UPDATE error_events SET resolved_at = now(), alerted_at = NULL WHERE id = $1 AND resolved_at IS NULL', [req.params.id]);
      if (!rowCount) return fail(res, 404, 'That error is already marked fixed.');
      res.json({ ok: true });
    }));
    app.post('/api/admin/errors/resolve-all', requireAdmin, wrap(async (req, res) => {
      const { rowCount } = await pool.query('UPDATE error_events SET resolved_at = now(), alerted_at = NULL WHERE resolved_at IS NULL');
      res.json({ ok: true, resolved: rowCount });
    }));
  }

  return { record, handler, mount };
}

module.exports = { create, NOISE };
