/**
 * `whop_memberships`: what the webhook knows about each Whop membership, independent of accounts.
 * - Out-of-order events: the newest state of a membership is kept with its event time, so an
 *   activation that arrives after a newer deactivation or cancellation cannot grant more.
 * - Retired memberships (a newer plan replaced them, or their account was deleted) never give an
 *   account a plan again, and the Worker cancels them at period end until Whop confirms: after a
 *   webhook, from the daily cron, and again when Whop reports that one renews after all. A call
 *   that fails waits longer each time (up to a day), so a row that keeps failing cannot hold back
 *   newer ones.
 */
import {
  type AccountRow,
  DAY_MS,
  type WhopMembershipRow,
  type WhopMembershipState,
} from "@emojisense/platform";
import type { D1Database, D1PreparedStatement } from "../d1";
import type { Deps, Env } from "../env";
import { cancelMembership, WhopApiError } from "./api";
import { whopApi } from "./config";

/** Rows that belong to no account only order events; Whop retries for about 3 days. */
const UNATTACHED_KEEP_DAYS = 30;
/** Cancels per run, so one webhook answer or cron run stays short. */
const CANCELS_PER_RUN = 10;
const HOUR_MS = 60 * 60 * 1000;

/** The wait after the n-th failed cancel call: 1 h, 2 h, 4 h, … at most a day. */
export function cancelBackoffMs(attempts: number): number {
  return Math.min(DAY_MS, HOUR_MS * 2 ** Math.max(0, attempts - 1));
}

/**
 * What an event means for a retired membership's cancel: `reset` (it renews: cancel it again),
 * `confirm` (Whop reports it cancelled) or `keep`.
 */
export type CancelEffect = "reset" | "confirm" | "keep";

export async function membershipRow(db: D1Database, id: string): Promise<WhopMembershipRow | null> {
  return db.prepare("SELECT * FROM whop_memberships WHERE id = ?").bind(id).first<WhopMembershipRow>();
}

/**
 * Records the state an event reports for a membership, unless a newer event is stored already.
 * `accountId` attaches the row to an account (an attached row is never detached here).
 */
export function recordMembership(
  db: D1Database,
  input: {
    id: string;
    accountId: string | null;
    state: WhopMembershipState;
    periodEnd: number | null;
    at: number;
    cancel: CancelEffect;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO whop_memberships (id, account_id, state, period_end, event_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         account_id = COALESCE(whop_memberships.account_id, excluded.account_id),
         state = excluded.state,
         period_end = COALESCE(excluded.period_end, whop_memberships.period_end),
         event_at = excluded.event_at,
         cancel_confirmed_at = CASE ?
           WHEN 'reset' THEN NULL
           WHEN 'confirm' THEN COALESCE(whop_memberships.cancel_confirmed_at, excluded.event_at)
           ELSE whop_memberships.cancel_confirmed_at END,
         cancel_attempts = CASE ? WHEN 'reset' THEN 0 ELSE whop_memberships.cancel_attempts END,
         cancel_retry_at = CASE ? WHEN 'reset' THEN NULL ELSE whop_memberships.cancel_retry_at END
       WHERE excluded.event_at >= whop_memberships.event_at`,
    )
    .bind(input.id, input.accountId, input.state, input.periodEnd, input.at, ...Array(3).fill(input.cancel));
}

/** Attaches a membership to its account, whatever the order of its events. */
export function attachMembership(db: D1Database, id: string, accountId: string): D1PreparedStatement {
  return db
    .prepare("UPDATE whop_memberships SET account_id = ? WHERE id = ? AND account_id IS NULL")
    .bind(accountId, id);
}

/**
 * Marks a membership retired. `confirmed`: Whop already stops it from renewing (it was
 * cancelling), so no call is needed unless Whop later reports that it renews.
 */
export function retireMembership(
  db: D1Database,
  input: { id: string; accountId: string | null; state: WhopMembershipState; at: number; confirmed: boolean },
): D1PreparedStatement {
  const confirmedAt = input.confirmed ? input.at : null;
  return db
    .prepare(
      `INSERT INTO whop_memberships (id, account_id, state, event_at, retired_at, cancel_confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         account_id = excluded.account_id,
         retired_at = COALESCE(whop_memberships.retired_at, excluded.retired_at),
         cancel_confirmed_at = excluded.cancel_confirmed_at,
         cancel_attempts = 0,
         cancel_retry_at = NULL`,
    )
    .bind(input.id, input.accountId, input.state, input.at, input.at, confirmedAt);
}

/**
 * Account deletion, in the same D1 batch as the account's rows: memberships that only ordered
 * events or ended go; retired ones stay without the account id, so a pending cancel is not lost;
 * the membership that still renews is retired, still to cancel.
 */
export function deletedAccountMembershipStatements(
  db: D1Database,
  account: AccountRow,
  now: number,
): D1PreparedStatement[] {
  const statements = [
    db
      .prepare(
        "DELETE FROM whop_memberships WHERE account_id = ? AND (retired_at IS NULL OR state = 'ended')",
      )
      .bind(account.id),
    db.prepare("UPDATE whop_memberships SET account_id = NULL WHERE account_id = ?").bind(account.id),
  ];
  const status = account.billing_status;
  if (
    account.whop_membership_id &&
    (status === "active" || status === "past_due" || status === "canceling")
  ) {
    statements.push(
      retireMembership(db, {
        id: account.whop_membership_id,
        accountId: null,
        state: status,
        at: now,
        confirmed: status === "canceling",
      }),
    );
  }
  return statements;
}

/**
 * Asks Whop to stop each retired membership from renewing, until Whop confirms. A membership that
 * Whop no longer knows (404) needs nothing more. A failure is logged and tried again after a
 * backoff, on a later webhook or the daily cron.
 */
export async function cancelRetiredMemberships(env: Env, deps: Pick<Deps, "fetch" | "now">): Promise<number> {
  const now = deps.now();
  const { results } = await env.DB.prepare(
    `SELECT id, event_at, cancel_attempts FROM whop_memberships
     WHERE retired_at IS NOT NULL AND cancel_confirmed_at IS NULL AND state != 'ended'
       AND (cancel_retry_at IS NULL OR cancel_retry_at <= ?)
     ORDER BY cancel_attempts, retired_at LIMIT ?`,
  )
    .bind(now, CANCELS_PER_RUN)
    .all<{ id: string; event_at: number; cancel_attempts: number }>();
  if (results.length === 0) return 0;
  const api = whopApi(env);
  if (!api) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "whop_cancel_pending",
        reason: "no_api_key",
        count: results.length,
      }),
    );
    return 0;
  }
  let confirmed = 0;
  for (const row of results) {
    try {
      // A new key after each renewal reset: Whop must not answer with the cancel it already did.
      await cancelMembership(
        deps.fetch,
        api,
        row.id,
        "Replaced by another Emojisense plan",
        `${row.id}-${row.event_at}`,
      );
    } catch (error) {
      if (!(error instanceof WhopApiError && error.status === 404)) {
        const attempts = row.cancel_attempts + 1;
        // No membership id in logs; whop_memberships has the rows still to cancel.
        console.error(
          JSON.stringify({
            level: "error",
            event: "whop_cancel_failed",
            status: error instanceof WhopApiError ? error.status : 0,
            attempts,
          }),
        );
        await env.DB.prepare(
          "UPDATE whop_memberships SET cancel_attempts = ?, cancel_retry_at = ? WHERE id = ?",
        )
          .bind(attempts, now + cancelBackoffMs(attempts), row.id)
          .run();
        continue;
      }
    }
    await env.DB.prepare("UPDATE whop_memberships SET cancel_confirmed_at = ? WHERE id = ?")
      .bind(now, row.id)
      .run();
    confirmed += 1;
  }
  if (confirmed > 0) console.log(JSON.stringify({ event: "whop_memberships_cancelled", count: confirmed }));
  return confirmed;
}

/** Deletes memberships of no account that have been quiet for 30 days; they only ordered events. */
export function pruneMemberships(db: D1Database, now: number): D1PreparedStatement {
  return db
    .prepare("DELETE FROM whop_memberships WHERE account_id IS NULL AND retired_at IS NULL AND event_at < ?")
    .bind(now - UNATTACHED_KEEP_DAYS * DAY_MS);
}
