// The control room's Launch check: is every outside service PhatFrats depends on set up and answering?
// It shows which settings are present and what mode they're in, never the secret values themselves.
// Test buttons send the admin a real text and a real email, so "it works" is something you can see.
const sms = require('./sms.js');

module.exports = function launchCheck(app, { pool, wrap, fail, requireUser, ops, community }) {
  const requireAdmin = [requireUser, (req, res, next) => {
    if (req.user.role !== 'admin' || !req.user.admin_unlocked) return fail(res, 404, 'Not found.');
    res.set('Cache-Control', 'no-store');
    next();
  }];
  const env = (k) => (process.env[k] || '').trim();
  const has = (k) => !!env(k);

  // The launch to-do list: things outside the site that only the admin can do.
  const TODO = [
    { key: 'uptime', name: 'Uptime monitor', doneText: 'UptimeRobot watches /api/health every 5 minutes and emails you if the site goes down.',
      detail: 'Point a free monitor (UptimeRobot or Better Stack) at /api/health so you hear within minutes if the site goes down. Steps are on the Maintenance page.' },
    { key: 'hosting', name: 'Hosting (Vercel Pro)', doneText: 'The project is on Vercel Pro, so charging money is allowed.',
      detail: 'Vercel\'s free Hobby plan is for non-commercial use only. Move the project to Pro before the first real payment.' },
    { key: 'neon_paid', name: 'Paid database plan (Neon)', doneText: 'The database is on a paid plan: no size cap worries, and 7+ days of backups.',
      detail: 'Move to a paid Neon plan before a wide launch: more room for busy nights, no pause when idle, and 7+ days to undo mistakes (the free plan keeps 6 hours).' },
    { key: 'legal', name: 'Legal review', doneText: 'A lawyer reviewed the terms, the party disclaimer, the Host Agreement and ticketing.',
      detail: 'Have Penn State Law\'s Entrepreneur Assistance Clinic (or Student Legal Services) review the terms, the party disclaimer, the Host Agreement and ticketing. Keep ticketing off until then.' },
    { key: 'song', name: 'Theme song rights', doneText: 'The Door Rush song is cleared for commercial use.',
      detail: 'Door Rush\'s song "On The List" (Suno) is only yours to use commercially if a paid Suno plan was active when it was made. Check, or remake it while subscribed.' },
    { key: 'phones', name: 'Real phone test', doneText: 'Clicked through on a real iPhone and a real Android.',
      detail: 'Click through sign-up, requests, friends, Door Rush and a test payment on a real iPhone and a real Android.' },
  ];

  // Asks Twilio about the account with the saved keys. Free, and sends nothing.
  async function twilioAnswers() {
    if (!has('TWILIO_ACCOUNT_SID') || !has('TWILIO_AUTH_TOKEN')) return null;
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env('TWILIO_ACCOUNT_SID'))}.json`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`${env('TWILIO_ACCOUNT_SID')}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64') },
        signal: AbortSignal.timeout(6000),
      });
      const d = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, status: d.status, trial: d.type === 'Trial' } : { ok: false, error: d.message || `Twilio said ${r.status}` };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  // Every outside service's state, for the Launch check card and for Site maintenance. userId: whose phone to show.
  async function report(userId) {
    const s = await ops.settings();
    const stripeKey = env('STRIPE_SECRET_KEY');
    const stripeMode = !stripeKey ? null : /^(sk|rk)_live_/.test(stripeKey) ? 'live' : 'test';
    const smtp = env('SMTP_HOST');
    const tw = await twilioAnswers();
    const [{ rows: [ph] }, { rows: [box] }, { rows: [me] }] = await Promise.all([
      pool.query(`SELECT count(*)::int AS users, count(*) FILTER (WHERE phone_verified_at IS NOT NULL)::int AS confirmed FROM users WHERE email_verified_at IS NOT NULL AND banned_at IS NULL`),
      pool.query(`SELECT count(*) FILTER (WHERE sent_at > now() - interval '1 day')::int AS sent, count(*) FILTER (WHERE sent_at IS NULL AND failed_at IS NULL)::int AS waiting,
                    count(*) FILTER (WHERE failed_at > now() - interval '1 day')::int AS failed,
                    (SELECT last_error FROM sms_outbox WHERE failed_at IS NOT NULL ORDER BY failed_at DESC LIMIT 1) AS last_error
                  FROM sms_outbox`),
      pool.query('SELECT email, phone, phone_verified_at FROM users WHERE id = $1', [userId || 0]),
    ]);
    // ok: green. warn: works, but needs attention before launch. off: not set up.
    const items = [
      {
        key: 'payments', name: 'Payments (Stripe)',
        state: !stripeKey ? 'off' : stripeMode === 'live' && has('STRIPE_WEBHOOK_SECRET') ? 'ok' : 'warn',
        detail: !stripeKey ? 'STRIPE_SECRET_KEY is missing, so checkout is off.'
          : stripeMode === 'test' ? 'Test mode: checkout works with test cards only. Switch to live keys to take real money.'
          : has('STRIPE_WEBHOOK_SECRET') ? 'Live mode, with the payment webhook set.' : 'Live mode, but STRIPE_WEBHOOK_SECRET is missing, so payments can\'t confirm by webhook.',
      },
      {
        key: 'tickets', name: 'Ticket payouts (Stripe Connect)',
        state: !s.ticketing?.on ? 'ok' : stripeMode === 'live' ? 'ok' : 'warn',
        detail: !s.ticketing?.on ? 'Ticketing is switched off in Money, as planned until the legal review is done.'
          : (stripeMode === 'live' ? 'Ticketing is on with live keys.' : 'Ticketing is on, but Stripe is in test mode.') + (has('STRIPE_CONNECT_WEBHOOK_SECRET') ? '' : ' Optional: add STRIPE_CONNECT_WEBHOOK_SECRET.'),
      },
      {
        key: 'texts', name: 'Texts (Twilio)',
        state: !sms.enabled() ? 'off' : tw && !tw.ok ? 'bad' : tw?.trial ? 'warn' : 'ok',
        detail: !sms.enabled() ? 'Not set up, so invite details and confirmations go by email. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID in Vercel.'
          : tw && !tw.ok ? `Twilio rejected the keys: ${tw.error}`
          : tw?.trial ? 'Connected, but the Twilio account is a trial: it can only text numbers you verify in Twilio. Upgrade it and finish A2P 10DLC registration.'
          : `Connected. ${box.sent} sent in the last day${box.waiting ? `, ${box.waiting} waiting` : ''}${box.failed ? `, ${box.failed} failed (last error: ${box.last_error})` : ''}. Carriers only deliver once A2P 10DLC registration is approved.`,
        extra: `${ph.confirmed} of ${ph.users} accounts have a confirmed phone.`,
      },
      {
        key: 'email', name: 'Email',
        state: !smtp ? 'off' : /gmail\.com$/i.test(smtp) ? 'warn' : 'ok',
        detail: !smtp ? 'SMTP_HOST is missing, so confirmation codes can\'t be emailed.'
          : /gmail\.com$/i.test(smtp) ? 'Working through Gmail, which caps sending at about 500 emails a day. Move to a sending service (Resend, Postmark) before a big launch.'
          : `Sending through ${smtp}.`,
      },
      {
        key: 'phatbot', name: 'PhatBot (Claude)',
        state: has('ANTHROPIC_API_KEY') ? 'ok' : 'off',
        detail: has('ANTHROPIC_API_KEY') ? 'The API key is set.' : 'ANTHROPIC_API_KEY is missing, so PhatBot is off.',
      },
      {
        key: 'database', name: 'Database (Neon)',
        state: /-pooler\./.test(env('DATABASE_URL')) ? 'warn' : 'bad',
        detail: /-pooler\./.test(env('DATABASE_URL'))
          ? 'Connected through the pooled address. Neon\'s free plan has a small, fixed size: move to a paid plan before launch.'
          : 'DATABASE_URL isn\'t the pooled (-pooler) address, which can run out of connections under load.',
      },
      {
        key: 'cron', name: 'Weekly Door Rush prize',
        state: has('CRON_SECRET') ? 'ok' : 'warn',
        detail: has('CRON_SECRET') ? 'CRON_SECRET is set, so only Vercel\'s scheduler can run the Monday prize.' : 'Runs, but anyone could trigger it. Add CRON_SECRET in Vercel.',
      },
      {
        key: 'site', name: 'Site settings',
        state: s.hide_demo ? 'ok' : 'warn',
        detail: (s.hide_demo ? 'Demo parties are hidden.' : 'Demo parties are still showing.') + (s.lockdown && Object.values(s.lockdown).some(Boolean) ? ' Some features are paused in Live.' : ''),
      },
      // Things only you can do. Mark each one done when it is; the site can't check them itself.
      ...TODO.map((t) => {
        const done = (s.launch_done || {})[t.key];
        return {
          key: t.key, name: t.name, manual: true, done: done ? done.at : null,
          state: done ? 'ok' : 'manual',
          detail: done ? `${t.doneText} Marked done ${new Date(done.at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}.` : t.detail,
        };
      }),
    ];
    return {
      items,
      me: { email: me?.email || null, phone: sms.pretty(me?.phone), phoneVerified: !!me?.phone_verified_at },
      checkedAt: new Date().toISOString(),
    };
  }

  app.get('/api/admin/launch-check', requireAdmin, wrap(async (req, res) => {
    res.json(await report(req.user.id));
  }));

  // Ticks a to-do item off (or back on).
  app.post('/api/admin/launch-check/done', requireAdmin, wrap(async (req, res) => {
    const key = req.body?.key;
    if (!TODO.some((t) => t.key === key) || typeof req.body?.done !== 'boolean') return fail(res, 400, 'Unknown item.', 'BAD_ITEM');
    const all = { ...((await ops.settings()).launch_done || {}) };
    if (req.body.done) all[key] = { at: new Date().toISOString(), by: req.user.id };
    else delete all[key];
    await ops.setSetting('launch_done', Object.keys(all).length ? all : null);
    res.json({ ok: true });
  }));

  // Sends the admin a real text, straight away (not through the outbox), and reports what Twilio said.
  app.post('/api/admin/launch-check/text', requireAdmin, wrap(async (req, res) => {
    if (!sms.enabled()) return fail(res, 400, 'Texts aren\'t set up yet. Add the Twilio keys in Vercel first.', 'TEXTS_OFF');
    const { rows: [me] } = await pool.query('SELECT phone, phone_verified_at FROM users WHERE id = $1', [req.user.id]);
    if (!me?.phone || !me.phone_verified_at) return fail(res, 400, 'Confirm your own phone first: open your profile on the main site and add your number.', 'NO_PHONE');
    try {
      const r = await sms.sendNow(me.phone, 'PhatFrats: test text from the control room. Texts are working! Reply STOP to opt out.');
      res.json({ ok: true, to: sms.pretty(me.phone), status: r.status || 'sent' });
    } catch (err) {
      fail(res, 502, `Twilio didn't send it: ${err.message}`, 'TEXT_FAILED');
    }
  }));

  // Sends the admin a real email.
  app.post('/api/admin/launch-check/email', requireAdmin, wrap(async (req, res) => {
    if (!has('SMTP_HOST')) return fail(res, 400, "Email isn't set up: SMTP_HOST is missing.", 'EMAIL_OFF');
    try {
      await community.sendMail(req.user.email, 'PhatFrats test email', 'This is a test email from the PhatFrats control room. Email is working.');
      res.json({ ok: true, to: req.user.email });
    } catch (err) {
      fail(res, 502, `The email didn't send: ${err.message}`, 'EMAIL_FAILED');
    }
  }));

  return { report };
};
