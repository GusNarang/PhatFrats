// Full Access checkout through Stripe. Checkout stays off until STRIPE_SECRET_KEY is set.
// A paid checkout grants Full Access through the end of the current semester (see PRICING.passEnds).
// Two paths grant it, so a payment counts even if one fails: Stripe's webhook, and the
// confirmation the page asks for when the buyer comes back from Stripe.
const crypto = require('crypto');
const Stripe = require('stripe');
const PRICING = require('./public/pricing.js');

const SITE_URL = process.env.SITE_URL || 'https://phat-frats.vercel.app';

// Send people back to the same PhatFrats address they paid from, so they're still logged in when they return
// (each address has its own login). Anything else falls back to SITE_URL. Local addresses only work off Vercel.
const HOME_ORIGINS = new Set([SITE_URL, 'https://phatfrats.vercel.app', 'https://phat-frats.vercel.app']);
const siteFor = (req) => {
  const o = req.get('origin') || '';
  if (HOME_ORIGINS.has(o) || (!process.env.VERCEL && /^http:\/\/localhost:\d{2,5}$/.test(o))) return o;
  return SITE_URL;
};
const ZONE = 'America/New_York';
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

let client = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const enabled = () => !!client;
// Tests swap in a stand-in for Stripe.
const useClient = (c) => { client = c; };

function create({ pool, wrap, fail, requireVerified, accountPayload, loadUser, ops }) {
  // A promo code someone can still use, or a message saying why not.
  async function promoFor(raw) {
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (!code) return null;
    const { rows: [p] } = await pool.query(
      'SELECT code, percent_off, max_uses, uses, ends_at, active FROM promo_codes WHERE code = $1',
      [code]
    );
    if (!p || !p.active) return "That promo code doesn't exist.";
    if (p.ends_at && new Date(p.ends_at) < new Date()) return 'That promo code has expired.';
    if (p.max_uses != null && p.uses >= p.max_uses) return 'That promo code has been used up.';
    return p;
  }

  // Records a paid checkout and grants the pass. Safe to call more than once for the same payment.
  async function grant(session) {
    if (!session || session.mode !== 'payment' || session.payment_status !== 'paid') return false;
    const userId = session.metadata?.user_id || session.client_reference_id;
    if (!/^\d{1,18}$/.test(String(userId || ''))) return false;
    const passUntil = session.metadata?.pass_until || PRICING.passEnds(todayISO());
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const { rows: [made] } = await db.query(
        `INSERT INTO payments (stripe_session_id, user_id, amount_cents, currency, payment_intent, pass_until, livemode, promo_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (stripe_session_id) DO NOTHING RETURNING stripe_session_id`,
        [session.id, userId, session.amount_total || 0, session.currency || 'usd',
          typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
          passUntil, !!session.livemode, session.metadata?.promo_code || null]
      );
      if (made) {
        // Pass ends at midnight Eastern after its last day. Someone given Full Access by hand with no
        // end date keeps it. Buying again never shortens a pass.
        await db.query(
          `UPDATE users SET plan = 'full', plan_paid_at = now(),
             plan_paid_until = CASE
               WHEN plan = 'full' AND plan_paid_until IS NULL THEN NULL
               ELSE GREATEST(coalesce(plan_paid_until, now()), ($2::date + 1)::timestamp AT TIME ZONE '${ZONE}')
             END
           WHERE id = $1`,
          [userId, passUntil]
        );
      }
      if (made && session.metadata?.promo_code && !session.metadata?.promo_claimed) {
        await db.query('UPDATE promo_codes SET uses = uses + 1 WHERE code = $1', [session.metadata.promo_code]);
      }
      await db.query('COMMIT');
      if (made && ops) {
        const dollars = '$' + ((session.amount_total || 0) / 100).toFixed(2);
        ops.activity('sale', `${dollars} Full Access sale${session.metadata?.promo_code ? ` with ${session.metadata.promo_code}` : ''}${session.livemode ? '' : ' (test)'}`);
      }
      return !!made;
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      db.release();
    }
  }

  // Stripe calls this after a payment. server.js registers it with the raw body, before the JSON parser.
  const webhookHandler = wrap(async (req, res) => {
      if (!client || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'Payments are off.' });
      let event;
      try {
        event = client.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        console.error('Stripe webhook signature check failed:', err.message);
        return res.status(400).json({ error: 'Bad signature.' });
      }
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        await grant(event.data.object);
      }
      res.json({ received: true });
  });

  function mountRoutes(app) {
    // Starts a Stripe Checkout page for one semester of Full Access.
    app.post('/api/checkout', ...requireVerified, wrap(async (req, res) => {
      if (!client) return fail(res, 503, "Checkout isn't open yet. Check back soon.", 'CHECKOUT_OFF');
      if (ops && await ops.paused('checkout')) return fail(res, 503, 'Checkout is paused for a little while. Check back soon.', 'PAUSED');
      const { rows: [u] } = await pool.query(
        `SELECT plan, plan_paid_until, plan_paid_until > now() + interval '30 days' AS long_pass FROM users WHERE id = $1`,
        [req.user.id]
      );
      if (u.plan === 'full' && (u.plan_paid_until === null || u.long_pass)) {
        return fail(res, 409, 'You already have Full Access.', 'ALREADY_FULL');
      }
      const passUntil = PRICING.passEnds(todayISO());
      const promo = await promoFor(req.body?.code);
      if (typeof promo === 'string') return fail(res, 400, promo, 'BAD_PROMO');
      let cents = Math.round(PRICING.current() * 100 * (100 - (promo?.percent_off || 0)) / 100);
      // A 100% code needs no payment, so the pass is granted straight away. Its use is claimed in one
      // statement first, so two people can't both take a code's last use.
      if (promo && cents === 0) {
        const { rowCount: claimed } = await pool.query(
          `UPDATE promo_codes SET uses = uses + 1
           WHERE code = $1 AND active AND (max_uses IS NULL OR uses < max_uses) AND (ends_at IS NULL OR ends_at > now())`,
          [promo.code]
        );
        if (!claimed) return fail(res, 400, 'That promo code has been used up.', 'BAD_PROMO');
        await grant({
          id: 'promo_' + crypto.randomBytes(12).toString('hex'), mode: 'payment', payment_status: 'paid', amount_total: 0, currency: 'usd',
          livemode: String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_'),
          metadata: { user_id: String(req.user.id), pass_until: passUntil, promo_code: promo.code, promo_claimed: '1' },
        });
        return res.json({ granted: true, ...(await accountPayload(await loadUser(req.user.id))) });
      }
      // Stripe's smallest card charge is 50 cents.
      cents = Math.max(50, cents);
      const session = await client.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: cents,
            product_data: {
              name: 'PhatFrats Full Access',
              description: `Unlimited invite requests, priority with hosts, early access to new parties and PhatBot, through ${PRICING.passEndLabel(passUntil)}. One payment, no auto-renew.`,
            },
          },
        }],
        customer_email: req.user.email,
        client_reference_id: String(req.user.id),
        metadata: { user_id: String(req.user.id), pass_until: passUntil, ...(promo ? { promo_code: promo.code } : {}) },
        success_url: `${siteFor(req)}/?checkout=success&session_id={CHECKOUT_SESSION_ID}#plans`,
        cancel_url: `${siteFor(req)}/?checkout=cancel#plans`,
      });
      res.json({ url: session.url });
    }));

    // The page calls this when the buyer comes back from Stripe, so Full Access shows up right away.
    app.post('/api/checkout/confirm', ...requireVerified, wrap(async (req, res) => {
      if (!client) return fail(res, 503, "Checkout isn't open yet.", 'CHECKOUT_OFF');
      const id = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
      if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(id)) return fail(res, 400, "That checkout couldn't be found.");
      let session;
      try { session = await client.checkout.sessions.retrieve(id); }
      catch (err) { return fail(res, 404, "That checkout couldn't be found."); }
      if (String(session.client_reference_id) !== String(req.user.id)) return fail(res, 403, "That checkout belongs to another account.");
      if (session.payment_status !== 'paid') return fail(res, 402, "That payment hasn't gone through yet. If you were charged, refresh in a minute.", 'NOT_PAID');
      await grant(session);
      res.json(await accountPayload(await loadUser(req.user.id)));
    }));
  }

  return { grant, webhookHandler, mountRoutes };
}

// Ticketed events (tickets.js) use the same Stripe account, acting for each chapter's connected account.
const getClient = () => client;

module.exports = { create, enabled, useClient, getClient };
