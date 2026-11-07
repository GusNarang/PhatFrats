// Sets the control room password for an existing admin account. Only a hash is stored.
// Usage (PowerShell):  $env:ADMIN_PASSWORD = 'new password'; npm run admin:password -- you@psu.edu; Remove-Item Env:ADMIN_PASSWORD
const crypto = require('crypto');
const { promisify } = require('util');
const { Client } = require('pg');

const scrypt = promisify(crypto.scrypt);
// Must match the settings in server.js.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 8) {
    console.error('Give the admin email as an argument and the new password (8+ characters) in ADMIN_PASSWORD.');
    process.exit(1);
  }
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  const hash = `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      `UPDATE users SET admin_password_hash = $2 WHERE email = $1 AND role = 'admin'`,
      [email, hash]
    );
    if (!rowCount) throw new Error(`${email} isn't an admin account.`);
    // A new password locks every control room that was already open.
    await client.query(
      'UPDATE sessions SET admin_until = NULL WHERE user_id = (SELECT id FROM users WHERE email = $1)',
      [email]
    );
    console.log(`Control room password set for ${email}.`);
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error('Could not set the password:', err.message);
  process.exit(1);
});
