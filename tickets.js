// Ticketed events: chapters can sell tickets to philanthropy or alcohol-free events through their own
// Stripe account. PhatFrats is only the ticketing platform: the chapter is the seller and organizer,
// and PhatFrats may take a small platform fee (set in the control room, 0% for philanthropy by default).
//
// Guard rails, all enforced on the server:
// - Off for everyone until the site admin switches ticketing on in the control room.
// - Only philanthropy or alcohol-free events, confirmed by the chapter leader for each event.
// - A chapter must connect its own Stripe account and accept the chapter ticketing agreement first.
// - The admin can't accept agreements or confirm events on a chapter's behalf.
// - Buyers must accept the ticket terms before paying.
// - Cancelling a party refunds every ticket automatically.
// The terms themselves are on /about#ticket-terms. TERMS_VERSION is saved with every agreement.
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { PgStore, nameFor } = require('./rate-store.js');
const payments = require('./payments.js');
const partyList = require('./party-list.js');

const SITE_URL = process.env.SITE_URL || 'https://phat-frats.vercel.app';

// Send people back to the same PhatFrats address they paid from, so they're still logged in when they return
// (each address has its own login). Anything else falls back to SITE_URL. Local addresses only work off Vercel.
const HOME_ORIGINS = new Set([SITE_URL, 'https://phatfrats.vercel.app', 'https://phat-frats.vercel.app']);
const siteFor = (req) => {
  const o = req.get('origin') || '';
  if (HOME_ORIGINS.has(o) || (!process.env.VERCEL && /^http:\/\/localhost:\d{2,5}$/.test(o))) return o;
  return SITE_URL;
};
const TERMS_VERSION = '2026-11-11';
const KINDS = { philanthropy: 'Philanthropy event', alcohol_free: 'Alcohol-free event' };
const DEFAULTS = { on: false, feePct: 5, charityFeePct: 0 };
const MIN_CENTS = 100, MAX_CENTS = 10000;
// Ticket codes leave out letters and numbers that are easy to mix up at a door (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(8), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const dollars = (c) => '$' + (c / 100).toFixed(2).replace(/\.00$/, '');

function create({ pool, wrap, fail, requireUser, requireVerified, ops, community, CHAPTERS }) {
  const chapterName = (id) => CHAPTERS.find((c) => c.id === Number(id))?.name || 'the chapter';
  const stripe = () => payments.getClient();
  const limiter = (limit, message, minutes = 60) => rateLimit({
    windowMs: minutes * 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false,
    store: new PgStore(pool, nameFor('tickets', limit, message)), passOnStoreError: true,
    keyGenerator: (req) => (req.user ? 'u:' + req.user.id : 'ip:' + ipKeyGenerator(req.ip)),
    message: { error: message, code: 'RATE_LIMITED' },
  });

  async function settings() {
    const s = await ops.settings();
    const t = { ...DEFAULTS, ...(s.ticketing || {}) };
    return { on: !!t.on, feePct: Number(t.feePct) || 0, charityFeePct: Number(t.charityFeePct) || 0 };
  }
  const feeFor = (cents, kind, set) => Math.round(cents * (kind === 'philanthropy' ? set.charityFeePct : set.feePct) / 100);

  async function payoutsFor(chapterId) {
    const { rows: [p] } = await pool.query('SELECT * FROM chapter_payouts WHERE chapter_id = $1', [chapterId]);
    return p || null;
  }
  // Asks Stripe whether a connected account can take payments yet, and saves the answer.
  async function refreshPayouts(p) {
    if (!p || !p.stripe_account || p.ready || !stripe()) return p;
    try {
      const acct = await stripe().accounts.retrieve(p.stripe_account);
      if (acct.charges_enabled) {
        await pool.query('UPDATE chapter_payouts SET ready = TRUE, updated_at = now() WHERE chapter_id = $1', [p.chapter_id]);
        return { ...p, ready: true };
      }
    } catch (err) { console.error('Stripe account check failed:', err.message); }
    return p;
  }

  async function partyRow(hostedId) {
    if (!partyList.isHostedId(hostedId)) return null;
    const { rows: [p] } = await pool.query(
      `SELECT hp.*, to_char(hp.party_date, 'YYYY-MM-DD') AS day,
         (SELECT count(*) FROM tickets t WHERE t.party_id = 'h' || hp.id AND t.status IN ('paid', 'used'))::int AS sold
       FROM hosted_parties hp WHERE hp.id = $1`,
      [hostedId.slice(1)]
    );
    return p || null;
  }

  // Records a paid ticket. Safe to call more than once for the same payment (the page's confirm step and
  // Stripe's webhook can both arrive). A second paid ticket for the same person and event is refunded.
  async function record(session, account) {
    if (!session || session.metadata?.kind !== 'ticket' || session.payment_status !== 'paid') return null;
    const userId = session.metadata.user_id, partyId = session.metadata.party_id;
    if (!/^\d{1,18}$/.test(String(userId)) || !partyList.isHostedId(partyId)) return null;
    const existing = await pool.query('SELECT * FROM tickets WHERE stripe_session_id = $1', [session.id]);
    if (existing.rows[0]) return existing.rows[0];
    const party = await partyRow(partyId);
    if (!party) return null;
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
    for (let i = 0; i < 4; i++) {
      const { rows: [t] } = await pool.query(
        `INSERT INTO tickets (party_id, chapter_id, user_id, code, amount_cents, fee_cents, stripe_account, stripe_session_id,
           payment_intent, livemode, terms_version, agreed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT DO NOTHING RETURNING *`,
        [partyId, party.chapter_id, userId, newCode(), session.amount_total || 0, Number(session.metadata.fee_cents) || 0,
          account, session.id, pi, !!session.livemode, session.metadata.terms_version || TERMS_VERSION,
          session.metadata.agreed_at ? new Date(session.metadata.agreed_at) : new Date()]
      );
      if (t) {
        community.notify(userId, 'ticket', `🎟️ Your ticket for ${party.title} is ready. Your code is ${t.code}. Show it at the door with your Penn State ID.`, { link: '/?party=' + partyId })
          .catch((err) => console.error('Ticket note failed:', err.message));
        ops.activity('sale', `${dollars(t.amount_cents)} ticket sold for ${party.title}${t.livemode ? '' : ' (test)'}`);
        return t;
      }
      // Nothing inserted: either the code was taken (try another) or this person already holds a ticket.
      const { rows: [dup] } = await pool.query(`SELECT 1 FROM tickets WHERE party_id = $1 AND user_id = $2 AND status IN ('paid', 'used')`, [partyId, userId]);
      if (dup) {
        // Paid twice for the same event (two tabs at once): give the second payment back.
        if (pi && stripe()) await stripe().refunds.create({ payment_intent: pi, refund_application_fee: true }, { stripeAccount: account }).catch((err) => console.error('Duplicate ticket refund failed:', err.message));
        return null;
      }
    }
    throw new Error('Could not make a ticket code.');
  }

  // Refunds every ticket for a party (used when it's cancelled). Returns how many were refunded.
  async function refundParty(hostedId, reason = 'cancelled') {
    const { rows } = await pool.query(`SELECT t.*, hp.title FROM tickets t JOIN hosted_parties hp ON 'h' || hp.id = t.party_id WHERE t.party_id = $1 AND t.status IN ('paid', 'used')`, [hostedId]);
    let done = 0;
    for (const t of rows) {
      try {
        if (t.payment_intent && stripe()) await stripe().refunds.create({ payment_intent: t.payment_intent, refund_application_fee: true }, { stripeAccount: t.stripe_account });
        await pool.query(`UPDATE tickets SET status = 'refunded', refunded_at = now() WHERE id = $1`, [t.id]);
        done++;
        if (t.user_id) community.notify(t.user_id, 'ticket', `💸 ${t.title} was ${reason}, so your ${dollars(t.amount_cents)} ticket has been refunded to your card. It can take 5 to 10 days to show up.`, {})
          .catch(() => {});
      } catch (err) {
        console.error('Ticket refund failed:', t.id, err.message);
        if (t.user_id) community.notify(t.user_id, 'ticket', `⚠️ ${t.title} was ${reason}, but your ticket refund didn't go through automatically. Contact ${chapterName(t.chapter_id)} or the PhatFrats team from the About page and we'll sort it out.`, {})
          .catch(() => {});
      }
    }
    return done;
  }

  // What students see about a ticketed party (added to each party on the map).
  async function publicInfo(partyIds) {
    const ids = partyIds.filter(partyList.isHostedId).map((x) => x.slice(1));
    if (!ids.length) return new Map();
    const set = await settings();
    const { rows } = await pool.query(
      `SELECT 'h' || hp.id AS id, hp.ticket_cents, hp.ticket_kind, hp.ticket_cause, hp.cap,
         (SELECT count(*) FROM tickets t WHERE t.party_id = 'h' || hp.id AND t.status IN ('paid', 'used'))::int AS sold,
         coalesce(cp.ready, FALSE) AS ready
       FROM hosted_parties hp LEFT JOIN chapter_payouts cp ON cp.chapter_id = hp.chapter_id
       WHERE hp.id = ANY($1::bigint[]) AND hp.ticketed`,
      [ids]
    );
    return new Map(rows.map((r) => [r.id, {
      ticketed: set.on && r.ready, price: r.ticket_cents, ticketKind: r.ticket_kind, ticketKindLabel: KINDS[r.ticket_kind] || '',
      cause: r.ticket_cause || '', ticketsLeft: Math.max(0, r.cap - r.sold),
    }]));
  }

  function mount(app, { requireMember, requireLeader }) {
    const noAdminStandIn = (req, res, next) => {
      if (req.member?.admin) return fail(res, 403, "Only the chapter's own leader can do this, not the PhatFrats admin.", 'LEADER_ONLY');
      next();
    };

    // ---------- public ----------
    app.get('/api/tickets/config', wrap(async (req, res) => {
      const set = await settings();
      res.set('Cache-Control', 'no-store');
      res.json({ on: set.on && payments.enabled(), terms: TERMS_VERSION });
    }));

    // ---------- students ----------
    app.get('/api/tickets/mine', ...requireVerified, wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const { rows } = await pool.query(
        `SELECT t.party_id, t.code, t.status, t.amount_cents, t.used_at, t.created_at, hp.title, to_char(hp.party_date, 'YYYY-MM-DD') AS day, hp.start_time, hp.chapter_id
         FROM tickets t JOIN hosted_parties hp ON 'h' || hp.id = t.party_id
         WHERE t.user_id = $1 AND hp.party_date >= CURRENT_DATE - 14 ORDER BY hp.party_date, t.created_at`,
        [req.user.id]
      );
      res.json({ tickets: rows.map((t) => ({
        partyId: t.party_id, code: t.code, status: t.status, price: t.amount_cents, used: t.used_at, title: t.title, day: t.day,
        time: t.start_time, chapter: chapterName(t.chapter_id),
      })) });
    }));

    app.post('/api/tickets/checkout', ...requireVerified, limiter(20, 'Too many tries. Wait a few minutes.', 15), wrap(async (req, res) => {
      const set = await settings();
      if (!set.on || !stripe()) return fail(res, 503, "Ticket sales aren't open right now.", 'TICKETS_OFF');
      if (await ops.paused('checkout')) return fail(res, 503, 'Checkout is paused for a little while. Check back soon.', 'PAUSED');
      if (req.body?.agree !== true) return fail(res, 400, 'Read and accept the ticket terms first.', 'TERMS');
      const party = await partyRow(String(req.body?.partyId || ''));
      if (!party || !party.ticketed || party.status !== 'live' || party.day < partyList.todayISO()) return fail(res, 404, "Tickets for that event aren't on sale.");
      const payout = await refreshPayouts(await payoutsFor(party.chapter_id));
      if (!payout?.ready) return fail(res, 503, "This chapter can't take payments yet.", 'NOT_READY');
      if (party.sold >= party.cap) return fail(res, 409, 'Sold out.', 'SOLD_OUT');
      const { rows: [mine] } = await pool.query(`SELECT 1 FROM tickets WHERE party_id = $1 AND user_id = $2 AND status IN ('paid', 'used')`, ['h' + party.id, req.user.id]);
      if (mine) return fail(res, 409, 'You already have a ticket for this event.', 'HAVE_TICKET');
      const cents = party.ticket_cents, fee = feeFor(cents, party.ticket_kind, set), seller = chapterName(party.chapter_id);
      const when = partyList.dayLabel(party.day).long + ' at ' + party.start_time;
      const session = await stripe().checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd', unit_amount: cents,
            product_data: {
              name: `Ticket: ${party.title}`,
              description: `${seller} · ${when}. ${KINDS[party.ticket_kind]}${party.ticket_cause ? ' benefiting ' + party.ticket_cause : ''}. Sold by ${seller}; PhatFrats is the ticketing platform only.`,
            },
          },
        }],
        ...(fee > 0 ? { payment_intent_data: { application_fee_amount: fee } } : {}),
        customer_email: req.user.email,
        client_reference_id: String(req.user.id),
        metadata: { kind: 'ticket', user_id: String(req.user.id), party_id: 'h' + party.id, fee_cents: String(fee), terms_version: TERMS_VERSION, agreed_at: new Date().toISOString() },
        custom_text: { submit: { message: `Sold by ${seller}, which runs this event and handles any questions. By paying you accept the PhatFrats ticket terms (phatfrats.vercel.app/about#ticket-terms).` } },
        success_url: `${siteFor(req)}/?ticket=success&party=h${party.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteFor(req)}/?party=h${party.id}`,
      }, { stripeAccount: payout.stripe_account });
      res.json({ url: session.url });
    }));

    // The page calls this when the buyer comes back from Stripe, so the ticket shows up right away.
    app.post('/api/tickets/confirm', ...requireVerified, wrap(async (req, res) => {
      if (!stripe()) return fail(res, 503, "Ticket sales aren't open right now.", 'TICKETS_OFF');
      const id = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
      if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(id)) return fail(res, 400, "That checkout couldn't be found.");
      const party = await partyRow(String(req.body?.partyId || ''));
      const payout = party && await payoutsFor(party.chapter_id);
      if (!payout?.stripe_account) return fail(res, 404, "That checkout couldn't be found.");
      let session;
      try { session = await stripe().checkout.sessions.retrieve(id, {}, { stripeAccount: payout.stripe_account }); }
      catch (err) { return fail(res, 404, "That checkout couldn't be found."); }
      if (String(session.client_reference_id) !== String(req.user.id)) return fail(res, 403, 'That checkout belongs to another account.');
      if (session.payment_status !== 'paid') return fail(res, 402, "That payment hasn't gone through yet. If you were charged, refresh in a minute.", 'NOT_PAID');
      const t = await record(session, payout.stripe_account);
      const { rows: [mine] } = await pool.query(`SELECT code, status FROM tickets WHERE party_id = $1 AND user_id = $2 AND status IN ('paid', 'used')`, ['h' + party.id, req.user.id]);
      if (!mine) return fail(res, 409, "You already had a ticket, so this payment was refunded.", 'DUPLICATE');
      res.json({ ticket: { partyId: 'h' + party.id, code: mine.code, status: mine.status }, fresh: !!t });
    }));

    // ---------- chapters ----------
    // Ticketing status for the chapter page: the site switch, fees, this chapter's payouts and each event's sales.
    app.get('/api/chapter/tickets', ...requireMember, wrap(async (req, res) => {
      const set = await settings();
      const ch = req.member.chapter_id, leader = req.member.role === 'leader';
      const payout = await refreshPayouts(await payoutsFor(ch));
      const { rows } = await pool.query(
        `SELECT t.party_id, t.status, t.amount_cents, t.fee_cents, t.used_at, t.created_at, u.name
         FROM tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.chapter_id = $1 ORDER BY t.created_at`,
        [ch]
      );
      const byParty = {};
      for (const t of rows) {
        const b = byParty[t.party_id] || (byParty[t.party_id] = { sold: 0, used: 0, refunded: 0, grossCents: 0, feeCents: 0, holders: [] });
        if (t.status === 'refunded') b.refunded++; else { b.sold++; b.grossCents += t.amount_cents; b.feeCents += t.fee_cents; }
        if (t.status === 'used') b.used++;
        if (leader) b.holders.push({ name: t.name || 'Deleted account', status: t.status, used: t.used_at });
      }
      res.json({
        on: set.on && payments.enabled(), feePct: set.feePct, charityFeePct: set.charityFeePct, terms: TERMS_VERSION, kinds: KINDS,
        payouts: { connected: !!payout?.stripe_account, ready: !!payout?.ready, agreed: !!payout?.terms_at },
        parties: byParty,
      });
    }));

    // Connects the chapter's own Stripe account (Stripe's sign-up page), after the leader accepts the agreement.
    app.post('/api/chapter/payouts/connect', ...requireLeader, noAdminStandIn, limiter(10, 'Too many tries. Wait a few minutes.', 15), wrap(async (req, res) => {
      const set = await settings();
      if (!set.on || !stripe()) return fail(res, 503, "Ticketing isn't open yet.", 'TICKETS_OFF');
      if (req.body?.agree !== true) return fail(res, 400, 'Read and accept the chapter ticketing agreement first.', 'TERMS');
      const ch = req.member.chapter_id;
      await pool.query(
        `INSERT INTO chapter_payouts (chapter_id, terms_at, terms_by, terms_version) VALUES ($1, now(), $2, $3)
         ON CONFLICT (chapter_id) DO UPDATE SET terms_at = now(), terms_by = $2, terms_version = $3, updated_at = now()`,
        [ch, req.user.id, TERMS_VERSION]
      );
      let payout = await payoutsFor(ch);
      try {
        if (!payout.stripe_account) {
          const acct = await stripe().accounts.create({ type: 'standard', email: req.user.email, metadata: { chapter_id: String(ch), chapter: chapterName(ch) } });
          await pool.query('UPDATE chapter_payouts SET stripe_account = $2, updated_at = now() WHERE chapter_id = $1', [ch, acct.id]);
          payout = { ...payout, stripe_account: acct.id };
        }
        const link = await stripe().accountLinks.create({
          account: payout.stripe_account, type: 'account_onboarding',
          refresh_url: `${siteFor(req)}/frats?payouts=retry`, return_url: `${siteFor(req)}/frats?payouts=done`,
        });
        res.json({ url: link.url });
      } catch (err) {
        console.error('Stripe Connect setup failed:', err.message);
        fail(res, 502, "Stripe couldn't start the payout setup. Try again later, or contact the PhatFrats team.", 'CONNECT_FAILED');
      }
    }));

    // Turns ticket sales on or off for one event, with the leader's confirmation that it qualifies.
    app.post('/api/chapter/parties/:id/ticket', ...requireLeader, noAdminStandIn, wrap(async (req, res) => {
      const party = await partyRow('h' + String(req.params.id).replace(/^h/, ''));
      if (!party || party.chapter_id !== req.member.chapter_id) return fail(res, 404, "That party isn't one of your chapter's.");
      if (req.body?.on !== true) {
        if (party.sold > 0) return fail(res, 409, `${party.sold} ticket${party.sold === 1 ? ' has' : 's have'} been sold. To stop the event, cancel it and everyone is refunded automatically.`, 'HAS_SALES');
        await pool.query('UPDATE hosted_parties SET ticketed = FALSE, updated_at = now() WHERE id = $1', [party.id]);
        return res.json({ ok: true, ticketed: false });
      }
      const set = await settings();
      if (!set.on || !stripe()) return fail(res, 503, "Ticketing isn't open yet.", 'TICKETS_OFF');
      const payout = await refreshPayouts(await payoutsFor(party.chapter_id));
      if (!payout?.ready) return fail(res, 400, 'Connect your chapter\'s payouts with Stripe first.', 'NOT_READY');
      if (party.status !== 'live' || party.day < partyList.todayISO()) return fail(res, 400, "Tickets can only be sold for an upcoming event that's on the map.");
      const kind = KINDS[req.body?.kind] ? req.body.kind : null;
      if (!kind) return fail(res, 400, 'Choose what kind of event this is.');
      const cause = typeof req.body?.cause === 'string' ? req.body.cause.trim().slice(0, 80) : '';
      if (kind === 'philanthropy' && cause.length < 3) return fail(res, 400, 'Name the charity or cause the money goes to.');
      const cents = Math.round(Number(req.body?.price) * 100);
      if (!Number.isFinite(cents) || cents < MIN_CENTS || cents > MAX_CENTS) return fail(res, 400, `Set a ticket price between ${dollars(MIN_CENTS)} and ${dollars(MAX_CENTS)}.`);
      if (party.sold > 0 && party.ticketed && cents !== party.ticket_cents) return fail(res, 409, "The price can't change after tickets have been sold.", 'HAS_SALES');
      if (req.body?.attest !== true) return fail(res, 400, 'Confirm the event qualifies before selling tickets.', 'ATTEST');
      await pool.query(
        `UPDATE hosted_parties SET ticketed = TRUE, ticket_cents = $2, ticket_kind = $3, ticket_cause = $4,
           ticket_attest_at = now(), ticket_attest_by = $5, ticket_terms = $6, updated_at = now()
         WHERE id = $1`,
        [party.id, cents, kind, cause || null, req.user.id, TERMS_VERSION]
      );
      res.json({ ok: true, ticketed: true });
    }));

    // Checking tickets at the door: any brother of the hosting chapter can do it.
    app.post('/api/chapter/tickets/check', ...requireMember, limiter(240, 'Too many checks. Wait a minute.', 1), wrap(async (req, res) => {
      const code = String(req.body?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 8) return fail(res, 400, 'Ticket codes are 8 letters and numbers.');
      const { rows: [t] } = await pool.query(
        `SELECT t.*, hp.title, u.name FROM tickets t JOIN hosted_parties hp ON 'h' || hp.id = t.party_id LEFT JOIN users u ON u.id = t.user_id
         WHERE t.code = $1 AND t.chapter_id = $2`,
        [code, req.member.chapter_id]
      );
      if (!t) return fail(res, 404, "No ticket with that code for your chapter's events.", 'NO_TICKET');
      if (t.status === 'refunded') return fail(res, 409, `That ticket for ${t.title} was refunded. It's not valid.`, 'REFUNDED');
      if (t.status === 'used') return res.json({ ok: false, already: true, name: t.name, title: t.title, used: t.used_at });
      await pool.query(`UPDATE tickets SET status = 'used', used_at = now(), used_by = $2 WHERE id = $1 AND status = 'paid'`, [t.id, req.user.id]);
      res.json({ ok: true, name: t.name, title: t.title });
    }));
  }

  // ---------- control room ----------
  function mountAdmin(app) {
    const requireAdmin = [requireUser, (req, res, next) => {
      if (req.user.role !== 'admin' || !req.user.admin_unlocked) return fail(res, 404, 'Not found.');
      res.set('Cache-Control', 'no-store');
      next();
    }];
    app.get('/api/admin/ticketing', requireAdmin, wrap(async (req, res) => {
      const set = await settings();
      const { rows: [sum] } = await pool.query(
        `SELECT count(*) FILTER (WHERE status IN ('paid', 'used'))::int AS sold, coalesce(sum(amount_cents) FILTER (WHERE status IN ('paid', 'used')), 0)::int AS gross,
           coalesce(sum(fee_cents) FILTER (WHERE status IN ('paid', 'used')), 0)::int AS fees, count(*) FILTER (WHERE status = 'refunded')::int AS refunded,
           (SELECT count(*) FROM chapter_payouts WHERE ready)::int AS chapters
         FROM tickets`
      );
      res.json({ ...set, stripe: payments.enabled(), totals: sum });
    }));
    app.post('/api/admin/ticketing', requireAdmin, wrap(async (req, res) => {
      const pct = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 20 ? Math.round(n * 10) / 10 : d; };
      const cur = await settings();
      const next = {
        on: typeof req.body?.on === 'boolean' ? req.body.on : cur.on,
        feePct: pct(req.body?.feePct, cur.feePct),
        charityFeePct: pct(req.body?.charityFeePct, cur.charityFeePct),
      };
      await ops.setSetting('ticketing', next);
      res.json(next);
    }));
  }

  // Stripe sends events from chapters' connected accounts here (a separate "Connect" webhook in Stripe).
  // server.js registers it at /api/stripe/connect-webhook with the raw body, before the JSON parser.
  const webhookHandler = wrap(async (req, res) => {
      const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
      if (!stripe() || !secret) return res.status(503).json({ error: 'Not set up.' });
      let event;
      try { event = stripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret); }
      catch (err) { return res.status(400).json({ error: 'Bad signature.' }); }
      const obj = event.data.object;
      if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && event.account) {
        await record(obj, event.account);
      } else if (event.type === 'account.updated' && obj.charges_enabled) {
        await pool.query('UPDATE chapter_payouts SET ready = TRUE, updated_at = now() WHERE stripe_account = $1', [obj.id]);
      } else if (event.type === 'charge.refunded' && obj.payment_intent) {
        await pool.query(`UPDATE tickets SET status = 'refunded', refunded_at = coalesce(refunded_at, now()) WHERE payment_intent = $1 AND status <> 'refunded'`, [obj.payment_intent]);
      }
      res.json({ received: true });
  });

  return { mount, mountAdmin, webhookHandler, refundParty, publicInfo, record, settings, TERMS_VERSION };
}

module.exports = { create, TERMS_VERSION, KINDS };
