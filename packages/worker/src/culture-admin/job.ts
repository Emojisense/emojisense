/**
 * The culture crons (wrangler.jsonc `triggers.crons`): the nightly proposal job followed by a full
 * publish, and the 10-minute sync that republishes after a deploy or an approval.
 */
import { TRENDS_KEEP_DAYS } from "@emojisense/platform";
import type { Env } from "../env.ts";
import { runCultureProposals } from "./propose.ts";
import { runCulturePublish, runCultureSync } from "./publish.ts";
import type { CultureRuntime } from "./runtime.ts";
import { createCultureStore } from "./store.ts";

const DAY_MS = 86_400_000;

export async function runCultureNightly(
  env: Env,
  runtime: CultureRuntime,
  options: { now: number },
): Promise<void> {
  let failure: unknown;
  try {
    if (env.DB) {
      // Trend evidence lives no longer than the trends themselves.
      const pruned = await createCultureStore(env.DB).pruneTrendEvidence(
        options.now - TRENDS_KEEP_DAYS * DAY_MS,
      );
      if (pruned > 0) console.log(JSON.stringify({ event: "culture_evidence_pruned", proposals: pruned }));
    }
    await runCultureProposals(env, runtime, options);
  } catch (error) {
    failure = error;
    console.error(JSON.stringify({ event: "culture_proposals_failed", error: (error as Error).name }));
  }
  // Publishing does not depend on the proposals: approvals stay live even when Workers AI is down.
  const published = await runCulturePublish(env, runtime, { now: options.now, reason: "nightly" });
  // Rethrown so the cron run is marked as failed in the Cloudflare dashboard.
  if (failure) throw failure;
  if (published.status === "failed") throw new Error(`culture publish failed: ${published.reason}`);
}

export async function runCultureSyncCron(
  env: Env,
  runtime: CultureRuntime,
  options: { now: number },
): Promise<void> {
  const report = await runCultureSync(env, runtime, options);
  if (report.status === "failed") throw new Error(`culture publish failed: ${report.reason}`);
}
