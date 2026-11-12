// Text messages (SMS) through Twilio's REST API. Invite details and confirmations go to a student's
// confirmed phone by text instead of email. Messages go into sms_outbox first and are sent from there,
// so a burst (a frat inviting a whole sorority) never holds up a request, and a failed send is retried.
//
// Turn it on with these environment variables (Vercel: add them as Sensitive):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_MESSAGING_SERVICE_SID (recommended) or TWILIO_FROM.
// Until they're set, texts are off and the site keeps using email (and the bell) as before.
const SID = process.env.TWILIO_ACCOUNT_SID || '';
const TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const SERVICE = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
const FROM = process.env.TWILIO_FROM || '';
const IS_PROD = !!process.env.VERCEL || process.env.NODE_ENV === 'production';

const enabled = () => !!(SID && TOKEN && (SERVICE || FROM));
// Stand-in sender for tests: useSender(async (to, body) => ...).
let sender = null;
function useSender(fn) { sender = fn; }

// A US mobile number as +1XXXXXXXXXX, or null. Takes "(814) 555-1234", "814.555.1234", "+1 814 555 1234" and so on.
function normalize(input) {
  if (typeof input !== 'string') return null;
  let d = input.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return null;
  // Area codes and exchanges never start with 0 or 1; 555-01xx numbers are fictional.
  if (/^[01]/.test(d) || /^[01]/.test(d.slice(3))) return null;
  return '+1' + d;
}
const pretty = (e164) => (e164 && /^\+1\d{10}$/.test(e164) ? `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}` : '');
// Shows only the last 4 digits.
const masked = (e164) => (e164 && /^\+1\d{10}$/.test(e164) ? `(•••) •••-${e164.slice(-4)}` : '');

class SmsError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function sendNow(to, body) {
  if (sender) return sender(to, body);
  if (!enabled()) {
    if (IS_PROD) throw new SmsError('Texting is not set up (TWILIO_* variables are missing).', 'NOT_CONFIGURED');
    console.log(`[dev only] Text to ${to}: ${body}`);
    return { sid: 'dev' };
  }
  const form = new URLSearchParams({ To: to, Body: body });
  if (SERVICE) form.set('MessagingServiceSid', SERVICE); else form.set('From', FROM);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(SID)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new SmsError(data.message || `Twilio said ${r.status}`, data.code);
  return data;
}

function create({ pool }) {
  // Messages to people who replied STOP (Twilio error 21610) are dropped and their texts switched off.
  const OPTED_OUT = 21610;

  // Puts texts in the outbox. rows: [{ userId, phone, body, kind }]
  async function queue(rows) {
    if (!rows.length) return;
    await pool.query(
      `INSERT INTO sms_outbox (user_id, phone, body, kind)
       SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[])`,
      [rows.map((r) => r.userId), rows.map((r) => r.phone), rows.map((r) => r.body.slice(0, 600)), rows.map((r) => r.kind || '')]
    );
  }

  // Sends waiting texts until the outbox is empty, `max` are sent, or `ms` runs out. Safe to run from several
  // servers at once: each claims its own rows. Texts more than a day old are dropped as stale.
  async function drain({ max = 50, ms = 8000 } = {}) {
    const until = Date.now() + ms;
    let sent = 0;
    while (sent < max && Date.now() < until) {
      const { rows } = await pool.query(
        `UPDATE sms_outbox SET attempts = attempts + 1, claimed_at = now()
         WHERE id IN (
           SELECT id FROM sms_outbox
           WHERE sent_at IS NULL AND failed_at IS NULL AND attempts < 3 AND created_at > now() - interval '1 day'
             AND (claimed_at IS NULL OR claimed_at < now() - interval '2 minutes')
           ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
         RETURNING id, user_id, phone, body, attempts`,
        [Math.min(10, max - sent)]
      );
      if (!rows.length) break;
      await Promise.all(rows.map(async (m) => {
        try {
          await sendNow(m.phone, m.body);
          await pool.query('UPDATE sms_outbox SET sent_at = now(), last_error = NULL WHERE id = $1', [m.id]);
          sent++;
        } catch (err) {
          const final = err.code === OPTED_OUT || err.code === 'NOT_CONFIGURED' || m.attempts >= 3;
          await pool.query(
            `UPDATE sms_outbox SET last_error = $2, claimed_at = NULL, failed_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1`,
            [m.id, String(err.message).slice(0, 300), final]
          );
          if (err.code === OPTED_OUT && m.user_id) await pool.query('UPDATE users SET sms_opt_in = FALSE WHERE id = $1', [m.user_id]);
          if (!final) console.error('Text failed, will retry:', err.message);
        }
      }));
    }
    return sent;
  }

  // Who can be texted right now: confirmed phone, texts switched on, and texting set up on the site.
  async function textable(userIds) {
    if (!enabled() && !sender) return new Map();
    const ids = [...new Set(userIds.map(String))];
    if (!ids.length) return new Map();
    const { rows } = await pool.query(
      `SELECT id, phone FROM users WHERE id = ANY($1::bigint[]) AND phone IS NOT NULL AND phone_verified_at IS NOT NULL AND sms_opt_in AND banned_at IS NULL`,
      [ids]
    );
    return new Map(rows.map((r) => [String(r.id), r.phone]));
  }

  return { queue, drain, textable, sendNow };
}

module.exports = { create, enabled: () => enabled() || !!sender, normalize, pretty, masked, useSender, sendNow, SmsError };
