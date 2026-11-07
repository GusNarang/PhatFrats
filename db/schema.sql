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
