const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const partyList = require('./party-list.js');
const payments = require('./payments.js');
const guests = require('./guests.js');
const phatbot = require('./ai.js');
const PRICING = require('./public/pricing.js');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Copy .env.example to .env and add your Neon connection string.');
  if (require.main === module) process.exit(1);
}

const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'pf_session';
const SESSION_DAYS = 30;
const FREE_INVITES_PER_WEEK = 1;
// Weeks start Monday at midnight in State College.
const WEEK_START_SQL = `(date_trunc('week', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')`;
const CODE_MINUTES = 15;
const CODE_MAX_ATTEMPTS = 5;
const CODES_PER_HOUR = 5;
// PhatBot is a Full Access perk. Each message costs money, so a daily limit keeps the bill predictable.
const CHAT_DAILY_LIMIT = 60;
const TODAY_SQL = `(now() AT TIME ZONE 'America/New_York')::date`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
// Neon suspends idle databases, which drops idle connections. That shouldn't crash the server.
pool.on('error', (err) => console.error('Idle database connection closed:', err.message));

// ---------- passwords ----------
const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(password, stored) {
  const [, salt, key] = stored.split('$');
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}
// Checked when an email isn't found, so response time doesn't reveal which emails have accounts.
const dummyHash = hashPassword(crypto.randomBytes(16).toString('hex'));

// ---------- sessions ----------
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), userId, SESSION_DAYS]
  );
  pool.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => {});
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}
function readSessionToken(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === SESSION_COOKIE && value) return value;
  }
  return null;
}
// Paid passes end after their semester. Most checks read the plan straight from the users table,
// so expired passes are switched back to Free here, at most every few minutes.
let lastExpirySweep = 0;
function expirePasses() {
  if (Date.now() - lastExpirySweep < 5 * 60 * 1000) return;
  lastExpirySweep = Date.now();
  pool.query(`UPDATE users SET plan = 'free' WHERE plan = 'full' AND plan_paid_until < now()`)
    .catch((err) => console.error('Could not end expired passes:', err.message));
}
async function currentUser(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  expirePasses();
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.email_verified_at, u.plan_paid_until, (s.admin_until > now()) AS admin_unlocked,
       CASE WHEN u.plan = 'full' AND u.plan_paid_until < now() THEN 'free' ELSE u.plan END AS plan
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.banned_at IS NULL`,
    [hashToken(token)]
  );
  return rows[0] || null;
}
const publicUser = (u) => ({
  name: u.name,
  email: u.email,
  plan: u.plan,
  verified: !!u.email_verified_at,
  freeLimit: FREE_INVITES_PER_WEEK,
  chat: phatbot.isEnabled() && u.plan === 'full',
  admin: u.role === 'admin',
  // When a paid pass ends, as 'YYYY-MM-DD' in Eastern time. Null for Free, or Full Access with no end date.
  paidUntil: u.plan === 'full' && u.plan_paid_until
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(new Date(u.plan_paid_until).getTime() - 1000))
    : null,
});
// Party details only ever leave the server for a logged-in account with a confirmed email.
async function accountPayload(user) {
  if (!user.email_verified_at) return { user: publicUser(user), requests: [], parties: [], days: [], checkout: payments.enabled() };
  const requests = await listRequests(user);
  return { user: publicUser(user), requests, checkout: payments.enabled(), ...(await partyList.partiesForSite(pool)) };
}

// ---------- email confirmation codes ----------
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: (Number(process.env.SMTP_PORT) || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    })
  : null;

const CODE_KINDS = {
  verify: {
    table: 'email_codes',
    label: 'Confirmation',
    subject: 'Your PhatFrats confirmation code',
    text: (code) => `Your PhatFrats confirmation code is ${code}.\n\nIt expires in ${CODE_MINUTES} minutes. If you didn't sign up for PhatFrats, you can ignore this email.`,
  },
  reset: {
    table: 'password_reset_codes',
    label: 'Password reset',
    subject: 'Your PhatFrats password reset code',
    text: (code) => `Your PhatFrats password reset code is ${code}.\n\nIt expires in ${CODE_MINUTES} minutes. If you didn't ask to reset your password, you can ignore this email and your password stays the same.`,
  },
};

async function sendCodeEmail(to, code, kind) {
  if (!mailer) {
    if (IS_PROD) throw new Error('SMTP_HOST is not set, so code emails cannot be sent.');
    console.log(`[dev only] ${kind.label} code for ${to}: ${code}`);
    return;
  }
  await mailer.sendMail({
    from: `"PhatFrats" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to,
    subject: kind.subject,
    text: kind.text(code),
  });
}
const hashCode = (userId, code) => crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');

// Returns 'sent', 'throttled' (a code went out too recently) or 'failed' (the email didn't send).
async function issueCode(user, kind = CODE_KINDS.verify) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const t = kind.table;
  // The limits live in this one statement, so they hold across every server instance.
  const { rows } = await pool.query(
    `INSERT INTO ${t} (user_id, code_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))
     ON CONFLICT (user_id) DO UPDATE SET
       code_hash = EXCLUDED.code_hash,
       expires_at = EXCLUDED.expires_at,
       attempts = 0,
       last_sent_at = now(),
       sent_in_window = CASE WHEN ${t}.window_started_at < now() - interval '1 hour' THEN 1 ELSE ${t}.sent_in_window + 1 END,
       window_started_at = CASE WHEN ${t}.window_started_at < now() - interval '1 hour' THEN now() ELSE ${t}.window_started_at END
     WHERE ${t}.last_sent_at < now() - interval '1 minute'
       AND (${t}.window_started_at < now() - interval '1 hour' OR ${t}.sent_in_window < $4)
     RETURNING user_id`,
    [user.id, hashCode(user.id, code), CODE_MINUTES, CODES_PER_HOUR]
  );
  if (!rows[0]) return 'throttled';
  try {
    await sendCodeEmail(user.email, code, kind);
    return 'sent';
  } catch (err) {
    console.error(`${kind.label} email failed:`, err.message);
    // Lets them retry right away. The hourly cap still counts this attempt.
    await pool.query(`UPDATE ${t} SET last_sent_at = now() - interval '2 minutes' WHERE user_id = $1`, [user.id]);
    return 'failed';
  }
}

// ---------- invite requests ----------
// The demo parties have no real hosts, so their requests get an automatic reply. Full Access is approved
// at parties where a free account would be waitlisted, which is the "higher preference" it pays for.
// Requests to parties a chapter posted wait for that chapter's leader instead.
function demoDecision(partyId, plan) {
  const party = partyList.DEMO_BY_ID.get(partyId);
  if (plan === 'full') return 'approved';
  return party && party.going / party.cap >= 0.9 ? 'waitlist' : 'approved';
}
async function listRequests(user) {
  // A brother's invite to this email becomes an approved spot the first time its owner shows up.
  await pool.query(
    `INSERT INTO invite_requests (user_id, party_id, note, status, priority, invited_by)
     SELECT $1, 'h' || b.party_id, '', 'approved', $3, b.invited_by
     FROM brother_invites b WHERE b.email = $2
     ON CONFLICT (user_id, party_id) DO UPDATE SET status = 'approved', invited_by = EXCLUDED.invited_by
       WHERE invite_requests.status <> 'approved'`,
    [user.id, user.email, user.plan === 'full']
  );
  const pending = await pool.query(
    `SELECT id, party_id FROM invite_requests
     WHERE user_id = $1 AND status = 'pending' AND party_id NOT LIKE 'h%' AND created_at < now() - interval '4 seconds'`,
    [user.id]
  );
  for (const r of pending.rows) {
    await pool.query(`UPDATE invite_requests SET status = $1 WHERE id = $2 AND status = 'pending'`, [
      demoDecision(r.party_id, user.plan),
      r.id,
    ]);
  }
  const { rows } = await pool.query(
    `SELECT r.party_id, r.note, r.status, r.priority, r.created_at, r.invited_by IS NOT NULL AS invited,
       inviter.name AS invited_by_name, r.created_at >= ${WEEK_START_SQL} AND r.invited_by IS NULL AS this_week
     FROM invite_requests r LEFT JOIN users inviter ON inviter.id = r.invited_by
     WHERE r.user_id = $1 ORDER BY r.created_at DESC`,
    [user.id]
  );
  // The outside guest this person is bringing to each party, if any.
  const { rows: guestRows } = await pool.query(
    `SELECT 'h' || party_id AS party_id, name, status FROM outside_guests WHERE sponsor_id = $1`,
    [user.id]
  );
  const guestFor = new Map(guestRows.map((g) => [g.party_id, { name: g.name, status: g.status }]));
  return rows.map((r) => ({
    pid: r.party_id,
    note: r.note,
    status: r.status,
    priority: r.priority,
    ts: new Date(r.created_at).getTime(),
    // A brother's invite doesn't use the weekly free invite.
    thisWeek: r.this_week,
    invitedBy: r.invited ? r.invited_by_name || 'a brother' : null,
    guest: guestFor.get(r.party_id) || null,
  }));
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
if (IS_PROD) app.set('trust proxy', 1);
// Stripe's webhook has to read the raw body to check its signature, so it's registered before the JSON parser.
let stripeWebhook = (req, res) => res.status(503).json({ error: 'Payments are off.' });
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (req, res, next) => stripeWebhook(req, res, next));
app.use(express.json({ limit: '10kb' }));

const fail = (res, status, error, code) => res.status(status).json({ error, code });
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const requireUser = wrap(async (req, res, next) => {
  req.user = await currentUser(req);
  if (!req.user) return fail(res, 401, 'Log in to do that.', 'NOT_LOGGED_IN');
  next();
});
const requireVerified = [requireUser, (req, res, next) => {
  if (!req.user.email_verified_at) return fail(res, 403, 'Confirm your email to do that.', 'EMAIL_NOT_VERIFIED');
  next();
}];
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait 15 minutes and try again.', code: 'RATE_LIMITED' },
});

const BANNED_MESSAGE = 'This account has been suspended. If you think that is a mistake, email the PhatFrats team.';
const cleanEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const PSU_EMAIL = /^[a-z0-9._%+-]+@psu\.edu$/;

app.post('/api/signup', authLimiter, wrap(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = cleanEmail(req.body?.email);
  const password = req.body?.password;
  if (!name || name.length > 80) return fail(res, 400, 'Add your name so hosts know who is coming.');
  if (!PSU_EMAIL.test(email)) return fail(res, 400, 'Use your Penn State email, like abc1234@psu.edu.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return fail(res, 400, 'Use a password with at least 8 characters.');
  }
  const passwordHash = await hashPassword(password);
  // New accounts are always free. Only a confirmed payment may set plan = 'full'.
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING RETURNING id, name, email, plan, email_verified_at, role`,
    [email, name, passwordHash]
  );
  if (!rows[0]) return fail(res, 409, 'That email already has an account. Log in instead.', 'EMAIL_TAKEN');
  await startSession(res, rows[0].id);
  const codeStatus = await issueCode(rows[0]);
  res.status(201).json({ ...(await accountPayload(rows[0])), codeStatus });
}));

app.post('/api/login', authLimiter, wrap(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
  const { rows } = await pool.query(
    `SELECT id, name, email, role, password_hash, email_verified_at, banned_at, plan_paid_until,
       CASE WHEN plan = 'full' AND plan_paid_until < now() THEN 'free' ELSE plan END AS plan
     FROM users WHERE email = $1`,
    [email]
  );
  const ok = await verifyPassword(password, rows[0] ? rows[0].password_hash : await dummyHash);
  if (!rows[0] || !ok) return fail(res, 401, 'That email and password do not match.', 'BAD_LOGIN');
  if (rows[0].banned_at) return fail(res, 403, BANNED_MESSAGE, 'ACCOUNT_BANNED');
  await startSession(res, rows[0].id);
  const codeStatus = rows[0].email_verified_at ? undefined : await issueCode(rows[0]);
  res.json({ ...(await accountPayload(rows[0])), codeStatus });
}));

// The reply is the same whether or not the account exists.
app.post('/api/password/forgot', authLimiter, wrap(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  if (!PSU_EMAIL.test(email)) return fail(res, 400, 'Enter your Penn State email, like abc1234@psu.edu.');
  const { rows } = await pool.query('SELECT id, email FROM users WHERE email = $1 AND banned_at IS NULL', [email]);
  if (rows[0]) await issueCode(rows[0], CODE_KINDS.reset);
  res.json({ ok: true });
}));

app.post('/api/password/reset', authLimiter, wrap(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\D/g, '') : '';
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return fail(res, 400, 'Use a password with at least 8 characters.');
  }
  const badCode = () => fail(res, 400, 'That code is wrong or has expired. Check your email, or send yourself a new one.', 'CODE_INVALID');
  if (code.length !== 6) return badCode();
  const { rows: [found] } = await pool.query('SELECT id FROM users WHERE email = $1 AND banned_at IS NULL', [email]);
  if (!found) return badCode();
  // Counts the try before checking it, so parallel guesses can't get past the limit.
  const { rows: [stored] } = await pool.query(
    `UPDATE password_reset_codes SET attempts = attempts + 1
     WHERE user_id = $1 AND expires_at > now() AND attempts < $2 RETURNING code_hash`,
    [found.id, CODE_MAX_ATTEMPTS]
  );
  const expected = hashCode(found.id, code);
  if (!stored || !crypto.timingSafeEqual(Buffer.from(stored.code_hash), Buffer.from(expected))) return badCode();

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  let user;
  try {
    await client.query('BEGIN');
    // Deleting the code claims it, so it can only ever be used once.
    const used = await client.query('DELETE FROM password_reset_codes WHERE user_id = $1 AND code_hash = $2', [found.id, expected]);
    if (!used.rowCount) {
      await client.query('ROLLBACK');
      return badCode();
    }
    // Getting this code proves they own the mailbox, so their email counts as confirmed too.
    ({ rows: [user] } = await client.query(
      `UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now())
       WHERE id = $2 RETURNING id, name, email, plan, email_verified_at, role`,
      [passwordHash, found.id]
    ));
    // Logs out every device, including anyone who knew the old password.
    await client.query('DELETE FROM sessions WHERE user_id = $1', [found.id]);
    await client.query('DELETE FROM email_codes WHERE user_id = $1', [found.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await startSession(res, user.id);
  res.json(await accountPayload(user));
}));

app.post('/api/verify', authLimiter, requireUser, wrap(async (req, res) => {
  if (req.user.email_verified_at) return res.json(await accountPayload(req.user));
  const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\D/g, '') : '';
  if (code.length !== 6) return fail(res, 400, 'Enter the 6-digit code from your email.');
  // Counts the try before checking it, so parallel guesses can't get past the limit.
  const { rows } = await pool.query(
    `UPDATE email_codes SET attempts = attempts + 1
     WHERE user_id = $1 AND expires_at > now() AND attempts < $2 RETURNING code_hash`,
    [req.user.id, CODE_MAX_ATTEMPTS]
  );
  if (!rows[0]) return fail(res, 400, 'That code has expired or had too many tries. Send yourself a new one.', 'CODE_EXPIRED');
  const matches = crypto.timingSafeEqual(Buffer.from(rows[0].code_hash), Buffer.from(hashCode(req.user.id, code)));
  if (!matches) return fail(res, 400, "That code doesn't match. Check your email and try again.", 'CODE_WRONG');
  const { rows: [user] } = await pool.query(
    `UPDATE users SET email_verified_at = now() WHERE id = $1 RETURNING id, name, email, plan, email_verified_at, role`,
    [req.user.id]
  );
  await pool.query('DELETE FROM email_codes WHERE user_id = $1', [req.user.id]);
  res.json(await accountPayload(user));
}));

app.post('/api/verify/resend', authLimiter, requireUser, wrap(async (req, res) => {
  if (req.user.email_verified_at) return res.json({ codeStatus: 'verified' });
  const codeStatus = await issueCode(req.user);
  if (codeStatus === 'throttled') return fail(res, 429, 'A code just went out. Check your spam folder, or wait a minute before asking for another.', 'CODE_THROTTLED');
  if (codeStatus === 'failed') return fail(res, 502, "We couldn't send your code just now. Try again in a moment.", 'CODE_NOT_SENT');
  res.json({ codeStatus });
}));

app.post('/api/logout', wrap(async (req, res) => {
  const token = readSessionToken(req);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
}));

app.get('/api/me', wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.json({ user: null, requests: [], parties: [], checkout: payments.enabled() });
  // Opening the main site locks the control room again, so the admin password is needed every time.
  if (user.admin_unlocked) {
    await pool.query('UPDATE sessions SET admin_until = NULL WHERE token_hash = $1', [hashToken(readSessionToken(req))]);
  }
  res.json(await accountPayload(user));
}));

app.get('/api/requests', requireVerified, wrap(async (req, res) => {
  res.json({ requests: await listRequests(req.user) });
}));

app.post('/api/requests', requireVerified, wrap(async (req, res) => {
  const partyId = req.body?.partyId;
  if (typeof partyId !== 'string' || !(await partyList.findParty(pool, partyId))) return fail(res, 400, 'That party is not on the schedule.');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Locks this user's row so two requests sent at once can't both use the weekly free invite.
    const { rows: [user] } = await client.query('SELECT plan FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const { rows: existing } = await client.query(
      `SELECT party_id, created_at >= ${WEEK_START_SQL} AND invited_by IS NULL AS this_week FROM invite_requests WHERE user_id = $1`,
      [req.user.id]
    );
    if (existing.some((r) => r.party_id === partyId)) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'You already requested an invite to this party.', 'ALREADY_REQUESTED');
    }
    if (user.plan !== 'full' && existing.filter((r) => r.this_week).length >= FREE_INVITES_PER_WEEK) {
      await client.query('ROLLBACK');
      return fail(res, 403, `That's your free invite for this week. It resets Monday at midnight, or go unlimited with Full Access for ${PRICING.money(PRICING.current())} a ${PRICING.term}.`, 'FREE_LIMIT');
    }
    await client.query(
      // No plus-ones: everyone coming needs their own invite.
      'INSERT INTO invite_requests (user_id, party_id, note, priority) VALUES ($1, $2, $3, $4)',
      [req.user.id, partyId, note, user.plan === 'full']
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  res.status(201).json({ requests: await listRequests(req.user) });
}));

// A student adds one outside guest (not a Penn State student) to a party they've asked to go to.
// Only at parties whose chapter allows it. The chapter leader approves the guest separately.
app.post('/api/requests/guest', requireVerified, wrap(async (req, res) => {
  const partyId = req.body?.partyId;
  const party = typeof partyId === 'string' ? await partyList.findParty(pool, partyId) : null;
  if (!party || !party.hosted) return fail(res, 400, 'That party is not on the schedule.');
  if (!party.allowGuests) return fail(res, 403, "This party isn't taking outside guests.", 'GUESTS_OFF');
  const guest = guests.readGuest(req.body);
  if (typeof guest === 'string') return fail(res, 400, guest);
  const { rows: [mine] } = await pool.query('SELECT 1 FROM invite_requests WHERE user_id = $1 AND party_id = $2', [req.user.id, partyId]);
  if (!mine) return fail(res, 400, 'Request your own invite to this party first.', 'NO_REQUEST');
  const { rows: [made] } = await pool.query(
    `INSERT INTO outside_guests (party_id, sponsor_id, name, email, phone) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (party_id, sponsor_id) DO NOTHING RETURNING id`,
    [partyId.slice(1), req.user.id, guest.name, guest.email, guest.phone]
  );
  if (!made) return fail(res, 409, "You've already added an outside guest to this party. Each person can bring one.", 'GUEST_TAKEN');
  res.status(201).json({ requests: await listRequests(req.user) });
}));

app.post('/api/requests/guest/remove', requireVerified, wrap(async (req, res) => {
  const partyId = req.body?.partyId;
  if (!partyList.isHostedId(partyId)) return fail(res, 400, 'That party is not on the schedule.');
  await pool.query('DELETE FROM outside_guests WHERE party_id = $1 AND sponsor_id = $2', [partyId.slice(1), req.user.id]);
  res.json({ requests: await listRequests(req.user) });
}));

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: "You're sending messages too fast. Wait a moment.", code: 'RATE_LIMITED' },
  // Per account, not per network: students on campus Wi-Fi can share one address.
  keyGenerator: (req) => `user:${req.user.id}`,
});

app.post('/api/chat', requireVerified, chatLimiter, wrap(async (req, res) => {
  if (!phatbot.isEnabled()) return fail(res, 503, "PhatBot isn't switched on yet. Check back soon.", 'CHAT_OFF');
  if (req.user.plan !== 'full') return fail(res, 403, 'PhatBot is part of Full Access.', 'CHAT_FULL_ONLY');
  const messages = phatbot.cleanConversation(req.body?.messages);
  if (typeof messages === 'string') return fail(res, 400, messages);

  const limit = CHAT_DAILY_LIMIT;
  // Counts the message first, in one statement, so parallel requests can't go over the limit.
  const { rows: [counted] } = await pool.query(
    `INSERT INTO chat_usage (user_id, day, messages) VALUES ($1, ${TODAY_SQL}, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET messages = chat_usage.messages + 1
     WHERE chat_usage.messages < $2
     RETURNING messages`,
    [req.user.id, limit]
  );
  if (!counted) {
    return fail(res, 429, `That's all ${limit} PhatBot messages for today. More unlock at midnight.`, 'CHAT_LIMIT');
  }
  const refund = () => pool.query(
    `UPDATE chat_usage SET messages = messages - 1 WHERE user_id = $1 AND day = ${TODAY_SQL} AND messages > 0`,
    [req.user.id]
  ).catch(() => {});

  try {
    const { text, tokens } = await phatbot.reply(req.user, await listRequests(req.user), messages, await partyList.hostedParties(pool));
    if (tokens) {
      // Kept for the control room's AI bill. A failure here shouldn't cost the person their reply.
      await pool.query(
        `UPDATE chat_usage SET input_tokens = input_tokens + $2, output_tokens = output_tokens + $3,
           cache_read_tokens = cache_read_tokens + $4, cache_write_tokens = cache_write_tokens + $5
         WHERE user_id = $1 AND day = ${TODAY_SQL}`,
        [req.user.id, tokens.input_tokens || 0, tokens.output_tokens || 0,
          tokens.cache_read_input_tokens || 0, tokens.cache_creation_input_tokens || 0]
      ).catch((err) => console.error('Could not record PhatBot tokens:', err.message));
    }
    res.json({ reply: text, left: limit - counted.messages });
  } catch (err) {
    await refund();
    if (err instanceof phatbot.ChatError) return fail(res, err.status, err.message, 'CHAT_FAILED');
    throw err;
  }
}));

// Counts visits for the control room. The id is random and made up by the browser.
const hitLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
app.post('/api/hit', hitLimiter, wrap(async (req, res) => {
  const visitor = typeof req.body?.v === 'string' && /^[a-z0-9]{8,40}$/.test(req.body.v) ? req.body.v : null;
  if (visitor) {
    await pool.query(
      `INSERT INTO site_visits (day, visitor) VALUES (${TODAY_SQL}, $1)
       ON CONFLICT (day, visitor) DO UPDATE SET views = site_visits.views + 1`,
      [visitor]
    );
  }
  res.status(204).end();
}));

require('./admin.js')(app, { pool, wrap, fail, requireUser, PRICING, phatbot, TODAY_SQL, authLimiter, hashPassword, verifyPassword, hashToken, readSessionToken });
const pay = payments.create({ pool, wrap, fail, requireVerified, accountPayload });
stripeWebhook = pay.webhookHandler;
pay.mountRoutes(app);
require('./game-routes.js')(app, { pool, wrap, fail, requireVerified, WEEK_START_SQL });
require('./chapters.js')(app, { pool, wrap, fail, requireVerified, authLimiter, hashPassword, verifyPassword, mailer, IS_PROD, guests });

app.use('/api', (req, res) => fail(res, 404, 'Not found.'));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/frats', (req, res) => res.sendFile(path.join(__dirname, 'public', 'frats.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return fail(res, 400, 'That request could not be read.');
  console.error(err);
  fail(res, 500, 'Something went wrong on our end. Try again in a moment.');
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`PhatFrats running at http://localhost:${port}`));
}
module.exports = app;
