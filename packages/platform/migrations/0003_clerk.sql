-- Dashboard sign-in moves from GitHub OAuth to Clerk. An account is found by its Clerk user id.
-- github_id stays as a legacy column, and no data is dropped. The sessions table is no longer used
-- for sign-in; a later migration can drop it.

-- SQLite cannot add a UNIQUE column, so a unique index enforces it. NULLs do not collide.
ALTER TABLE accounts ADD COLUMN clerk_user_id TEXT;
CREATE UNIQUE INDEX accounts_by_clerk_user ON accounts(clerk_user_id);
