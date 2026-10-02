import { SHARD_BUILD_CRON } from "./config.ts";
import type { Env } from "./env.ts";
import { handleScheduled } from "./retention.ts";
import type { Catalog } from "./semantic.ts";
import { runShardBuild } from "./shards/job.ts";

/**
 * The Worker's cron triggers (wrangler.jsonc `triggers.crons`): the nightly shard build on its
 * own schedule, the retention jobs on every other one.
 */
export async function runScheduled(
  controller: { cron: string; scheduledTime: number },
  env: Env,
  catalog: Catalog,
): Promise<void> {
  if (controller.cron === SHARD_BUILD_CRON) {
    await runShardBuild(env, catalog, { now: controller.scheduledTime });
    return;
  }
  await handleScheduled(env, controller.scheduledTime);
}
