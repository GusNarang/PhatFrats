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
