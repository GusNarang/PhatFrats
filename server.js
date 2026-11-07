const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const PARTIES = require('./public/parties.js');

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
const partyById = new Map(PARTIES.map((p) => [p.id, p]));

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
async function currentUser(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.plan, u.email_verified_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
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
});
async function accountPayload(user) {
  return { user: publicUser(user), requests: user.email_verified_at ? await listRequests(user) : [] };
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

async function sendCodeEmail(to, code) {
  if (!mailer) {
    if (IS_PROD) throw new Error('SMTP_HOST is not set, so confirmation emails cannot be sent.');
    console.log(`[dev only] Confirmation code for ${to}: ${code}`);
    return;
  }
  await mailer.sendMail({
    from: `"PhatFrats" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to,
    subject: 'Your PhatFrats confirmation code',
    text: `Your PhatFrats confirmation code is ${code}.\n\nIt expires in ${CODE_MINUTES} minutes. If you didn't sign up for PhatFrats, you can ignore this email.`,
  });
}
const hashCode = (userId, code) => crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');

// Returns 'sent', 'throttled' (a code went out too recently) or 'failed' (the email didn't send).
async function issueCode(user) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  // The limits live in this one statement, so they hold across every server instance.
  const { rows } = await pool.query(
    `INSERT INTO email_codes (user_id, code_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))
     ON CONFLICT (user_id) DO UPDATE SET
       code_hash = EXCLUDED.code_hash,
       expires_at = EXCLUDED.expires_at,
       attempts = 0,
       last_sent_at = now(),
       sent_in_window = CASE WHEN email_codes.window_started_at < now() - interval '1 hour' THEN 1 ELSE email_codes.sent_in_window + 1 END,
       window_started_at = CASE WHEN email_codes.window_started_at < now() - interval '1 hour' THEN now() ELSE email_codes.window_started_at END
     WHERE email_codes.last_sent_at < now() - interval '1 minute'
       AND (email_codes.window_started_at < now() - interval '1 hour' OR email_codes.sent_in_window < $4)
     RETURNING user_id`,
    [user.id, hashCode(user.id, code), CODE_MINUTES, CODES_PER_HOUR]
  );
  if (!rows[0]) return 'throttled';
  try {
    await sendCodeEmail(user.email, code);
    return 'sent';
  } catch (err) {
    console.error('Confirmation email failed:', err.message);
    // Lets them retry right away. The hourly cap still counts this attempt.
    await pool.query(`UPDATE email_codes SET last_sent_at = now() - interval '2 minutes' WHERE user_id = $1`, [user.id]);
    return 'failed';
  }
}

// ---------- invite requests ----------
// Demo stand-in for a host's reply until hosts have real accounts. Full Access is approved at
// parties where a free account would be waitlisted, which is the "higher preference" it pays for.
function demoDecision(partyId, plan) {
  const party = partyById.get(partyId);
  if (plan === 'full') return 'approved';
  return party && party.going / party.cap >= 0.9 ? 'waitlist' : 'approved';
}
async function listRequests(user) {
  const pending = await pool.query(
    `SELECT id, party_id FROM invite_requests
     WHERE user_id = $1 AND status = 'pending' AND created_at < now() - interval '4 seconds'`,
    [user.id]
  );
  for (const r of pending.rows) {
    await pool.query(`UPDATE invite_requests SET status = $1 WHERE id = $2 AND status = 'pending'`, [
      demoDecision(r.party_id, user.plan),
      r.id,
    ]);
  }
  const { rows } = await pool.query(
    `SELECT party_id, guests, note, status, priority, created_at, created_at >= ${WEEK_START_SQL} AS this_week
     FROM invite_requests WHERE user_id = $1 ORDER BY created_at DESC`,
    [user.id]
  );
  return rows.map((r) => ({
    pid: r.party_id,
    guests: r.guests,
    note: r.note,
    status: r.status,
    priority: r.priority,
    ts: new Date(r.created_at).getTime(),
    thisWeek: r.this_week,
  }));
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
if (IS_PROD) app.set('trust proxy', 1);
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
     ON CONFLICT (email) DO NOTHING RETURNING id, name, email, plan, email_verified_at`,
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
    'SELECT id, name, email, plan, password_hash, email_verified_at FROM users WHERE email = $1',
    [email]
  );
  const ok = await verifyPassword(password, rows[0] ? rows[0].password_hash : await dummyHash);
  if (!rows[0] || !ok) return fail(res, 401, 'That email and password do not match.', 'BAD_LOGIN');
  await startSession(res, rows[0].id);
  const codeStatus = rows[0].email_verified_at ? undefined : await issueCode(rows[0]);
  res.json({ ...(await accountPayload(rows[0])), codeStatus });
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
    `UPDATE users SET email_verified_at = now() WHERE id = $1 RETURNING id, name, email, plan, email_verified_at`,
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
  if (!user) return res.json({ user: null, requests: [] });
  res.json(await accountPayload(user));
}));

app.get('/api/requests', requireVerified, wrap(async (req, res) => {
  res.json({ requests: await listRequests(req.user) });
}));

app.post('/api/requests', requireVerified, wrap(async (req, res) => {
  const partyId = req.body?.partyId;
  if (typeof partyId !== 'string' || !partyById.has(partyId)) return fail(res, 400, 'That party is not on the schedule.');
  const guests = Number.isInteger(req.body?.guests) ? req.body.guests : 0;
  if (guests < 0 || guests > 3) return fail(res, 400, 'You can bring up to 3 plus-ones.');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Locks this user's row so two requests sent at once can't both use the weekly free invite.
    const { rows: [user] } = await client.query('SELECT plan FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const { rows: existing } = await client.query(
      `SELECT party_id, created_at >= ${WEEK_START_SQL} AS this_week FROM invite_requests WHERE user_id = $1`,
      [req.user.id]
    );
    if (existing.some((r) => r.party_id === partyId)) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'You already requested an invite to this party.', 'ALREADY_REQUESTED');
    }
    if (user.plan !== 'full' && existing.filter((r) => r.this_week).length >= FREE_INVITES_PER_WEEK) {
      await client.query('ROLLBACK');
      return fail(res, 403, 'Free accounts get one party invite per week. Yours resets Monday at midnight, or Full Access removes the limit.', 'FREE_LIMIT');
    }
    await client.query(
      'INSERT INTO invite_requests (user_id, party_id, guests, note, priority) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, partyId, guests, note, user.plan === 'full']
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

app.use('/api', (req, res) => fail(res, 404, 'Not found.'));
app.use(express.static(path.join(__dirname, 'public')));

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
