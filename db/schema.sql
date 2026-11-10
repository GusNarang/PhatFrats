-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'full')),
  plan_paid_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stays empty until the owner types the code emailed to them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- One live confirmation code per user. Only its hash is stored.
CREATE TABLE IF NOT EXISTS email_codes (
  user_id           BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash         TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  attempts          SMALLINT NOT NULL DEFAULT 0,
  last_sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_in_window    SMALLINT NOT NULL DEFAULT 1
);

-- Same shape as email_codes, kept apart so a reset code can't confirm an email or the reverse.
CREATE TABLE IF NOT EXISTS password_reset_codes (
  user_id           BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash         TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  attempts          SMALLINT NOT NULL DEFAULT 0,
  last_sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_in_window    SMALLINT NOT NULL DEFAULT 1
);

-- PhatBot messages per person per day (Eastern time), for the daily limit.
CREATE TABLE IF NOT EXISTS chat_usage (
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      DATE NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Only a hash of each session token is stored, so a database leak can't be used to log in.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS invite_requests (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party_id   TEXT NOT NULL,
  guests     SMALLINT NOT NULL DEFAULT 0 CHECK (guests BETWEEN 0 AND 3),
  note       TEXT NOT NULL DEFAULT '',
  priority   BOOLEAN NOT NULL DEFAULT FALSE,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'waitlist')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, party_id)
);
-- A host's queue for a party: Full Access first, then oldest first.
CREATE INDEX IF NOT EXISTS invite_requests_queue_idx ON invite_requests(party_id, priority DESC, created_at);

-- Control room. Only accounts with role 'admin' can open /admin. Set it by hand in the database.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
-- A banned account can't log in, and its sessions are deleted when the ban starts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- What each PhatBot message cost, so the control room can show the AI bill.
ALTER TABLE chat_usage ADD COLUMN IF NOT EXISTS input_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE chat_usage ADD COLUMN IF NOT EXISTS output_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE chat_usage ADD COLUMN IF NOT EXISTS cache_read_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE chat_usage ADD COLUMN IF NOT EXISTS cache_write_tokens BIGINT NOT NULL DEFAULT 0;

-- One row per browser per day (Eastern time). The visitor id is a random number the browser makes up,
-- so nothing here identifies a person.
CREATE TABLE IF NOT EXISTS site_visits (
  day     DATE NOT NULL,
  visitor TEXT NOT NULL,
  views   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (day, visitor)
);

-- The control room's second lock. Only a hash of the admin password is stored.
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_password_hash TEXT;
-- Set when a login is unlocked with the admin password. Logging out deletes the session, which locks it again.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS admin_until TIMESTAMPTZ;

-- ---------- Frat portal ----------
-- One row per chapter that has been set up. chapter_id matches the ids in public/chapters.js.
-- Brothers join with this password. Only its hash is stored.
CREATE TABLE IF NOT EXISTS chapter_accounts (
  chapter_id    INTEGER PRIMARY KEY,
  password_hash TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each student account can belong to one chapter.
CREATE TABLE IF NOT EXISTS chapter_members (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL,
  role       TEXT NOT NULL DEFAULT 'brother' CHECK (role IN ('leader', 'brother')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chapter_members_chapter_idx ON chapter_members(chapter_id);

-- Parties a chapter posts. On the site their id is 'h' followed by this id.
CREATE TABLE IF NOT EXISTS hosted_parties (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chapter_id INTEGER NOT NULL,
  title      TEXT NOT NULL,
  party_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  vibe       TEXT NOT NULL CHECK (vibe IN ('neon', 'theme', 'day', 'chill', 'formal', 'charity')),
  blurb      TEXT NOT NULL DEFAULT '',
  dress      TEXT NOT NULL DEFAULT '',
  music      TEXT NOT NULL DEFAULT '',
  cap        INTEGER NOT NULL CHECK (cap BETWEEN 1 AND 5000),
  status     TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'cancelled')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hosted_parties_chapter_idx ON hosted_parties(chapter_id, party_date);

-- A brother's personal invite, by email. It turns into an approved invite when that person logs in.
CREATE TABLE IF NOT EXISTS brother_invites (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  party_id   BIGINT NOT NULL REFERENCES hosted_parties(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  guests     SMALLINT NOT NULL DEFAULT 0 CHECK (guests BETWEEN 0 AND 3),
  invited_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (party_id, email)
);
CREATE INDEX IF NOT EXISTS brother_invites_email_idx ON brother_invites(email);

-- Set when the invite came from a brother rather than the student asking. These don't use the weekly free invite.
ALTER TABLE invite_requests ADD COLUMN IF NOT EXISTS invited_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

-- Plus-ones were removed: everyone who comes needs their own invite. The guests columns stay at 0,
-- and this clears any plus-ones saved before the change.
UPDATE invite_requests SET guests = 0 WHERE guests <> 0;
UPDATE brother_invites SET guests = 0 WHERE guests <> 0;

-- A second password per chapter that signs someone in as a chapter leader. A chapter can have
-- just one of the two passwords, so the brother password may be empty.
ALTER TABLE chapter_accounts ADD COLUMN IF NOT EXISTS leader_password_hash TEXT;
ALTER TABLE chapter_accounts ALTER COLUMN password_hash DROP NOT NULL;

-- ---------- Outside guests ----------
-- A leader can let each party take outside guests: people who aren't Penn State students.
ALTER TABLE hosted_parties ADD COLUMN IF NOT EXISTS allow_outside_guests BOOLEAN NOT NULL DEFAULT FALSE;

-- Each outside guest is named and tied to the Penn State student or brother who vouches for them.
-- One per sponsor per party. A student's guest waits for the leader; a brother's guest is approved.
-- These rows are deleted two days after the party, so guests' details aren't kept.
CREATE TABLE IF NOT EXISTS outside_guests (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  party_id    BIGINT NOT NULL REFERENCES hosted_parties(id) ON DELETE CASCADE,
  sponsor_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'waitlist')),
  notified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (party_id, sponsor_id),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS outside_guests_sponsor_idx ON outside_guests(sponsor_id);

-- Door Rush, the Full Access game. Each row is one game, started with a one-time ticket.
CREATE TABLE IF NOT EXISTS game_runs (
  ticket      TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER,
  guests      INTEGER,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS game_runs_week_idx ON game_runs(finished_at, score DESC);
CREATE INDEX IF NOT EXISTS game_runs_user_idx ON game_runs(user_id, score DESC);

-- ---------- Payments ----------
-- When a paid Full Access pass ends. Empty for Free, and for Full Access given by hand with no end date.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_paid_until TIMESTAMPTZ;

-- One row per paid Stripe Checkout. The session id makes recording a payment safe to repeat.
CREATE TABLE IF NOT EXISTS payments (
  stripe_session_id TEXT PRIMARY KEY,
  user_id           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  payment_intent    TEXT,
  pass_until        DATE NOT NULL,
  livemode          BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments(user_id);

-- What a chapter's leaders wrote about their chapter, and colors they picked instead of the national ones.
CREATE TABLE IF NOT EXISTS chapter_profiles (
  chapter_id INTEGER PRIMARY KEY,
  tagline    TEXT NOT NULL DEFAULT '',
  about      TEXT NOT NULL DEFAULT '',
  color1     TEXT,
  color2     TEXT,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- The Batcave (control room extras) ----------
-- Switches flipped from the control room: lockdown, spotlight, Door Rush event and reset, money goal.
CREATE TABLE IF NOT EXISTS admin_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The live ticker. Plain descriptions only, with no names or emails. Kept for 30 days.
CREATE TABLE IF NOT EXISTS activity_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_events_time_idx ON activity_events(created_at);
-- Every change made from the control room, and by whom.
CREATE TABLE IF NOT EXISTS admin_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The beacon: a banner across the site. Only the newest active one shows.
CREATE TABLE IF NOT EXISTS announcements (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text       TEXT NOT NULL,
  tone       TEXT NOT NULL DEFAULT 'gold',
  audience   TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'free', 'full', 'leaders')),
  ends_at    TIMESTAMPTZ,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Discount codes for Full Access checkout.
CREATE TABLE IF NOT EXISTS promo_codes (
  code        TEXT PRIMARY KEY,
  percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  max_uses    INTEGER,
  uses        INTEGER NOT NULL DEFAULT 0,
  ends_at     TIMESTAMPTZ,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS promo_code TEXT;
-- Who has the site open right now, for the live radar. The visitor id is the random one from site_visits.
CREATE TABLE IF NOT EXISTS site_presence (
  visitor    TEXT PRIMARY KEY,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  path       TEXT NOT NULL DEFAULT '/',
  looking_at TEXT
);
CREATE INDEX IF NOT EXISTS site_presence_seen_idx ON site_presence(last_seen);
-- The site a visitor came from (just the domain), for the growth panel.
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS referrer TEXT;

-- ---------- Community: what keeps students coming back ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_reward_at TIMESTAMPTZ;
-- Email updates (approvals, prizes, the Weekend Drop). On by default; switch off in the profile.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_in BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS saved_parties (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party_id   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, party_id)
);
-- The bell.
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  link       TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, id DESC);
-- Group plans: a shared link for friends going to the same party. Each still requests their own invite.
CREATE TABLE IF NOT EXISTS party_groups (
  code       TEXT PRIMARY KEY,
  party_id   TEXT NOT NULL,
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS group_members (
  code      TEXT NOT NULL REFERENCES party_groups(code) ON DELETE CASCADE,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);
-- Door Rush: last week's champion wins a free semester, recorded once per week.
CREATE TABLE IF NOT EXISTS game_prizes (
  week_start DATE PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  score      INTEGER NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Reports from the Party Smart kit and messages from the About page, read in the control room.
CREATE TABLE IF NOT EXISTS reports (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  about       TEXT NOT NULL DEFAULT '',
  details     TEXT NOT NULL,
  closed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contact_messages (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'other',
  message    TEXT NOT NULL,
  closed_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- How an inbox item was closed (replied, dismissed or reported), and the reply that was sent.
ALTER TABLE reports          ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE reports          ADD COLUMN IF NOT EXISTS reply  TEXT;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS reply  TEXT;
-- Senders reported as spam or abuse. Their new messages and reports are quietly dropped.
CREATE TABLE IF NOT EXISTS inbox_blocks (
  email      TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Friends ----------
-- One row per pair of people. It starts as a request and becomes a friendship when the other person accepts.
CREATE TABLE IF NOT EXISTS friendships (
  requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at  TIMESTAMPTZ,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
-- Only one row per pair, whichever way round it was sent.
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_idx ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships(addressee_id);
-- Blocking is silent: the blocked person isn't told, and can't send requests or see anything.
CREATE TABLE IF NOT EXISTS friend_blocks (
  blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
-- "I'm going": the parties someone chose to show their friends. Deleted once the party's day has passed,
-- so nobody has a history of where they've been.
CREATE TABLE IF NOT EXISTS friend_going (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party_id   TEXT NOT NULL,
  party_day  DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, party_id)
);
CREATE INDEX IF NOT EXISTS friend_going_day_idx ON friend_going(party_day);
-- Ghost mode: hidden from friends until this time ('infinity' means until switched off).
ALTER TABLE users ADD COLUMN IF NOT EXISTS ghost_until TIMESTAMPTZ;
-- A chapter can keep who's going to a party private, so it never shows on friends' boards.
ALTER TABLE hosted_parties ADD COLUMN IF NOT EXISTS hide_friends BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------- Free boosts ----------
-- First weekend free: new accounts get Full Access through their first Sunday. Set once, when the email is
-- confirmed, so nobody gets it twice. It doesn't change `plan`, so it never counts as a paid pass.
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_until TIMESTAMPTZ;
-- Extra invites a free account earned (a friend joined with their link, or a Door Rush top-10 week).
-- Used up one at a time after the weekly free invite, and kept until used.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_invites INTEGER NOT NULL DEFAULT 0;
-- Set on a request that used an earned extra invite, so the bonus can be handed back if needed.
ALTER TABLE invite_requests ADD COLUMN IF NOT EXISTS used_bonus BOOLEAN NOT NULL DEFAULT FALSE;
-- Which weeks have had their Door Rush top-10 invites handed out, so it happens once per week.
ALTER TABLE game_prizes ADD COLUMN IF NOT EXISTS top10_done BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------- Full Access perks ----------
-- Houses a student follows. Full Access followers get an alert the moment the house posts a party;
-- everyone else hears when the party opens to them, 24 hours later.
CREATE TABLE IF NOT EXISTS chapter_follows (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chapter_id)
);
CREATE INDEX IF NOT EXISTS chapter_follows_chapter_idx ON chapter_follows(chapter_id);

-- ---------- Fixes ----------
-- Set once a referred account's confirmation has been counted for its referrer, so the referrer's extra
-- invite and progress note can never be given twice for the same friend.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_counted_at TIMESTAMPTZ;
-- Friends who were already counted before this column existed (every confirmed referral so far).
UPDATE users SET referral_counted_at = email_verified_at
  WHERE referral_counted_at IS NULL AND referred_by IS NOT NULL AND email_verified_at IS NOT NULL;
