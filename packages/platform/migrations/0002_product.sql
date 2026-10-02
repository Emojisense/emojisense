-- Product features of the paid plans: team, custom emoji, tenants, webhooks, analytics, emoji sets.
-- Times are Unix epoch milliseconds. IDs are random URL-safe strings.

-- The plan belongs to the paying account; every app of the account gets it.
ALTER TABLE accounts ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
UPDATE accounts SET plan = COALESCE(
  (SELECT a.plan FROM apps a WHERE a.account_id = accounts.id ORDER BY
     CASE a.plan WHEN 'scale' THEN 4 WHEN 'pro' THEN 3 WHEN 'solo' THEN 2 ELSE 1 END DESC LIMIT 1),
  'free');

-- Which emoji artwork the app's pickers show: the device's own font or a hosted set.
ALTER TABLE apps ADD COLUMN emoji_set TEXT NOT NULL DEFAULT 'native'
  CHECK (emoji_set IN ('native', 'twemoji', 'noto', 'fluent'));

-- Team (Pro and Scale): other accounts that may work on the owner's apps.
CREATE TABLE team_members (
  owner_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'developer', 'viewer')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (owner_id, member_id)
);
CREATE INDEX team_members_by_member ON team_members(member_id);

-- Invite links. The token is shown once; only its SHA-256 is stored.
CREATE TABLE team_invites (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('admin', 'developer', 'viewer')),
  token_hash   TEXT NOT NULL UNIQUE,
  email        TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  accepted_at  INTEGER
);
CREATE INDEX team_invites_by_owner ON team_invites(owner_id);

-- Tenants (Scale): the app owner's own customers, each with its own custom emoji.
CREATE TABLE tenants (
  id           TEXT PRIMARY KEY,
  app_id       TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  external_id  TEXT NOT NULL,            -- the customer's id in the owner's system
  name         TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (app_id, external_id)
);

-- Custom emoji. tenant_id '' = app-wide (SQLite treats NULLs as distinct in UNIQUE).
CREATE TABLE custom_emoji (
  id            TEXT PRIMARY KEY,
  app_id        TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL DEFAULT '',
  shortcode     TEXT NOT NULL,           -- without colons: [a-z0-9_+-], 1–64 chars
  aliases       TEXT NOT NULL DEFAULT '[]', -- JSON string[], normalized search phrases
  image_key     TEXT NOT NULL,           -- R2 object key
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/gif', 'image/webp', 'image/svg+xml')),
  bytes         INTEGER NOT NULL,
  source        TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'slack', 'discord', 'api')),
  created_at    INTEGER NOT NULL,
  UNIQUE (app_id, tenant_id, shortcode)
);
CREATE INDEX custom_emoji_by_app ON custom_emoji(app_id, tenant_id);

-- Webhooks (Scale). The secret signs deliveries (HMAC-SHA256), so it is stored as is.
CREATE TABLE webhooks (
  id           TEXT PRIMARY KEY,
  app_id       TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  secret       TEXT NOT NULL,
  events       TEXT NOT NULL DEFAULT '[]', -- JSON string[] of event names
  created_at   INTEGER NOT NULL,
  disabled_at  INTEGER
);
CREATE INDEX webhooks_by_app ON webhooks(app_id);

-- The last deliveries of each webhook, for the dashboard. Pruned to 50 per webhook.
CREATE TABLE webhook_deliveries (
  id           TEXT PRIMARY KEY,
  webhook_id   TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  status       INTEGER,                  -- HTTP status; NULL = network error
  duration_ms  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX webhook_deliveries_by_hook ON webhook_deliveries(webhook_id, created_at);

-- Analytics (Pro and Scale): daily search counts per app and normalized query (≤ 64 chars).
-- No user, IP or key is stored. "misses" = searches that returned no result.
CREATE TABLE query_daily (
  app_id    TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,               -- 'YYYY-MM-DD' (UTC)
  query     TEXT NOT NULL,
  searches  INTEGER NOT NULL DEFAULT 0,
  misses    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, day, query)
);
CREATE INDEX query_daily_by_day ON query_daily(day);
