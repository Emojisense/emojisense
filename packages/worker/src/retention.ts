import {
  addDays,
  analyticsKeepDays,
  dayOf,
  getPlan,
  PLAN_IDS,
  type PlanId,
  waitlistCutoff,
} from "@emojisense/platform";
import { RETENTION_DELETE_BATCH, RETENTION_MAX_BATCHES } from "./config.ts";
import type { Env } from "./env.ts";
import type { D1Like, D1Statement } from "./store.ts";

/** The first UTC day each plan keeps. Rows of earlier days are deleted. */
export interface RetentionCutoffs {
  byPlan: Record<PlanId, string>;
  /** For account plans that are not in PLANS (getPlan treats them as free). */
  fallback: string;
}

/** A plan that keeps N days keeps today and the N − 1 days before it. */
export function retentionCutoffs(now: number): RetentionCutoffs {
  const today = dayOf(now);
  const firstKept = (id: string) => addDays(today, 1 - analyticsKeepDays(getPlan(id)));
  return {
    byPlan: Object.fromEntries(PLAN_IDS.map((id) => [id, firstKept(id)])) as Record<PlanId, string>,
    fallback: firstKept(""),
  };
}

/**
 * One batch of expired rows. The plan is the account's (`accounts.plan`); rows whose app or
 * account is gone fall to the fallback. `q.day < ?` (the latest cutoff of any plan) lets SQLite
 * use the day index and skip every row that no plan would delete yet.
 */
const DELETE_EXPIRED = `
  DELETE FROM query_daily WHERE rowid IN (
    SELECT q.rowid FROM query_daily q
    LEFT JOIN apps a ON a.id = q.app_id
    LEFT JOIN accounts acc ON acc.id = a.account_id
    WHERE q.day < ?
      AND q.day < CASE acc.plan ${PLAN_IDS.map(() => "WHEN ? THEN ?").join(" ")} ELSE ? END
    LIMIT ?)`;

/**
 * One batch of waitlist rows older than WAITLIST_KEEP_MONTHS, counted from the first sign-up
 * (DECISIONS.md, "Waitlist retention"). The table is small, so created_at needs no index.
 */
const DELETE_EXPIRED_WAITLIST = `
  DELETE FROM waitlist WHERE rowid IN (SELECT rowid FROM waitlist WHERE created_at < ? LIMIT ?)`;

export interface PruneResult {
  deleted: number;
  batches: number;
  /** False when the run stopped at `maxBatches`; the next run continues. */
  complete: boolean;
}

export interface PruneOptions {
  batchSize?: number;
  maxBatches?: number;
}

/**
 * Runs a `DELETE … LIMIT batchSize` statement until a batch deletes fewer rows. Small batches keep
 * each statement short; the batch cap bounds the work of one cron run.
 */
async function deleteInBatches(
  statement: D1Statement,
  batchSize: number,
  maxBatches: number,
): Promise<PruneResult> {
  let deleted = 0;
  for (let batches = 1; batches <= maxBatches; batches++) {
    const { meta } = await statement.run();
    deleted += meta.changes;
    if (meta.changes < batchSize) return { deleted, batches, complete: true };
  }
  return { deleted, batches: maxBatches, complete: false };
}

/**
 * Deletes query_daily rows older than the retention of their account's plan (DECISIONS.md,
 * "Search analytics retention").
 */
export async function pruneQueryDaily(
  db: D1Like,
  now: number,
  options: PruneOptions = {},
): Promise<PruneResult> {
  const batchSize = options.batchSize ?? RETENTION_DELETE_BATCH;
  const { byPlan, fallback } = retentionCutoffs(now);
  const latest = [fallback, ...Object.values(byPlan)].reduce((a, b) => (a > b ? a : b));
  const statement = db
    .prepare(DELETE_EXPIRED)
    .bind(latest, ...PLAN_IDS.flatMap((id) => [id, byPlan[id]]), fallback, batchSize);
  return deleteInBatches(statement, batchSize, options.maxBatches ?? RETENTION_MAX_BATCHES);
}

/** Deletes waitlist rows whose first sign-up is older than WAITLIST_KEEP_MONTHS. */
export async function pruneWaitlist(
  db: D1Like,
  now: number,
  options: PruneOptions = {},
): Promise<PruneResult> {
  const batchSize = options.batchSize ?? RETENTION_DELETE_BATCH;
  const statement = db.prepare(DELETE_EXPIRED_WAITLIST).bind(waitlistCutoff(now), batchSize);
  return deleteInBatches(statement, batchSize, options.maxBatches ?? RETENTION_MAX_BATCHES);
}

const RETENTION_JOBS = [
  { table: "query_daily", prune: pruneQueryDaily },
  { table: "waitlist", prune: pruneWaitlist },
] as const;

/**
 * The daily cron (wrangler.jsonc `triggers.crons`). Each job runs even when an earlier one
 * failed. Logs counts only, never ids, emails or queries.
 */
export async function handleScheduled(env: Env, scheduledTime: number): Promise<void> {
  if (!env.DB) return;
  let failure: unknown;
  for (const job of RETENTION_JOBS) {
    try {
      const result = await job.prune(env.DB, scheduledTime);
      console.log(JSON.stringify({ event: `${job.table}_pruned`, ...result }));
    } catch (error) {
      console.error(JSON.stringify({ event: `${job.table}_prune_failed`, error: (error as Error).name }));
      failure ??= error;
    }
  }
  // Rethrown so the cron run is marked as failed in the Cloudflare dashboard.
  if (failure !== undefined) throw failure;
}
