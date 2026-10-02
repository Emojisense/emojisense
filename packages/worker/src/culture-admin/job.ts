/**
 * The culture crons (wrangler.jsonc `triggers.crons`): the nightly proposal job followed by a full
 * publish, and the 10-minute sync that republishes after a deploy or an approval.
 */
import type { Env } from "../env.ts";
import { runCultureProposals } from "./propose.ts";
import { runCulturePublish, runCultureSync } from "./publish.ts";
import type { CultureRuntime } from "./runtime.ts";

export async function runCultureNightly(
  env: Env,
  runtime: CultureRuntime,
  options: { now: number },
): Promise<void> {
  let failure: unknown;
  try {
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
