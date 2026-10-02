-- Emojisense hosted service, D1 (SQLite). Shared by the API Worker and the dashboard.
-- Times are Unix epoch milliseconds. IDs are random URL-safe strings.

CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE,
  github_id   TEXT UNIQUE,
  name        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,           -- SHA-256 of the cookie token
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE apps (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  environment  TEXT NOT NULL DEFAULT 'prod' CHECK (environment IN ('dev', 'staging', 'prod')),
  plan         TEXT NOT NULL DEFAULT 'free',
  created_at   INTEGER NOT NULL
);
CREATE INDEX apps_by_account ON apps(account_id);

CREATE TABLE api_keys (
  id               TEXT PRIMARY KEY,
  app_id           TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('publishable', 'secret')),
  prefix           TEXT NOT NULL,           -- first 12 chars, shown in the dashboard
  hash             TEXT NOT NULL UNIQUE,    -- SHA-256 hex of the full key
  allowed_origins  TEXT NOT NULL DEFAULT '[]', -- JSON array; publishable keys only; [] = any (dev only)
  created_at       INTEGER NOT NULL,
  revoked_at       INTEGER
);
CREATE INDEX api_keys_by_app ON api_keys(app_id);

-- Monthly counters, flushed in batches by the API Worker. period = 'YYYY-MM' (UTC).
CREATE TABLE usage_monthly (
  app_id  TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  period  TEXT NOT NULL,
  metric  TEXT NOT NULL CHECK (metric IN ('semantic_calls', 'image_classifications', 'custom_emoji')),
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, period, metric)
);

CREATE TABLE waitlist (
  email       TEXT PRIMARY KEY,
  plan        TEXT,
  created_at  INTEGER NOT NULL
);
