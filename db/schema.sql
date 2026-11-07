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
