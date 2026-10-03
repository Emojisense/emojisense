-- Environments belong to keys (DECISIONS.md, "Environments belong to keys"). An app used to be one
-- environment, chosen once at creation; now every app has prod, and the plan adds dev and staging.
-- Each key takes its app's environment, so existing keys keep their meaning. apps.environment
-- stays as a legacy column, like apps.plan: new apps write its default and nothing reads it.
ALTER TABLE api_keys ADD COLUMN environment TEXT NOT NULL DEFAULT 'prod'
  CHECK (environment IN ('dev', 'staging', 'prod'));

UPDATE api_keys SET environment = (SELECT environment FROM apps WHERE apps.id = api_keys.app_id);
