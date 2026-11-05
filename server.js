const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');
const PARTIES = require('./public/parties.js');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Copy .env.example to .env and add your Neon connection string.');
  if (require.main === module) process.exit(1);
}

const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'pf_session';
const SESSION_DAYS = 30;
const FREE_INVITE_LIMIT = 1;
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
    `SELECT u.id, u.name, u.email, u.plan FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)]
  );
  return rows[0] || null;
}
const publicUser = (u) => ({ name: u.name, email: u.email, plan: u.plan, freeLimit: FREE_INVITE_LIMIT });

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
    `SELECT party_id, guests, note, status, priority, created_at FROM invite_requests
     WHERE user_id = $1 ORDER BY created_at DESC`,
    [user.id]
  );
  return rows.map((r) => ({
    pid: r.party_id,
    guests: r.guests,
    note: r.note,
    status: r.status,
    priority: r.priority,
    ts: new Date(r.created_at).getTime(),
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
     ON CONFLICT (email) DO NOTHING RETURNING id, name, email, plan`,
    [email, name, passwordHash]
  );
  if (!rows[0]) return fail(res, 409, 'That email already has an account. Log in instead.', 'EMAIL_TAKEN');
  await startSession(res, rows[0].id);
  res.status(201).json({ user: publicUser(rows[0]), requests: [] });
}));

app.post('/api/login', authLimiter, wrap(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
  const { rows } = await pool.query(
    'SELECT id, name, email, plan, password_hash FROM users WHERE email = $1',
    [email]
  );
  const ok = await verifyPassword(password, rows[0] ? rows[0].password_hash : await dummyHash);
  if (!rows[0] || !ok) return fail(res, 401, 'That email and password do not match.', 'BAD_LOGIN');
  await startSession(res, rows[0].id);
  res.json({ user: publicUser(rows[0]), requests: await listRequests(rows[0]) });
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
  res.json({ user: publicUser(user), requests: await listRequests(user) });
}));

app.get('/api/requests', requireUser, wrap(async (req, res) => {
  res.json({ requests: await listRequests(req.user) });
}));

app.post('/api/requests', requireUser, wrap(async (req, res) => {
  const partyId = req.body?.partyId;
  if (typeof partyId !== 'string' || !partyById.has(partyId)) return fail(res, 400, 'That party is not on the schedule.');
  const guests = Number.isInteger(req.body?.guests) ? req.body.guests : 0;
  if (guests < 0 || guests > 3) return fail(res, 400, 'You can bring up to 3 plus-ones.');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Locks this user's row so two requests sent at once can't both use the free invite.
    const { rows: [user] } = await client.query('SELECT plan FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const { rows: existing } = await client.query('SELECT party_id FROM invite_requests WHERE user_id = $1', [req.user.id]);
    if (existing.some((r) => r.party_id === partyId)) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'You already requested an invite to this party.', 'ALREADY_REQUESTED');
    }
    if (user.plan !== 'full' && existing.length >= FREE_INVITE_LIMIT) {
      await client.query('ROLLBACK');
      return fail(res, 403, 'Free accounts can request an invite to one party. Full Access removes the limit.', 'FREE_LIMIT');
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
