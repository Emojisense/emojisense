-- Dashboard sign-in moves from GitHub OAuth to Clerk. An account is found by its Clerk user id.
-- github_id stays as a legacy column, and no data is dropped. The sessions table is no longer used
-- for sign-in; a later migration can drop it.

-- SQLite cannot add a UNIQUE column, so a unique index enforces it. NULLs do not collide.
ALTER TABLE accounts ADD COLUMN clerk_user_id TEXT;
CREATE UNIQUE INDEX accounts_by_clerk_user ON accounts(clerk_user_id);

-- Clerk session tokens are checked without a network call, so one issued before DELETE /api/me
-- stays valid for up to a minute. For 10 minutes after a deletion the Clerk user id stays here,
-- so such a token cannot create a new, empty account. Each account deletion prunes older rows.
CREATE TABLE deleted_clerk_users (
  clerk_user_id  TEXT PRIMARY KEY,
  deleted_at     INTEGER NOT NULL
);
