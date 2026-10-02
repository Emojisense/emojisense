import { SHARD_BUILD_CRON } from "./config.ts";
import { CULTURE_NIGHTLY_CRON, CULTURE_SYNC_CRON } from "./culture-admin/config.ts";
import { runCultureNightly, runCultureSyncCron } from "./culture-admin/job.ts";
import type { CultureRuntime } from "./culture-admin/runtime.ts";
import type { Env } from "./env.ts";
import { handleScheduled } from "./retention.ts";
import type { Catalog } from "./semantic.ts";
import { runShardBuild } from "./shards/job.ts";

/**
 * The Worker's cron triggers (wrangler.jsonc `triggers.crons`): the nightly shard build and the
 * culture jobs on their own schedules, the retention jobs on every other one.
 */
export async function runScheduled(
  controller: { cron: string; scheduledTime: number },
  env: Env,
  catalog: Catalog,
  culture?: CultureRuntime,
): Promise<void> {
  if (controller.cron === SHARD_BUILD_CRON) {
    await runShardBuild(env, catalog, { now: controller.scheduledTime });
    return;
  }
  if (controller.cron === CULTURE_NIGHTLY_CRON || controller.cron === CULTURE_SYNC_CRON) {
    if (!culture) return;
    const run = controller.cron === CULTURE_NIGHTLY_CRON ? runCultureNightly : runCultureSyncCron;
    await run(env, culture, { now: controller.scheduledTime });
    return;
  }
  await handleScheduled(env, controller.scheduledTime);
}
