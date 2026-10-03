/**
 * The single source of plan limits (Update #2 §4). Numbers are placeholders until pricing is
 * validated; change them here only. Static-asset (shard, pack) and on-device hits are never
 * metered. Over a limit, the API answers with `overLimit: true` and clients fall back to the
 * on-device dictionary and shards — search never fails.
 */
export const METRICS = ["semantic_calls", "image_classifications", "custom_emoji"] as const;
export type Metric = (typeof METRICS)[number];

export const PLAN_IDS = ["free", "solo", "pro", "scale"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  priceUsdMonthly: number;
  /** Yearly price where offered (monthly $5 loses ~15% to payment fees). */
  priceUsdYearly?: number;
  limits: Record<Metric, number>;
  hostedEmojiSets: boolean;
  analyticsRetentionDays: number;
  maxApps: number;
  teamMembers: boolean;
  tenants: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsdMonthly: 0,
    limits: { semantic_calls: 10_000, image_classifications: 100, custom_emoji: 0 },
    hostedEmojiSets: false,
    analyticsRetentionDays: 0,
    maxApps: 1,
    teamMembers: false,
    tenants: false,
  },
  solo: {
    id: "solo",
    name: "Solo",
    priceUsdMonthly: 5,
    priceUsdYearly: 48,
    limits: { semantic_calls: 100_000, image_classifications: 1_000, custom_emoji: 500 },
    hostedEmojiSets: true,
    analyticsRetentionDays: 0,
    maxApps: 1,
    teamMembers: false,
    tenants: false,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdMonthly: 20,
    limits: { semantic_calls: 1_000_000, image_classifications: 10_000, custom_emoji: 2_000 },
    hostedEmojiSets: true,
    analyticsRetentionDays: 30,
    maxApps: 3,
    teamMembers: true,
    tenants: false,
  },
  scale: {
    id: "scale",
    name: "Scale",
    priceUsdMonthly: 100,
    limits: { semantic_calls: 5_000_000, image_classifications: 75_000, custom_emoji: 10_000 },
    hostedEmojiSets: true,
    analyticsRetentionDays: 365,
    maxApps: Number.POSITIVE_INFINITY,
    teamMembers: true,
    tenants: true,
  },
};

export function getPlan(id: string): Plan {
  return PLANS[(PLAN_IDS as readonly string[]).includes(id) ? (id as PlanId) : "free"];
}

/**
 * The cheapest plan that passes `test`, e.g. `lowestPlanWith((p) => p.teamMembers)` → "pro".
 * Plan gates name it in their `402 plan_required` answer. `undefined` = no plan has it.
 */
export function lowestPlanWith(test: (plan: Plan) => boolean): PlanId | undefined {
  return PLAN_IDS.find((id) => test(PLANS[id]));
}

/** True when `a` is a higher plan than `b` (plans are ordered by price in PLAN_IDS). */
export function isHigherPlan(a: PlanId, b: PlanId): boolean {
  return PLAN_IDS.indexOf(a) > PLAN_IDS.indexOf(b);
}

/** Monthly period key, UTC: "2026-10". */
export function periodOf(time: number | Date = Date.now()): string {
  return new Date(time).toISOString().slice(0, 7);
}
