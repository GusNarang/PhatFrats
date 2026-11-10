// Creates (or resets) the demo account for graders and reviewers. It logs in through the normal Log in box,
// is already confirmed (no email code), and has Full Access with no end date. It is NOT an admin:
// its role is always 'user' and it has no control room password.
// The password comes from DEMO_PASSWORD so it never sits in the code. Only its hash is stored.
// Usage (PowerShell):
//   $env:DEMO_PASSWORD = '...'; npm run demo:account -- demo@demo.com; Remove-Item Env:DEMO_PASSWORD
const crypto = require('crypto');
const { promisify } = require('util');
const { Client } = require('pg');

const scrypt = promisify(crypto.scrypt);
// Must match the settings in server.js.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const password = process.env.DEMO_PASSWORD || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || password.length < 8) {
    console.error('Give the demo email as an argument and its password (8+ characters) in DEMO_PASSWORD.');
    process.exit(1);
  }
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  const hash = `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: [u] } = await client.query(
      `INSERT INTO users (email, name, password_hash, email_verified_at, plan, plan_paid_at, plan_paid_until, role)
       VALUES ($1, 'Demo Student', $2, now(), 'full', now(), NULL, 'user')
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         email_verified_at = coalesce(users.email_verified_at, now()),
         plan = 'full', plan_paid_at = coalesce(users.plan_paid_at, now()), plan_paid_until = NULL,
         role = 'user', admin_password_hash = NULL, banned_at = NULL, ban_reason = NULL
       RETURNING id, (xmax = 0) AS created`,
      [email, hash]
    );
    // A new password signs out anywhere the demo account was already logged in.
    if (!u.created) await client.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
    console.log(`Demo account ${u.created ? 'created' : 'reset'}: ${email} (confirmed, Full Access with no end date, not an admin).`);
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error('Could not set up the demo account:', err.message);
  process.exit(1);
});
