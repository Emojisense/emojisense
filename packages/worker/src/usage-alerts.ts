import {
  createWebhookEvent,
  dispatchWebhookEvent,
  type FlushedUsage,
  findThresholdCrossings,
  toUsageThresholdData,
  usageThresholdEventId,
  type WebhookRuntime,
} from "@emojisense/platform";

/**
 * `usage.threshold` webhooks from the metering flush: 80% and 100% of a plan limit, once per app,
 * period, metric and threshold. "Once" needs no stored marker: only the flush whose atomic
 * UPSERT moved the count across a threshold sees the crossing (packages/platform
 * usage-thresholds.ts explains why). The event id is stable, so receivers can drop duplicates.
 */
export function alertUsageThresholds(runtime: WebhookRuntime | undefined, flushed: FlushedUsage[]): void {
  const crossings = findThresholdCrossings(flushed);
  if (!runtime || crossings.length === 0) return;
  const now = runtime.now ?? Date.now;
  const deliveries = crossings.map(async (crossing) => {
    const event = createWebhookEvent({
      id: await usageThresholdEventId(crossing),
      type: "usage.threshold",
      appId: crossing.appId,
      data: toUsageThresholdData(crossing),
      createdAt: now(),
    });
    await dispatchWebhookEvent(runtime, event);
  });
  runtime.waitUntil(
    Promise.all(deliveries).catch((error: unknown) => {
      console.warn(JSON.stringify({ event: "usage_alert_failed", error: (error as Error).name }));
    }),
  );
}
