// Full Access perks: following houses (with instant alerts for Full Access) and the early-access window.
// Early access itself lives in party-list.js (isEarly) and is applied where parties leave the server.
const partyList = require('./party-list.js');
const CHAPTERS = require('./public/chapters.js');
const { FULL_SQL } = require('./plan-sql.js');

const chapterName = (id) => CHAPTERS.find((c) => c.id === Number(id))?.name || null;

function create({ pool, wrap, fail, community }) {
  // When a chapter posts a party, Full Access followers hear right away (bell and email).
  // Everyone else gets a bell alert once the party opens to them, 24 hours later (see the alert below).
  function mountHooks(app) {
    app.post('/api/chapter/parties', (req, res, next) => {
      res.on('finish', () => {
        if (res.statusCode !== 201 || !req.user) return;
        (async () => {
          const { rows: [hp] } = await pool.query(
            `SELECT id, chapter_id, title, to_char(party_date, 'YYYY-MM-DD') AS day FROM hosted_parties
             WHERE created_by = $1 AND created_at >= now() - interval '1 minute' ORDER BY id DESC LIMIT 1`,
            [req.user.id]
          );
          if (!hp || !chapterName(hp.chapter_id)) return; // practice chapters aren't on the public list
          const { rows } = await pool.query(
            `SELECT f.user_id FROM chapter_follows f JOIN users u ON u.id = f.user_id
             WHERE f.chapter_id = $1 AND u.banned_at IS NULL AND u.email_verified_at IS NOT NULL AND ${FULL_SQL('u.')}`,
            [hp.chapter_id]
          );
          const when = partyList.dayLabel(hp.day).long;
          for (const r of rows) {
            await community.notify(r.user_id, 'follow', `⭐ ${chapterName(hp.chapter_id)} just posted ${hp.title} (${when}). You're seeing it first with Full Access.`, { link: `/?party=h${hp.id}` });
          }
        })().catch((err) => console.error('Follow alerts failed:', err.message));
      });
      next();
    });
  }

  // Free followers: a bell alert for parties from houses they follow, once those parties open to them.
  community.addAlertSource(async (user) => {
    if (user.plan === 'full') return [];
    const { rows } = await pool.query(
      `SELECT 'h' || hp.id AS id FROM chapter_follows f JOIN hosted_parties hp ON hp.chapter_id = f.chapter_id
       WHERE f.user_id = $1 AND hp.status = 'live' AND hp.created_at >= now() - interval '4 days'
         AND NOT EXISTS (SELECT 1 FROM invite_requests r WHERE r.user_id = $1 AND r.party_id = 'h' || hp.id)
       ORDER BY hp.created_at DESC LIMIT 5`,
      [user.id]
    );
    const alerts = [];
    for (const r of rows) {
      const p = await partyList.findParty(pool, r.id);
      if (!p || partyList.isEarly(p)) continue;
      alerts.push({ kind: 'follow', party: p.id, text: `⭐ ${chapterName(p.ch)} posted ${p.title}. Request before it fills up!` });
      if (alerts.length === 3) break;
    }
    return alerts;
  });

  function mountRoutes(app, requireVerified) {
    app.get('/api/follows', ...requireVerified, wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const { rows } = await pool.query('SELECT chapter_id FROM chapter_follows WHERE user_id = $1', [req.user.id]);
      res.json({ chapters: rows.map((r) => r.chapter_id) });
    }));
    app.post('/api/follows', ...requireVerified, wrap(async (req, res) => {
      const id = Number(req.body?.chapterId);
      if (!Number.isInteger(id) || !chapterName(id)) return fail(res, 400, "That house isn't on PhatFrats.");
      if (req.body?.on === false) await pool.query('DELETE FROM chapter_follows WHERE user_id = $1 AND chapter_id = $2', [req.user.id, id]);
      else {
        const { rows: [n] } = await pool.query('SELECT count(*)::int AS n FROM chapter_follows WHERE user_id = $1', [req.user.id]);
        if (n.n >= 40) return fail(res, 400, "You're following every house there is!");
        await pool.query('INSERT INTO chapter_follows (user_id, chapter_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, id]);
      }
      const { rows } = await pool.query('SELECT chapter_id FROM chapter_follows WHERE user_id = $1', [req.user.id]);
      res.json({ chapters: rows.map((r) => r.chapter_id) });
    }));
  }

  return { mountHooks, mountRoutes };
}

module.exports = { create };
