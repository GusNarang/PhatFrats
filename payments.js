// Full Access checkout through Stripe. Checkout stays off until STRIPE_SECRET_KEY is set.
// A paid checkout grants Full Access through the end of the current semester (see PRICING.passEnds).
// Two paths grant it, so a payment counts even if one fails: Stripe's webhook, and the
// confirmation the page asks for when the buyer comes back from Stripe.
const Stripe = require('stripe');
const PRICING = require('./public/pricing.js');

const SITE_URL = process.env.SITE_URL || 'https://phat-frats.vercel.app';
const ZONE = 'America/New_York';
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

let client = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const enabled = () => !!client;
// Tests swap in a stand-in for Stripe.
const useClient = (c) => { client = c; };

function create({ pool, wrap, fail, requireVerified, accountPayload }) {
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
        `INSERT INTO payments (stripe_session_id, user_id, amount_cents, currency, payment_intent, pass_until, livemode)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (stripe_session_id) DO NOTHING RETURNING stripe_session_id`,
        [session.id, userId, session.amount_total || 0, session.currency || 'usd',
          typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
          passUntil, !!session.livemode]
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
      await db.query('COMMIT');
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
      const { rows: [u] } = await pool.query(
        `SELECT plan, plan_paid_until, plan_paid_until > now() + interval '30 days' AS long_pass FROM users WHERE id = $1`,
        [req.user.id]
      );
      if (u.plan === 'full' && (u.plan_paid_until === null || u.long_pass)) {
        return fail(res, 409, 'You already have Full Access.', 'ALREADY_FULL');
      }
      const passUntil = PRICING.passEnds(todayISO());
      const cents = Math.round(PRICING.current() * 100);
      const session = await client.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: cents,
            product_data: {
              name: 'PhatFrats Full Access',
              description: `Unlimited invite requests, priority with hosts, PhatBot and Door Rush, through ${PRICING.passEndLabel(passUntil)}. One payment, no auto-renew.`,
            },
          },
        }],
        customer_email: req.user.email,
        client_reference_id: String(req.user.id),
        metadata: { user_id: String(req.user.id), pass_until: passUntil },
        success_url: `${SITE_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}#plans`,
        cancel_url: `${SITE_URL}/?checkout=cancel#plans`,
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
      const { rows: [user] } = await pool.query(
        'SELECT id, name, email, plan, role, email_verified_at, plan_paid_until FROM users WHERE id = $1',
        [req.user.id]
      );
      res.json(await accountPayload(user));
    }));
  }

  return { grant, webhookHandler, mountRoutes };
}

module.exports = { create, enabled, useClient };
