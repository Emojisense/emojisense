import type { PlanId } from "@emojisense/platform";

/** Presentation for each plan. Prices and limits come from PLANS, never from here. */
export const PLAN_COPY: Record<PlanId, { emoji: string; blurb: string; badge?: string }> = {
  free: { emoji: "🐣", blurb: "For side projects and trying it out." },
  solo: { emoji: "🚲", blurb: "For one app with real users." },
  pro: { emoji: "🚀", blurb: "For teams shipping several apps.", badge: "Recommended" },
  scale: { emoji: "🛸", blurb: "For platforms with many customers." },
};

export const FEATURED_PLAN: PlanId = "pro";
