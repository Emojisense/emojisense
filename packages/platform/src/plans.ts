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

/**
 * The plans on sale and on the pricing page. Scale stays in PLANS so accounts on it and its gates
 * keep working, but it is not shown or sold until its features are ready (DECISIONS.md, "Scale
 * hidden at launch").
 */
export const LISTED_PLAN_IDS: readonly PlanId[] = ["free", "solo", "pro"];

/**
 * Every app has these environments; a key belongs to one. Production is on every plan, dev and
 * staging come with paid plans (DECISIONS.md, "Environments belong to keys"). Order: menus, tabs.
 */
export const ENVIRONMENTS = ["prod", "staging", "dev"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

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
  /** The environments its keys may use. `prod` is always first. */
  environments: readonly Environment[];
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
    environments: ["prod"],
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
    environments: ["prod", "dev"],
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
    environments: ["prod", "staging", "dev"],
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
    environments: ["prod", "staging", "dev"],
    teamMembers: true,
    tenants: true,
  },
};

export function isListedPlan(id: PlanId): boolean {
  return LISTED_PLAN_IDS.includes(id);
}

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

export function planHasEnvironment(id: PlanId, environment: Environment): boolean {
  return PLANS[id].environments.includes(environment);
}

/** True when `a` is a higher plan than `b` (plans are ordered by price in PLAN_IDS). */
export function isHigherPlan(a: PlanId, b: PlanId): boolean {
  return PLAN_IDS.indexOf(a) > PLAN_IDS.indexOf(b);
}

/** Monthly period key, UTC: "2026-10". */
export function periodOf(time: number | Date = Date.now()): string {
  return new Date(time).toISOString().slice(0, 7);
}
