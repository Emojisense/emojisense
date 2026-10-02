import type { PlanId } from "@emojisense/platform";

/**
 * Presentation for each plan. Prices and limits come from PLANS, never from here; the blurbs and
 * the "Recommended" badge are in the catalogs (src/i18n, plans.blurbs and plans.recommended).
 */
export const PLAN_COPY: Record<PlanId, { emoji: string }> = {
  free: { emoji: "🐣" },
  solo: { emoji: "🚲" },
  pro: { emoji: "🚀" },
  scale: { emoji: "🛸" },
};

export const FEATURED_PLAN: PlanId = "pro";
