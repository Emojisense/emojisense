import {
  createWebhookEvent,
  dispatchWebhookEvent,
  type FlushedUsage,
  findThresholdCrossings,
  type ThresholdCrossing,
  toUsageThresholdData,
  usageThresholdEventId,
  type WebhookRuntime,
} from "@emojisense/platform";

/**
 * `usage.threshold` webhooks from the metering flush: 80% and 100% of a plan limit, once per
 * account, period, metric and threshold. "Once" needs no stored marker: only the flush whose batch
 * moved the account total across a threshold sees the crossing (packages/platform
 * usage-thresholds.ts explains why). Plan limits are per account, so the event goes to the
 * webhooks of every app of the account, each with its own appId and the same event id.
 */
export function alertUsageThresholds(runtime: WebhookRuntime | undefined, flushed: FlushedUsage[]): void {
  const crossings = findThresholdCrossings(flushed);
  if (!runtime || crossings.length === 0) return;
  runtime.waitUntil(
    Promise.all(crossings.map((crossing) => announce(runtime, crossing))).catch((error: unknown) => {
      console.warn(JSON.stringify({ event: "usage_alert_failed", error: (error as Error).name }));
    }),
  );
}

async function announce(runtime: WebhookRuntime, crossing: ThresholdCrossing): Promise<void> {
  const { results } = await runtime.db
    .prepare(
      `SELECT DISTINCT w.app_id FROM webhooks w JOIN apps a ON a.id = w.app_id
       WHERE a.account_id = ? AND w.disabled_at IS NULL`,
    )
    .bind(crossing.accountId)
    .all<{ app_id: string }>();
  if (results.length === 0) return;
  const id = await usageThresholdEventId(crossing);
  const createdAt = (runtime.now ?? Date.now)();
  const data = toUsageThresholdData(crossing);
  await Promise.all(
    results.map(({ app_id }) =>
      dispatchWebhookEvent(
        runtime,
        createWebhookEvent({ id, type: "usage.threshold", appId: app_id, data, createdAt }),
      ),
    ),
  );
}
