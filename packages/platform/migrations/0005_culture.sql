-- Culture Phase 2 (docs/ARCHITECTURE.md, "Culture layer"): AI proposals from the nightly job and
-- the entries editors approve in the dashboard. Written only by the API Worker (the dashboard
-- reaches it through a service binding); git (packages/data/culture/entries) stays the long-term
-- record through the export.

-- One AI draft per entry id. Drafts are never served. A rejected row stays, so the same id is not
-- proposed again. `record` is the entry JSON (packages/data/culture/schema.json); `evidence` holds
-- aggregate trend counts and the calendar source, never anything about one user.
CREATE TABLE culture_proposals (
  id                   TEXT PRIMARY KEY,
  entry_id             TEXT NOT NULL UNIQUE,
  status               TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'rejected')),
  record               TEXT NOT NULL,
  evidence             TEXT NOT NULL,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  reviewer_account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  reviewer_name        TEXT,
  reviewed_at          INTEGER,
  reason               TEXT
);
CREATE INDEX culture_proposals_by_status ON culture_proposals(status, created_at);

-- Approved entries that are live without a deploy: merged into the deployed culture files and
-- published to R2. `exported_at` is set when an export wrote the entry to git; once the deployed
-- files hold the same id, the git entry wins and this row is only history.
CREATE TABLE culture_entries_live (
  id                   TEXT PRIMARY KEY,
  status               TEXT NOT NULL CHECK (status IN ('approved', 'retired')),
  record               TEXT NOT NULL,
  proposal_id          TEXT REFERENCES culture_proposals(id) ON DELETE SET NULL,
  approved_at          INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  reviewer_account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  reviewer_name        TEXT NOT NULL,
  reason               TEXT,
  exported_at          INTEGER
);
CREATE INDEX culture_entries_live_by_status ON culture_entries_live(status);
