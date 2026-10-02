-- Paid plans through Whop (DECISIONS.md, "Whop for payments"). The dashboard Worker's checkout and
-- webhook routes write these columns; accounts.plan stays the one plan that every Worker reads.
-- Times are Unix epoch milliseconds.

-- The Whop membership that pays for the account's plan. A unique index, because SQLite cannot add
-- a UNIQUE column; NULLs do not collide.
ALTER TABLE accounts ADD COLUMN whop_membership_id TEXT;
CREATE UNIQUE INDEX accounts_by_whop_membership ON accounts(whop_membership_id);

-- none: never paid. active: paid and renewing. canceling: cancelled, paid until current_period_end.
-- past_due: a renewal failed; the plan stays until billing_grace_until. canceled: ended, plan free.
ALTER TABLE accounts ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'none'
  CHECK (billing_status IN ('none', 'active', 'canceling', 'past_due', 'canceled'));
-- 'month' or 'year' of the paid plan; NULL without one.
ALTER TABLE accounts ADD COLUMN billing_interval TEXT CHECK (billing_interval IN ('month', 'year'));
-- End of the paid period: the next renewal, or the end of a cancelled subscription.
ALTER TABLE accounts ADD COLUMN current_period_end INTEGER;
-- past_due only: when the account moves to Free unless a payment succeeds first.
ALTER TABLE accounts ADD COLUMN billing_grace_until INTEGER;
-- Whop's link where the buyer manages the subscription (card, cancel), when Whop sends one.
ALTER TABLE accounts ADD COLUMN whop_manage_url TEXT;
-- Time of the newest Whop event applied to this account. Whop does not keep events in order, so
-- an older event never overwrites the state of a newer one.
ALTER TABLE accounts ADD COLUMN billing_event_at INTEGER;
-- The sweep of lapsed subscriptions (expireLapsedBilling) reads only paying accounts.
CREATE INDEX accounts_lapsing ON accounts(billing_status)
  WHERE billing_status IN ('active', 'past_due', 'canceling');

-- Whop webhook deliveries already applied, by webhook-id: Whop delivers each event at least once
-- and retries for about 3 days. Rows older than 30 days are deleted.
CREATE TABLE whop_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  INTEGER NOT NULL
);
CREATE INDEX whop_events_by_time ON whop_events(received_at);

-- Every Whop membership the webhook has seen, with its newest state and that event's time. Whop
-- does not keep events in order: a deactivation that arrives before the activation stays here, so
-- the activation cannot grant the plan afterwards. A retired membership (replaced by a newer plan,
-- or of a deleted account) never gives an account a plan again, and the Worker asks Whop to cancel
-- it until Whop confirms. account_id has no foreign key: a deleted account's retired membership
-- stays here without it. Rows of no account are deleted after 30 days.
CREATE TABLE whop_memberships (
  id                   TEXT PRIMARY KEY,
  account_id           TEXT,
  state                TEXT NOT NULL CHECK (state IN ('active', 'canceling', 'past_due', 'ended')),
  period_end           INTEGER,
  event_at             INTEGER NOT NULL,
  retired_at           INTEGER,
  -- Retired: when Whop confirmed that it stops renewing. NULL = still to cancel.
  cancel_confirmed_at  INTEGER,
  -- Failed cancel calls since the last reset, and when to try again (backoff), so a row that keeps
  -- failing cannot hold back newer ones.
  cancel_attempts      INTEGER NOT NULL DEFAULT 0,
  cancel_retry_at      INTEGER
);
CREATE INDEX whop_memberships_by_account ON whop_memberships(account_id);
CREATE INDEX whop_memberships_to_cancel ON whop_memberships(retired_at)
  WHERE retired_at IS NOT NULL AND cancel_confirmed_at IS NULL;

