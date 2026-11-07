// Builds the party list the site shows: the demo parties plus every live party a chapter has posted.
const DEMO = require('./data/parties.js');
const TEST_CHAPTER_IDS = require('./data/test-chapters.js').map((c) => c.id);

const DEMO_BY_ID = new Map(DEMO.map((p) => [p.id, p]));
const DEMO_WEEKDAY = { thu: 3, fri: 4, sat: 5, sun: 6 }; // days after Monday
// Chapters can post parties up to this many days ahead.
const DAYS_AHEAD = 13;
const ZONE = 'America/New_York';

// Today's date in State College, as 'YYYY-MM-DD'.
function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// The demo parties always fall on this week's Thursday to Sunday.
function demoDate(dayKey, today = todayISO()) {
  const weekday = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  return addDays(addDays(today, -weekday), DEMO_WEEKDAY[dayKey]);
}
function dayLabel(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return {
    k: iso,
    label: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    long: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  };
}

const isHostedId = (id) => typeof id === 'string' && /^h\d{1,18}$/.test(id);

// People going to a posted party: approved requests plus brother invites not yet claimed. One person per invite.
const GOING_SQL = `(
  coalesce((SELECT count(*) FROM invite_requests r WHERE r.party_id = 'h' || hp.id AND r.status = 'approved'), 0) +
  coalesce((SELECT count(*) FROM brother_invites b WHERE b.party_id = hp.id AND NOT EXISTS (
    SELECT 1 FROM invite_requests r JOIN users u ON u.id = r.user_id WHERE r.party_id = 'h' || hp.id AND u.email = b.email)), 0)
)::int`;

const hostedRow = (r) => ({
  id: 'h' + r.id,
  ch: r.chapter_id,
  title: r.title,
  day: r.day,
  time: r.start_time,
  vibe: r.vibe,
  blurb: r.blurb,
  dress: r.dress || 'Anything goes',
  music: r.music || 'Ask the house',
  cap: r.cap,
  going: Math.min(r.going, r.cap),
  hosted: true,
});

async function hostedParties(pool, { today = todayISO() } = {}) {
  const { rows } = await pool.query(
    `SELECT hp.*, to_char(hp.party_date, 'YYYY-MM-DD') AS day, ${GOING_SQL} AS going
     FROM hosted_parties hp
     WHERE hp.status = 'live' AND hp.party_date BETWEEN $1::date AND $1::date + $2::int
       AND hp.chapter_id <> ALL($3::int[])
     ORDER BY hp.party_date, hp.id`,
    [today, DAYS_AHEAD, TEST_CHAPTER_IDS]
  );
  return rows.map(hostedRow);
}

// Everything the main page needs: the parties and the nights to filter by.
async function partiesForSite(pool) {
  const today = todayISO();
  const demo = DEMO.map((p) => ({ ...p, day: demoDate(p.day, today) }));
  const parties = [...demo, ...(await hostedParties(pool, { today }))];
  const days = [...new Set(parties.map((p) => p.day))].sort().map(dayLabel);
  return { parties, days };
}

// A party someone can still ask to go to, or null. Practice chapters' parties only count for their own brothers' invites.
async function findParty(pool, id, { includeTest = false } = {}) {
  if (DEMO_BY_ID.has(id)) return DEMO_BY_ID.get(id);
  if (!isHostedId(id)) return null;
  const today = todayISO();
  const { rows: [r] } = await pool.query(
    `SELECT hp.*, to_char(hp.party_date, 'YYYY-MM-DD') AS day, ${GOING_SQL} AS going FROM hosted_parties hp
     WHERE hp.id = $1 AND hp.status = 'live' AND hp.party_date BETWEEN $2::date AND $2::date + $3::int
       AND ($4 OR hp.chapter_id <> ALL($5::int[]))`,
    [id.slice(1), today, DAYS_AHEAD, includeTest, TEST_CHAPTER_IDS]
  );
  return r ? hostedRow(r) : null;
}

module.exports = { DEMO_BY_ID, DAYS_AHEAD, GOING_SQL, todayISO, addDays, dayLabel, isHostedId, hostedParties, partiesForSite, findParty };
