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

-- Whop webhook deliveries already applied, by webhook-id: Whop delivers each event at least once
-- and retries for about 3 days. Rows older than 30 days are deleted.
CREATE TABLE whop_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  INTEGER NOT NULL
);
CREATE INDEX whop_events_by_time ON whop_events(received_at);
