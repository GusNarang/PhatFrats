// Door Rush, the arcade game. Anyone can play; saving scores and competing for the weekly prize needs a
// confirmed PhatFrats account (Free or Full Access).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const PRICING = require('./public/pricing.js');
const { FULL_SQL } = require('./plan-sql.js');

const CLIENT = fs.readFileSync(path.join(__dirname, 'game', 'door-rush.js'), 'utf8');
// The most the game can ever award for one guest, and the fastest guests can arrive per second.
const MAX_POINTS_PER_GUEST = 3000;
const MAX_GUESTS_PER_SECOND = 3.5;
const MAX_RUN_MINUTES = 30;

module.exports = function gameRoutes(app, { pool, wrap, fail, requireVerified, WEEK_START_SQL, ops }) {
  // The board covers this week, or less if the admin reset it partway through.
  const SINCE = `GREATEST(${WEEK_START_SQL}, coalesce($9::timestamptz, '-infinity'))`;
  async function gameSettings() {
    const s = ops ? await ops.settings() : {};
    const eventOn = !!(s.game_event_until && new Date(s.game_event_until) > new Date());
    return { resetAt: s.game_reset_at || null, eventOn, eventUntil: eventOn ? s.game_event_until : null };
  }
  const requirePlayer = [...requireVerified, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }];
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
    const { resetAt } = await gameSettings();
    const boardSince = SINCE.replace('$9', '$1');
    const [board, mine] = await Promise.all([
      pool.query(
        `WITH best AS (
           SELECT user_id, max(score) AS score FROM game_runs
           WHERE finished_at >= ${boardSince} GROUP BY user_id
         )
         SELECT b.user_id, b.score, u.name, ${FULL_SQL('u.')} AS full FROM best b JOIN users u ON u.id = b.user_id
         WHERE u.banned_at IS NULL ORDER BY b.score DESC, u.name LIMIT 10`,
        [resetAt]
      ),
      pool.query(
        `SELECT coalesce(max(score), 0)::int AS best,
           coalesce(max(score) FILTER (WHERE finished_at >= ${SINCE.replace('$9', '$2')}), 0)::int AS week
         FROM game_runs WHERE user_id = $1 AND finished_at IS NOT NULL`,
        [userId, resetAt]
      ),
    ]);
    const { best, week } = mine.rows[0];
    let rank = null;
    if (week > 0) {
      const { rows: [r] } = await pool.query(
        `WITH best AS (
           SELECT user_id, max(score) AS score FROM game_runs WHERE finished_at >= ${SINCE.replace('$9', '$2')} GROUP BY user_id
         )
         SELECT count(*)::int + 1 AS rank FROM best b JOIN users u ON u.id = b.user_id
         WHERE u.banned_at IS NULL AND b.score > $1`,
        [week, resetAt]
      );
      rank = r.rank;
    }
    // The score to beat to move up one place, and how this week's race stands.
    let nextUp = null;
    if (rank && rank > 1) {
      const { rows: [n] } = await pool.query(
        `WITH best AS (SELECT user_id, max(score) AS score FROM game_runs WHERE finished_at >= ${SINCE.replace('$9', '$2')} GROUP BY user_id)
         SELECT min(b.score)::int AS score FROM best b JOIN users u ON u.id = b.user_id
         WHERE u.banned_at IS NULL AND b.score > $1`,
        [week, resetAt]
      );
      nextUp = n.score;
    }
    const [stats, recent, champ, clock] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS games, coalesce(sum(guests), 0)::int AS guests,
           count(*) FILTER (WHERE finished_at >= ${SINCE.replace('$9', '$2')})::int AS week_games
         FROM game_runs WHERE user_id = $1 AND finished_at IS NOT NULL AND score IS NOT NULL`,
        [userId, resetAt]
      ),
      pool.query(`SELECT score, finished_at FROM game_runs WHERE user_id = $1 AND finished_at IS NOT NULL AND score IS NOT NULL ORDER BY finished_at DESC LIMIT 5`, [userId]),
      pool.query(`SELECT p.score, to_char(p.week_start, 'YYYY-MM-DD') AS week, u.name FROM game_prizes p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.week_start DESC LIMIT 1`),
      pool.query(`SELECT ${WEEK_START_SQL} + interval '7 days' AS ends`),
    ]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    // 💎 marks Full Access members on the board. It's a badge only; the game plays the same for everyone.
    const rows = board.rows.map((r, i) => ({ place: i + 1, name: shortName(r.name), full: !!r.full, score: Number(r.score), you: String(r.user_id) === String(userId) }));
    return {
      best, week, rank, nextUp,
      board: rows,
      // Your own row when you're outside the top 10.
      me: rank && rank > 10 ? { place: rank, score: week } : null,
      stats: stats.rows[0],
      recent: recent.rows.map((r) => ({ score: r.score, when: r.finished_at })),
      prize: {
        through: PRICING.passEndLabel(PRICING.passEnds(PRICING.passEnds(today))),
        weekEnds: clock.rows[0].ends,
        lastChampion: champ.rows[0] ? { name: shortName(champ.rows[0].name || 'Someone'), score: champ.rows[0].score, week: champ.rows[0].week } : null,
      },
    };
  }

  // The prize and who's leading, for visitors without an account (they can play practice games).
  app.get('/api/game/prize', wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { resetAt, eventOn } = await gameSettings();
    const [{ rows: [lead] }, { rows: [champ] }, { rows: [clock] }] = await Promise.all([
      pool.query(`SELECT u.name, max(r.score)::int AS score FROM game_runs r JOIN users u ON u.id = r.user_id
                  WHERE r.finished_at >= ${SINCE.replace('$9', '$1')} AND u.banned_at IS NULL GROUP BY u.id, u.name ORDER BY score DESC LIMIT 1`, [resetAt]),
      pool.query(`SELECT p.score, u.name FROM game_prizes p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.week_start DESC LIMIT 1`),
      pool.query(`SELECT ${WEEK_START_SQL} + interval '7 days' AS ends`),
    ]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    res.json({
      event: eventOn,
      leader: lead ? { name: shortName(lead.name), score: lead.score } : null,
      prize: {
        through: PRICING.passEndLabel(PRICING.passEnds(PRICING.passEnds(today))),
        weekEnds: clock.ends,
        lastChampion: champ ? { name: shortName(champ.name || 'Someone'), score: champ.score } : null,
      },
    });
  }));

  // What the game page shows a logged-in player.
  app.get('/api/game/status', ...requirePlayer, wrap(async (req, res) => {
    const { eventOn, eventUntil } = await gameSettings();
    res.json({ access: true, name: req.user.name.split(' ')[0], full: req.user.plan === 'full', event: eventOn, eventUntil, ...(await standings(req.user.id)) });
  }));

  app.get('/api/game/client.js', (req, res) => {
    res.type('application/javascript').send(CLIENT);
  });

  // Each game gets a one-time ticket, so a score has to come from a game that really ran that long.
  app.post('/api/game/start', ...requirePlayer, runLimiter, wrap(async (req, res) => {
    pool.query(`DELETE FROM game_runs WHERE finished_at IS NULL AND started_at < now() - interval '1 day'`).catch(() => {});
    const ticket = crypto.randomBytes(24).toString('base64url');
    await pool.query('INSERT INTO game_runs (ticket, user_id) VALUES ($1, $2)', [ticket, req.user.id]);
    res.status(201).json({ ticket });
  }));

  app.post('/api/game/finish', ...requirePlayer, wrap(async (req, res) => {
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
    // Event weeks double every guest's points.
    const maxPoints = MAX_POINTS_PER_GUEST * ((await gameSettings()).eventOn ? 2 : 1);
    if (guests > run.seconds * MAX_GUESTS_PER_SECOND || score > guests * maxPoints) {
      // A refused game keeps no score, so it never counts as a game played.
      await pool.query('UPDATE game_runs SET score = NULL WHERE ticket = $1', [ticket]);
      return fail(res, 400, "That score doesn't match the game, so it wasn't saved.", 'BAD_SCORE');
    }
    await pool.query('UPDATE game_runs SET score = $2, guests = $3 WHERE ticket = $1', [ticket, score, guests]);
    const now = await standings(req.user.id);
    res.json({ ...now, newBest: score > before && score > 0 });
  }));
};
