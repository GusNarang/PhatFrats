// Door Rush, the Full Access arcade game. The game's code and every score route check the plan on the server.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');

const CLIENT = fs.readFileSync(path.join(__dirname, 'game', 'door-rush.js'), 'utf8');
// The most the game can ever award for one guest, and the fastest guests can arrive per second.
const MAX_POINTS_PER_GUEST = 3000;
const MAX_GUESTS_PER_SECOND = 3.5;
const MAX_RUN_MINUTES = 30;

module.exports = function gameRoutes(app, { pool, wrap, fail, requireVerified, WEEK_START_SQL }) {
  const requireFull = [...requireVerified, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.user.plan !== 'full') return fail(res, 403, 'Door Rush is part of Full Access.', 'GAME_FULL_ONLY');
    next();
  }];
  const runLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
    message: { error: 'Too many games at once. Wait a minute.', code: 'RATE_LIMITED' },
  });

  // First name and last initial only, so the board doesn't publish anyone's full name or email.
  const shortName = (name) => {
    const parts = String(name).trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
  };
  // Each person's best game this week. The week resets Monday at midnight in State College.
  async function standings(userId) {
    const [board, mine] = await Promise.all([
      pool.query(
        `WITH best AS (
           SELECT user_id, max(score) AS score FROM game_runs
           WHERE finished_at >= ${WEEK_START_SQL} GROUP BY user_id
         )
         SELECT b.user_id, b.score, u.name FROM best b JOIN users u ON u.id = b.user_id
         WHERE u.banned_at IS NULL AND u.plan = 'full' ORDER BY b.score DESC, u.name LIMIT 10`
      ),
      pool.query(
        `SELECT coalesce(max(score), 0)::int AS best,
           coalesce(max(score) FILTER (WHERE finished_at >= ${WEEK_START_SQL}), 0)::int AS week
         FROM game_runs WHERE user_id = $1 AND finished_at IS NOT NULL`,
        [userId]
      ),
    ]);
    const { best, week } = mine.rows[0];
    let rank = null;
    if (week > 0) {
      const { rows: [r] } = await pool.query(
        `WITH best AS (
           SELECT user_id, max(score) AS score FROM game_runs WHERE finished_at >= ${WEEK_START_SQL} GROUP BY user_id
         )
         SELECT count(*)::int + 1 AS rank FROM best b JOIN users u ON u.id = b.user_id
         WHERE u.banned_at IS NULL AND u.plan = 'full' AND b.score > $1`,
        [week]
      );
      rank = r.rank;
    }
    return {
      best, week, rank,
      board: board.rows.map((r, i) => ({ place: i + 1, name: shortName(r.name), score: Number(r.score), you: String(r.user_id) === String(userId) })),
    };
  }

  // What the game page should show. Free accounts only learn that it's locked.
  app.get('/api/game/status', ...requireVerified, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.user.plan !== 'full') return res.json({ access: false });
    res.json({ access: true, name: req.user.name.split(' ')[0], ...(await standings(req.user.id)) });
  }));

  app.get('/api/game/client.js', ...requireFull, (req, res) => {
    res.type('application/javascript').send(CLIENT);
  });

  // Each game gets a one-time ticket, so a score has to come from a game that really ran that long.
  app.post('/api/game/start', ...requireFull, runLimiter, wrap(async (req, res) => {
    pool.query(`DELETE FROM game_runs WHERE finished_at IS NULL AND started_at < now() - interval '1 day'`).catch(() => {});
    const ticket = crypto.randomBytes(24).toString('base64url');
    await pool.query('INSERT INTO game_runs (ticket, user_id) VALUES ($1, $2)', [ticket, req.user.id]);
    res.status(201).json({ ticket });
  }));

  app.post('/api/game/finish', ...requireFull, wrap(async (req, res) => {
    const { ticket, score, guests } = req.body || {};
    if (typeof ticket !== 'string' || !Number.isInteger(score) || !Number.isInteger(guests) || score < 0 || guests < 0) {
      return fail(res, 400, "That score couldn't be read.");
    }
    const before = (await standings(req.user.id)).best;
    // Claims the ticket in one statement, so it can only ever be used once.
    const { rows: [run] } = await pool.query(
      `UPDATE game_runs SET finished_at = now(), score = 0
       WHERE ticket = $1 AND user_id = $2 AND finished_at IS NULL
         AND started_at > now() - make_interval(mins => $3)
       RETURNING extract(epoch FROM finished_at - started_at)::float AS seconds`,
      [ticket, req.user.id, MAX_RUN_MINUTES]
    );
    if (!run) return fail(res, 400, 'That game has already ended.', 'BAD_TICKET');
    if (guests > run.seconds * MAX_GUESTS_PER_SECOND || score > guests * MAX_POINTS_PER_GUEST) {
      return fail(res, 400, "That score doesn't match the game, so it wasn't saved.", 'BAD_SCORE');
    }
    await pool.query('UPDATE game_runs SET score = $2, guests = $3 WHERE ticket = $1', [ticket, score, guests]);
    const now = await standings(req.user.id);
    res.json({ ...now, newBest: score > before && score > 0 });
  }));
};
