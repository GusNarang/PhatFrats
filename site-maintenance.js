// Site maintenance: the control room's Maintenance page, and a monthly automatic run (vercel.json cron).
// One run goes through five groups and records what it found:
// - Clean-up: clears temporary data that has run its course (expired log-ins and codes, old counters, sent texts,
//   guest lists of finished parties, ...). It never touches accounts, parties, requests, payments or messages.
// - Database: speed, size against the plan's limit, and whether every table, column and index the code expects exists.
// - Data checks: things that should never happen (and would mean a bug), plus work waiting on the admin.
// - Pages: every page and the files it loads, fetched from the live site the way a visitor would.
// - Services: anything the Launch check reports as broken.
// "Check only" runs everything without changing anything, and shows what Clean-up would clear.
const fs = require('fs');
const path = require('path');

const ET_TODAY = `(now() AT TIME ZONE 'America/New_York')::date`;
const RUN_BUDGET_MS = 45 * 1000; // Vercel stops a request at 60 seconds.
const BATCH = 5000;
const DB_LIMIT_BYTES = 512 * 1024 * 1024; // Neon's free plan.
const PAGES = ['/', '/frats', '/sororities', '/game', '/about', '/admin'];
const KEEP_RUNS = 60;

// Temporary data, and when it has run its course. Each `where` is a fixed string, never user input.
const CLEANUPS = [
  { key: 'sessions', name: 'Expired log-ins', table: 'sessions', where: 'expires_at < now()' },
  { key: 'email_codes', name: 'Old email confirmation codes', table: 'email_codes', where: "expires_at < now() - interval '1 day'" },
  { key: 'password_codes', name: 'Old password reset codes', table: 'password_reset_codes', where: "expires_at < now() - interval '1 day'" },
  { key: 'phone_codes', name: 'Old phone confirmation codes', table: 'phone_codes', where: "expires_at < now() - interval '1 day'" },
  { key: 'rate_limits', name: 'Finished rate-limit counters', table: 'rate_limits', where: 'reset_at < now()' },
  { key: 'presence', name: 'Old live radar entries', table: 'site_presence', where: "last_seen < now() - interval '1 day'" },
  { key: 'activity', name: 'Live ticker events over 30 days old', table: 'activity_events', where: "created_at < now() - interval '30 days'" },
  { key: 'texts', name: 'Sent texts over a week old, failed texts over 30 days old', table: 'sms_outbox', where: "sent_at < now() - interval '7 days' OR failed_at < now() - interval '30 days'" },
  { key: 'game_runs', name: 'Door Rush games that were never finished', table: 'game_runs', where: "finished_at IS NULL AND started_at < now() - interval '1 day'" },
  { key: 'going', name: '"Going" marks for past parties', table: 'friend_going', where: `party_day < ${ET_TODAY}` },
  { key: 'guests', name: 'Outside guest lists of parties over 2 days ago', table: 'outside_guests', where: `party_id IN (SELECT id FROM hosted_parties WHERE party_date < ${ET_TODAY} - 2)` },
  { key: 'chat_usage', name: 'PhatBot daily counters over 30 days old', table: 'chat_usage', where: `day < ${ET_TODAY} - 30` },
];
// Rows that get fixed rather than deleted.
const FIXES = [
  { key: 'texts_expired', name: 'Texts too old to send, marked as failed', table: 'sms_outbox',
    where: "sent_at IS NULL AND failed_at IS NULL AND (created_at <= now() - interval '1 day' OR attempts >= 3)",
    set: "failed_at = now(), last_error = coalesce(last_error, 'Too old to send')" },
  { key: 'beacons', name: 'Beacon banners past their end time, switched off', table: 'announcements', where: 'active AND ends_at < now()', set: 'active = FALSE' },
];

function nextMonthly(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 8, 0));
  if (d <= now) d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

// What schema.sql says should exist: tables, added columns and indexes.
function expectedSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
  const tables = new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gi)].map((m) => m[1].toLowerCase()));
  const columns = [...sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/gi)].map((m) => [m[1].toLowerCase(), m[2].toLowerCase()]);
  const indexes = new Set([...sql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/gi)].map((m) => m[1].toLowerCase()));
  return { tables, columns, indexes };
}

function create({ pool, ops, launch, CHAPTERS }) {
  const chapterName = (id) => CHAPTERS.find((c) => c.id === Number(id))?.name || `chapter ${id}`;
  const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many || one + 's'}`;

  // Runs one change inside a transaction with a time limit, so a slow statement can't hang the run.
  async function tx(sql, params) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '15s'");
      const r = await client.query(sql, params);
      await client.query('COMMIT');
      return r;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------- the groups ----------
  async function cleanup(dryRun, deadline) {
    const steps = [];
    for (const c of CLEANUPS) {
      try {
        if (dryRun) {
          const { rows: [r] } = await pool.query(`SELECT count(*)::int AS n FROM ${c.table} WHERE ${c.where}`);
          steps.push({ key: c.key, name: c.name, state: 'ok', count: r.n, detail: r.n ? `${plural(r.n, 'row')} would be cleared.` : 'Nothing to clear.' });
          continue;
        }
        let n = 0, more = false;
        for (;;) {
          if (Date.now() > deadline) { more = true; break; }
          const { rowCount } = await tx(`DELETE FROM ${c.table} WHERE ctid = ANY(ARRAY(SELECT ctid FROM ${c.table} WHERE ${c.where} LIMIT ${BATCH}))`);
          n += rowCount;
          if (rowCount < BATCH) break;
        }
        steps.push({ key: c.key, name: c.name, state: more ? 'warn' : 'ok', count: n,
          detail: (n ? `Cleared ${plural(n, 'row')}.` : 'Nothing to clear.') + (more ? ' Ran out of time with more left: run it again.' : '') });
      } catch (err) {
        steps.push({ key: c.key, name: c.name, state: 'bad', count: 0, detail: `Couldn't clear it: ${err.message}` });
      }
    }
    for (const f of FIXES) {
      try {
        const r = dryRun
          ? (await pool.query(`SELECT count(*)::int AS n FROM ${f.table} WHERE ${f.where}`)).rows[0].n
          : (await tx(`UPDATE ${f.table} SET ${f.set} WHERE ${f.where}`)).rowCount;
        steps.push({ key: f.key, name: f.name, state: 'ok', count: r, detail: r ? (dryRun ? `${plural(r, 'row')} would be fixed.` : `Fixed ${plural(r, 'row')}.`) : 'Nothing to fix.' });
      } catch (err) {
        steps.push({ key: f.key, name: f.name, state: 'bad', count: 0, detail: `Couldn't fix it: ${err.message}` });
      }
    }
    // A finished maintenance window (the site lock) left in the settings.
    try {
      const m = (await ops.settings()).maintenance;
      const over = m && m.end && Date.parse(m.end) <= Date.now();
      if (over && !dryRun) await ops.setSetting('maintenance', null);
      steps.push({ key: 'lock', name: 'Finished site lock windows', state: 'ok', count: over ? 1 : 0,
        detail: over ? (dryRun ? 'One finished window would be cleared.' : 'Cleared one finished window.') : 'Nothing to clear.' });
    } catch (err) {
      steps.push({ key: 'lock', name: 'Finished site lock windows', state: 'bad', count: 0, detail: err.message });
    }
    // Fresh statistics help the database plan queries after a clean-up.
    if (!dryRun) {
      try {
        await tx(`ANALYZE ${[...new Set([...CLEANUPS, ...FIXES].map((c) => c.table))].join(', ')}`);
        steps.push({ key: 'analyze', name: 'Database statistics refreshed', state: 'ok', detail: 'Updated for every table that was cleaned.' });
      } catch (err) {
        steps.push({ key: 'analyze', name: 'Database statistics refreshed', state: 'warn', detail: `Skipped: ${err.message}` });
      }
    }
    return steps;
  }

  async function database() {
    const steps = [];
    try {
      const t0 = process.hrtime.bigint();
      await pool.query('SELECT 1');
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      steps.push({ key: 'speed', name: 'Response time', state: ms < 500 ? 'ok' : ms < 2000 ? 'warn' : 'bad',
        detail: `${Math.round(ms)} ms.` + (ms >= 500 ? ' Slow: the database may have been asleep (the free plan pauses it when idle), so run the check again.' : '') });
    } catch (err) {
      steps.push({ key: 'speed', name: 'Response time', state: 'bad', detail: `Couldn't reach the database: ${err.message}` });
      return steps;
    }
    try {
      const { rows: [s] } = await pool.query('SELECT pg_database_size(current_database())::bigint AS bytes');
      const { rows: big } = await pool.query(
        `SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 2 DESC LIMIT 4`);
      const mb = (b) => (Number(b) / 1048576).toFixed(1) + ' MB';
      const share = Number(s.bytes) / DB_LIMIT_BYTES;
      steps.push({ key: 'size', name: 'Storage used', state: share < 0.6 ? 'ok' : share < 0.85 ? 'warn' : 'bad',
        detail: `${mb(s.bytes)} of the free plan's 512 MB (${Math.round(share * 100)}%). Biggest: ${big.map((b) => `${b.name} ${mb(b.bytes)}`).join(', ')}.`
          + (share >= 0.6 ? ' Move to a paid Neon plan before it fills up.' : '') });
    } catch (err) {
      steps.push({ key: 'size', name: 'Storage used', state: 'warn', detail: `Couldn't measure it: ${err.message}` });
    }
    try {
      const want = expectedSchema();
      const [{ rows: tbl }, { rows: col }, { rows: idx }, { rows: bad }] = await Promise.all([
        pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"),
        pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'"),
        pool.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"),
        pool.query(`SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND NOT i.indisvalid`),
      ]);
      const haveT = new Set(tbl.map((r) => r.table_name)), haveC = new Set(col.map((r) => r.table_name + '.' + r.column_name)), haveI = new Set(idx.map((r) => r.indexname));
      const missing = [
        ...[...want.tables].filter((t) => !haveT.has(t)).map((t) => `table ${t}`),
        ...want.columns.filter(([t, c]) => !haveC.has(t + '.' + c)).map(([t, c]) => `column ${t}.${c}`),
        ...[...want.indexes].filter((i) => !haveI.has(i)).map((i) => `index ${i}`),
      ];
      steps.push({ key: 'structure', name: 'Tables, columns and indexes', state: missing.length || bad.length ? 'bad' : 'ok',
        detail: missing.length || bad.length
          ? [missing.length ? `Missing: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` and ${missing.length - 8} more` : ''}.` : '',
            bad.length ? `Broken indexes: ${bad.map((r) => r.relname).join(', ')}.` : '',
            'Run npm run db:setup against the live database to repair it.'].filter(Boolean).join(' ')
          : `All ${want.tables.size} tables, ${want.columns.length} added columns and ${want.indexes.size} indexes are in place.` });
    } catch (err) {
      steps.push({ key: 'structure', name: 'Tables, columns and indexes', state: 'warn', detail: `Couldn't check: ${err.message}` });
    }
    return steps;
  }

  async function dataChecks() {
    const checks = [
      ['leaderless', 'Chapters with brothers but no leader', async () => {
        const { rows } = await pool.query(`SELECT chapter_id FROM chapter_members GROUP BY chapter_id HAVING NOT bool_or(role = 'leader')`);
        return rows.length
          ? { state: 'warn', count: rows.length, detail: `${rows.map((r) => chapterName(r.chapter_id)).join(', ')}. Nobody there can post parties; set a leader from the Frats page.` }
          : { state: 'ok', detail: 'Every chapter with brothers has a leader.' };
      }],
      ['private_tickets', 'Invite-only parties selling tickets', async () => {
        const { rows: [r] } = await pool.query(`SELECT count(*)::int AS n FROM hosted_parties WHERE invite_only AND ticketed AND status = 'live' AND party_date >= ${ET_TODAY}`);
        return r.n ? { state: 'bad', count: r.n, detail: `${plural(r.n, 'upcoming party', 'upcoming parties')}. This shouldn't be possible; take them down from the Frats page and report it.` }
          : { state: 'ok', detail: 'None, as expected.' };
      }],
      ['phones', 'Confirmed phones with no number', async () => {
        const { rows: [r] } = await pool.query('SELECT count(*)::int AS n FROM users WHERE phone_verified_at IS NOT NULL AND phone IS NULL');
        return r.n ? { state: 'bad', count: r.n, detail: `${plural(r.n, 'account')}. Their texts can't be delivered.` } : { state: 'ok', detail: 'None, as expected.' };
      }],
      ['orphans', 'Saves and requests for parties that no longer exist', async () => {
        const orphan = (t) => `SELECT count(*)::int FROM ${t} x WHERE x.party_id ~ '^h[0-9]{1,18}$'
          AND NOT EXISTS (SELECT 1 FROM hosted_parties hp WHERE hp.id = substring(x.party_id FROM 2)::bigint)`;
        const { rows: [r] } = await pool.query(`SELECT (${orphan('saved_parties')}) + (${orphan('invite_requests')}) + (${orphan('friend_going')}) AS n`);
        return r.n ? { state: 'warn', count: r.n, detail: `${plural(r.n, 'row')} point at a party that's gone. Harmless, but worth reporting.` } : { state: 'ok', detail: 'None.' };
      }],
      ['text_queue', 'Texts stuck waiting', async () => {
        const { rows: [r] } = await pool.query(`SELECT count(*)::int AS n FROM sms_outbox WHERE sent_at IS NULL AND failed_at IS NULL AND created_at < now() - interval '30 minutes'`);
        const { rows: [f] } = await pool.query(`SELECT count(*)::int AS n FROM sms_outbox WHERE failed_at > now() - interval '7 days'`);
        return r.n ? { state: 'warn', count: r.n, detail: `${plural(r.n, 'text')} waiting over 30 minutes. Check Texts in the Launch check.` }
          : { state: 'ok', detail: f.n ? `Nothing stuck. ${plural(f.n, 'text')} failed this week.` : 'Nothing stuck.' };
      }],
      ['inbox', 'Inbox items waiting over 3 days', async () => {
        const { rows: [r] } = await pool.query(`SELECT (SELECT count(*) FROM reports WHERE closed_at IS NULL AND created_at < now() - interval '3 days')
          + (SELECT count(*) FROM contact_messages WHERE closed_at IS NULL AND created_at < now() - interval '3 days') AS n`);
        const n = Number(r.n);
        return n ? { state: 'warn', count: n, detail: `${plural(n, 'report or message', 'reports and messages')}. Answer them on the Live page.` } : { state: 'ok', detail: 'All caught up.' };
      }],
      ['stale_requests', 'Unanswered requests for past parties', async () => {
        const { rows: [r] } = await pool.query(`SELECT count(*)::int AS n FROM invite_requests x JOIN hosted_parties hp ON x.party_id = 'h' || hp.id
          WHERE x.status = 'pending' AND hp.party_date < ${ET_TODAY}`);
        return { state: 'ok', count: r.n, detail: r.n ? `${plural(r.n, 'request')} were never answered before the party. Normal; kept as history.` : 'None.' };
      }],
    ];
    const steps = [];
    for (const [key, name, fn] of checks) {
      try { steps.push({ key, name, ...(await fn()) }); }
      catch (err) { steps.push({ key, name, state: 'warn', detail: `Couldn't check: ${err.message}` }); }
    }
    return steps;
  }

  // Fetches every page, then every file those pages load, the way a visitor's browser would.
  async function pages(base) {
    const get = async (url) => {
      try {
        const r = await fetch(base + url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'PhatFrats-maintenance' } });
        return { status: r.status, body: r.ok && /html/.test(r.headers.get('content-type') || '') ? await r.text() : (await r.arrayBuffer(), '') };
      } catch (err) { return { status: 0, error: err.name === 'TimeoutError' ? 'took over 8 seconds' : err.message }; }
    };
    const results = await Promise.all(PAGES.map(async (p) => ({ p, ...(await get(p)) })));
    const files = new Set();
    for (const r of results) {
      for (const m of r.body?.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="(\/(?!\/)[^"#]*)"/gi) || []) files.add(m[1]);
    }
    const fileResults = await Promise.all([...files].map(async (f) => ({ p: f, ...(await get(f)) })));
    const api = await Promise.all(['/api/beacon', '/api/maintenance'].map(async (p) => ({ p, ...(await get(p)) })));
    const broken = [...results, ...fileResults, ...api].filter((r) => r.status !== 200);
    const unreachable = broken.length && broken.every((r) => r.status === 0);
    const pageSteps = results.map((r) => ({
      key: 'page:' + r.p, name: `Page ${r.p}`,
      state: r.status === 200 && /<html/i.test(r.body) ? 'ok' : r.status === 0 ? 'warn' : 'bad',
      detail: r.status === 200 ? (/<html/i.test(r.body) ? 'Loads.' : "Loads, but isn't a web page.") : r.status === 0 ? `Couldn't reach it: ${r.error}.` : `Answered ${r.status}.`,
    }));
    const brokenFiles = [...fileResults, ...api].filter((r) => r.status !== 200);
    pageSteps.push({
      key: 'files', name: `Files the pages load (${fileResults.length}) and the site's API`,
      state: !brokenFiles.length ? 'ok' : brokenFiles.every((r) => r.status === 0) ? 'warn' : 'bad',
      detail: !brokenFiles.length ? `All ${fileResults.length + api.length} load.` : `Not loading: ${brokenFiles.map((r) => `${r.p} (${r.status || r.error})`).join(', ')}.`,
    });
    if (unreachable) pageSteps.push({ key: 'reach', name: 'Reaching the site', state: 'warn', detail: `The server couldn't reach ${base} to check it. Open the site yourself to make sure it loads.` });
    return pageSteps;
  }

  async function services() {
    const r = await launch.report(null);
    return r.items.map((i) => ({
      key: 'svc:' + i.key, name: i.name,
      state: i.state === 'bad' ? 'bad' : 'ok',
      detail: i.state === 'bad' ? i.detail : `${{ ok: 'Ready', warn: 'Working (see Launch check)', off: 'Not set up yet (see Launch check)', manual: 'Check yourself (see Launch check)' }[i.state] || i.state}.`,
    }));
  }

  // ---------- one run ----------
  async function run({ dryRun = false, trigger = 'admin', adminId = null, base }) {
    // Only one run at a time, across every server copy. A run that crashed frees the lock after 2 minutes.
    const { rowCount: got } = await pool.query(
      `INSERT INTO admin_settings (key, value) VALUES ('site_maint_running', jsonb_build_object('at', now()))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       WHERE (admin_settings.value->>'at')::timestamptz < now() - interval '2 minutes'`);
    if (!got) { const e = new Error('Maintenance is already running. Wait for it to finish.'); e.code = 'BUSY'; throw e; }
    const startedAt = new Date();
    const deadline = Date.now() + RUN_BUDGET_MS - 15000; // leaves time for the checks after clean-up
    const groups = [];
    try {
      const safe = async (key, name, fn) => {
        try { groups.push({ key, name, steps: await fn() }); }
        catch (err) { groups.push({ key, name, steps: [{ key: 'error', name, state: 'bad', detail: `This part failed: ${err.message}` }] }); }
      };
      await safe('cleanup', dryRun ? 'Clean-up (check only: nothing was changed)' : 'Clean-up', () => cleanup(dryRun, deadline));
      await safe('database', 'Database', database);
      await safe('data', 'Data checks', dataChecks);
      await safe('pages', 'Pages and files', () => pages(base));
      await safe('services', 'Outside services', services);
    } finally {
      await pool.query("DELETE FROM admin_settings WHERE key = 'site_maint_running'").catch(() => {});
    }
    const all = groups.flatMap((g) => g.steps);
    const summary = {
      ok: all.filter((s) => s.state === 'ok').length,
      warn: all.filter((s) => s.state === 'warn').length,
      bad: all.filter((s) => s.state === 'bad').length,
      cleared: dryRun ? 0 : groups.find((g) => g.key === 'cleanup')?.steps.reduce((n, s) => n + (s.count || 0), 0) || 0,
      wouldClear: dryRun ? groups.find((g) => g.key === 'cleanup')?.steps.reduce((n, s) => n + (s.count || 0), 0) || 0 : 0,
    };
    const finishedAt = new Date();
    const { rows: [saved] } = await pool.query(
      `INSERT INTO maintenance_runs (started_at, finished_at, trigger, admin_id, dry_run, summary, results)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING id`,
      [startedAt, finishedAt, trigger, adminId, dryRun, JSON.stringify(summary), JSON.stringify(groups)]);
    pool.query(`DELETE FROM maintenance_runs WHERE id NOT IN (SELECT id FROM maintenance_runs ORDER BY id DESC LIMIT ${KEEP_RUNS})`).catch(() => {});
    return { id: saved.id, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), trigger, dryRun, summary, groups };
  }

  function mount(app, { wrap, fail, requireUser }) {
    const requireAdmin = [requireUser, (req, res, next) => {
      if (req.user.role !== 'admin' || !req.user.admin_unlocked) return fail(res, 404, 'Not found.');
      res.set('Cache-Control', 'no-store');
      next();
    }];
    const baseOf = (req) => `${req.protocol}://${req.get('host')}`;
    const runRow = (r) => ({ id: Number(r.id), startedAt: r.started_at, finishedAt: r.finished_at, trigger: r.trigger, dryRun: r.dry_run, summary: r.summary, by: r.by_name || null });

    app.get('/api/admin/site-maintenance', requireAdmin, wrap(async (req, res) => {
      const [{ rows }, { rows: [last] }, { rows: [busy] }] = await Promise.all([
        pool.query(`SELECT m.id, m.started_at, m.finished_at, m.trigger, m.dry_run, m.summary, u.name AS by_name
                    FROM maintenance_runs m LEFT JOIN users u ON u.id = m.admin_id ORDER BY m.id DESC LIMIT 20`),
        pool.query('SELECT id, started_at, finished_at, trigger, dry_run, summary, results FROM maintenance_runs ORDER BY id DESC LIMIT 1'),
        pool.query(`SELECT 1 FROM admin_settings WHERE key = 'site_maint_running' AND (value->>'at')::timestamptz > now() - interval '2 minutes'`),
      ]);
      res.json({
        runs: rows.map(runRow),
        last: last ? { ...runRow(last), groups: last.results } : null,
        running: !!busy,
        nextMonthly: nextMonthly(),
        cleanups: [...CLEANUPS, ...FIXES].map((c) => c.name),
      });
    }));

    app.get('/api/admin/site-maintenance/runs/:id', requireAdmin, wrap(async (req, res) => {
      if (!/^\d{1,18}$/.test(req.params.id)) return fail(res, 404, 'Not found.');
      const { rows: [r] } = await pool.query(`SELECT m.*, u.name AS by_name FROM maintenance_runs m LEFT JOIN users u ON u.id = m.admin_id WHERE m.id = $1`, [req.params.id]);
      if (!r) return fail(res, 404, 'That run is no longer saved.');
      res.json({ ...runRow(r), groups: r.results });
    }));

    app.post('/api/admin/site-maintenance/run', requireAdmin, wrap(async (req, res) => {
      try {
        res.json(await run({ dryRun: req.body?.dryRun === true, trigger: 'admin', adminId: req.user.id, base: baseOf(req) }));
      } catch (err) {
        if (err.code === 'BUSY') return fail(res, 409, err.message, 'BUSY');
        throw err;
      }
    }));

    // Vercel's scheduler runs this on the 1st of every month (vercel.json). With CRON_SECRET set, only the
    // scheduler can call it. Without it, it still runs at most once every 20 hours, so it can't be used to load the site.
    app.get('/api/cron/site-maintenance', wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const secret = process.env.CRON_SECRET;
      if (secret && req.get('authorization') !== `Bearer ${secret}`) return fail(res, 401, 'Not allowed.');
      if (!secret) {
        const { rows: [recent] } = await pool.query(`SELECT 1 FROM maintenance_runs WHERE trigger = 'monthly' AND started_at > now() - interval '20 hours'`);
        if (recent) return res.json({ skipped: 'Already ran recently.' });
      }
      let result;
      try { result = await run({ trigger: 'monthly', base: baseOf(req) }); }
      catch (err) { if (err.code === 'BUSY') return res.json({ skipped: err.message }); throw err; }
      const { bad, warn } = result.summary;
      if (bad || warn) {
        await pool.query(
          `INSERT INTO notifications (user_id, kind, text, link)
           SELECT id, 'admin', $1, '/admin#maintenance' FROM users WHERE role = 'admin' AND banned_at IS NULL`,
          [`🔧 Monthly site maintenance finished: ${bad ? plural(bad, 'problem') : ''}${bad && warn ? ' and ' : ''}${warn ? plural(warn, 'thing') + ' to look at' : ''}. Open the control room's Maintenance page.`]);
      }
      res.json({ ok: true, id: result.id, summary: result.summary });
    }));
  }

  return { run, mount };
}

module.exports = { create, nextMonthly, CLEANUPS, FIXES };
