// Rate limit counts kept in the database, so every server copy on Vercel shares one count.
// (The default counts live in each copy's memory, so a busy night with many copies let people
// try many more times than the limit says.)
//
// If the database can't be reached, the limiter lets the request through rather than blocking
// everyone (passOnStoreError in each limiter), and the route itself then fails or succeeds as usual.

class PgStore {
  constructor(pool, name) {
    this.pool = pool;
    this.prefix = `${name}|`;
    this.localKeys = false;
    this.windowMs = 60 * 1000;
  }
  init(options) {
    this.windowMs = options.windowMs;
  }
  async increment(key) {
    const { rows: [r] } = await this.pool.query(
      `INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 1, now() + $2 * interval '1 millisecond')
       ON CONFLICT (key) DO UPDATE SET
         hits     = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`,
      [this.prefix + key, this.windowMs]
    );
    // Now and then, clear out counts whose window has passed.
    if (Math.random() < 0.002) this.pool.query('DELETE FROM rate_limits WHERE reset_at < now()').catch(() => {});
    return { totalHits: r.hits, resetTime: new Date(r.reset_at) };
  }
  async decrement(key) {
    await this.pool.query('UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1', [this.prefix + key]);
  }
  async resetKey(key) {
    await this.pool.query('DELETE FROM rate_limits WHERE key = $1', [this.prefix + key]);
  }
}

// A short, stable name for a limiter made by a helper like limiter(limit, message).
const nameFor = (area, limit, message) => `${area}:${limit}:${String(message).slice(0, 40)}`;

module.exports = { PgStore, nameFor };
