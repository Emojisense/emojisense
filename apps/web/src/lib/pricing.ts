import { PLAN_IDS, PLANS, type Plan, type PlanId } from "@emojisense/platform";
import { formatCount, formatDays, formatUsd } from "./format";

export interface PlanFeature {
  key: string;
  label: string;
  /** `true`/`false` render as a check or a dash; strings render as text. */
  value: string | boolean;
  /** The number from PLANS, kept for the build smoke test. */
  raw?: number;
  /** Words after a text value on a plan card ("3M" + "AI calls a month"). */
  unit?: string;
}

/** One row of the feature catalog: how to read a feature from a plan. */
export interface FeatureSpec {
  key: string;
  label: string;
  /** One short line under the label in the comparison table. */
  hint?: string;
  /** Show on plan cards when the plan adds or raises it. */
  onCard?: boolean;
  read(plan: Plan): Pick<PlanFeature, "value" | "raw" | "unit">;
}

export interface FeatureGroup {
  id: string;
  title: string;
  features: FeatureSpec[];
}

export interface PlanView {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  monthly: string;
  yearly?: { price: string; savings: string; raw: number };
  /** The yearly price spread over twelve months ("$4"). */
  yearlyPerMonth?: string;
  features: PlanFeature[];
  /** What this plan adds to the plan before it; for the first plan, what it includes. */
  highlights: PlanFeature[];
  /** Name of the plan this one builds on ("Everything in Solo, plus"). */
  inherits?: string;
  /** `yearlyHref`: the same plan billed yearly, where the plan is sold that way. */
  cta: { label: string; href: string; yearlyHref?: string };
}

export interface ComparisonCell {
  plan: PlanId;
  value: string | boolean;
  raw?: number;
}

export interface ComparisonRow {
  key: string;
  label: string;
  hint?: string;
  cells: ComparisonCell[];
}

export interface ComparisonGroup {
  id: string;
  title: string;
  rows: ComparisonRow[];
}

/**
 * docs/PRICING.md sells some features in bundles that PLANS has no field for: Slack and Discord
 * import ship with team members; webhooks and priority support ship with tenants. They are read
 * through the flag they ship with, so PLANS stays the only source.
 */
const bundled = {
  emojiImport: (plan: Plan) => plan.teamMembers,
  webhooks: (plan: Plan) => plan.tenants,
  prioritySupport: (plan: Plan) => plan.tenants,
};

function limit(value: number, unit: string): Pick<PlanFeature, "value" | "raw" | "unit"> {
  return value === 0 ? { value: false, raw: 0 } : { value: formatCount(value), raw: value, unit };
}

/** Every feature on the pricing page, grouped for the comparison table. Order is display order. */
export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "core",
    title: "On every plan",
    features: [
      {
        key: "search",
        label: "Semantic search and reaction suggestions",
        hint: "Slang, films, feelings and typos, in every supported language",
        onCard: true,
        // Policy, not a limit: search is free on every plan (docs/PRICING.md).
        read: () => ({ value: true }),
      },
      {
        key: "sdks",
        label: "All SDKs and integrations",
        hint: "React, web component, editors, Swift, MCP. No “powered by” badge",
        onCard: true,
        read: () => ({ value: true }),
      },
      {
        key: "on_device",
        label: "On-device and ready-made answers",
        hint: "Never counted as calls",
        onCard: true,
        // Not metered on any plan: on-device hits and static shards (docs/PRICING.md).
        read: () => ({ value: "Unlimited", unit: "on-device answers" }),
      },
    ],
  },
  {
    id: "usage",
    title: "Usage",
    features: [
      {
        key: "semantic_calls",
        label: "AI calls a month",
        hint: "Meaning searches and reaction suggestions that reach the edge API",
        onCard: true,
        read: (plan) => limit(plan.limits.semantic_calls, "AI calls a month"),
      },
      {
        key: "image_classifications",
        label: "Photo to emoji a month",
        hint: "Photos classified into emoji",
        onCard: true,
        read: (plan) => limit(plan.limits.image_classifications, "photos to emoji a month"),
      },
      {
        key: "over_limit",
        label: "Keeps working past a limit",
        hint: "Never a hard failure; the device answers until the next month",
        read: () => ({ value: true }),
      },
    ],
  },
  {
    id: "emoji",
    title: "Custom emoji and sets",
    features: [
      {
        key: "custom_emoji",
        label: "Custom emoji",
        hint: "One set, searched next to the standard emoji",
        onCard: true,
        read: (plan) => limit(plan.limits.custom_emoji, "custom emoji"),
      },
      {
        key: "emoji_import",
        label: "Slack and Discord import",
        hint: "Bring an existing custom set along",
        onCard: true,
        read: (plan) => ({ value: bundled.emojiImport(plan) }),
      },
      {
        key: "hosted_sets",
        label: "Hosted emoji sets",
        hint: "Twemoji, Noto and Fluent, the same look on every device",
        onCard: true,
        read: (plan) => ({ value: plan.hostedEmojiSets }),
      },
    ],
  },
  {
    id: "teams",
    title: "Insights and teams",
    features: [
      {
        key: "analytics",
        label: "Analytics history",
        hint: "What people search for, and what they do not find",
        onCard: true,
        read: (plan) =>
          plan.analyticsRetentionDays > 0
            ? {
                value: formatDays(plan.analyticsRetentionDays),
                raw: plan.analyticsRetentionDays,
                unit: "of analytics",
              }
            : { value: false, raw: 0 },
      },
      {
        key: "apps",
        label: "Apps or environments",
        hint: "Separate keys for dev, staging and production",
        onCard: true,
        read: (plan) => ({
          value: formatCount(plan.maxApps),
          unit: plan.maxApps === 1 ? "app or environment" : "apps or environments",
          ...(Number.isFinite(plan.maxApps) ? { raw: plan.maxApps } : {}),
        }),
      },
      {
        key: "team",
        label: "Team members",
        hint: "Invite your team to one account",
        onCard: true,
        read: (plan) => ({ value: plan.teamMembers }),
      },
    ],
  },
  {
    id: "platform",
    title: "For platforms",
    features: [
      {
        key: "tenants",
        label: "Tenants",
        hint: "One custom emoji set per customer, managed through the API",
        onCard: true,
        read: (plan) => ({ value: plan.tenants }),
      },
      {
        key: "webhooks",
        label: "Webhooks",
        hint: "Hear about tenant and emoji changes",
        onCard: true,
        read: (plan) => ({ value: bundled.webhooks(plan) }),
      },
    ],
  },
  {
    id: "support",
    title: "Support",
    features: [
      {
        key: "community_support",
        label: "Community support",
        hint: "GitHub Discussions and the docs",
        read: () => ({ value: true }),
      },
      {
        key: "priority_support",
        label: "Priority support",
        onCard: true,
        read: (plan) => ({ value: bundled.prioritySupport(plan) }),
      },
    ],
  },
];

const FEATURE_SPECS = FEATURE_GROUPS.flatMap((group) => group.features);

/** The short list that summarizes a plan (waitlist page, older cards). Keys are stable. */
const SUMMARY_KEYS = [
  "search",
  "semantic_calls",
  "image_classifications",
  "custom_emoji",
  "hosted_sets",
  "analytics",
  "apps",
  "team",
  "tenants",
] as const;

function featureOf(spec: FeatureSpec, plan: Plan): PlanFeature {
  return { key: spec.key, label: spec.label, ...spec.read(plan) };
}

function specFor(key: string): FeatureSpec {
  const spec = FEATURE_SPECS.find((candidate) => candidate.key === key);
  if (!spec) throw new Error(`Unknown pricing feature "${key}"`);
  return spec;
}

export function featuresOf(plan: Plan): PlanFeature[] {
  return SUMMARY_KEYS.map((key) => featureOf(specFor(key), plan));
}

function isIncluded(feature: PlanFeature): boolean {
  return feature.value !== false;
}

/**
 * Card features for "Everything in <previous>, plus": features this plan includes that the
 * previous plan lacks or has less of. The first plan lists everything it includes.
 */
export function highlightsOf(plan: Plan, previous?: Plan): PlanFeature[] {
  return FEATURE_SPECS.filter((spec) => spec.onCard)
    .map((spec) => ({ current: featureOf(spec, plan), before: previous && featureOf(spec, previous) }))
    .filter(({ current, before }) => isIncluded(current) && (!before || before.value !== current.value))
    .map(({ current }) => current);
}

export function comparisonOf(plans: Record<PlanId, Plan> = PLANS): ComparisonGroup[] {
  return FEATURE_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    rows: group.features.map((spec) => ({
      key: spec.key,
      label: spec.label,
      ...(spec.hint ? { hint: spec.hint } : {}),
      cells: PLAN_IDS.map((id) => {
        const { value, raw } = spec.read(plans[id]);
        return { plan: id, value, ...(raw === undefined ? {} : { raw }) };
      }),
    })),
  }));
}

/** The dashboard's Billing page with the plan picked: sign-in first, then Whop's checkout. */
export function checkoutHref(dashboardUrl: string, plan: PlanId, interval: "month" | "year"): string {
  return `${dashboardUrl}/billing?${new URLSearchParams({ plan, interval })}`;
}

/** Free starts in the dashboard; a paid plan opens Billing in the dashboard with that plan. */
function ctaFor(plan: Plan, dashboardUrl: string): PlanView["cta"] {
  if (plan.priceUsdMonthly === 0) return { label: "Get a free key", href: `${dashboardUrl}/` };
  return {
    label: `Get ${plan.name}`,
    href: checkoutHref(dashboardUrl, plan.id, "month"),
    ...(plan.priceUsdYearly === undefined ? {} : { yearlyHref: checkoutHref(dashboardUrl, plan.id, "year") }),
  };
}

export function planViews(dashboardUrl: string, plans: Record<PlanId, Plan> = PLANS): PlanView[] {
  return PLAN_IDS.map((id, index) => {
    const plan = plans[id];
    const previousId = PLAN_IDS[index - 1];
    const previous = previousId === undefined ? undefined : plans[previousId];
    const yearly = plan.priceUsdYearly;
    return {
      id,
      name: plan.name,
      monthlyUsd: plan.priceUsdMonthly,
      monthly: formatUsd(plan.priceUsdMonthly),
      ...(yearly === undefined
        ? {}
        : {
            yearly: {
              price: formatUsd(yearly),
              savings: formatUsd(plan.priceUsdMonthly * 12 - yearly),
              raw: yearly,
            },
            yearlyPerMonth: formatUsd(Math.round((yearly / 12) * 100) / 100),
          }),
      features: featuresOf(plan),
      highlights: highlightsOf(plan, previous),
      ...(previous ? { inherits: previous.name } : {}),
      cta: ctaFor(plan, dashboardUrl),
    };
  });
}

/** Biggest yearly saving across plans, in whole percent (0 when no plan bills yearly). */
export function yearlySavingsPercent(plans: Record<PlanId, Plan> = PLANS): number {
  const savings = PLAN_IDS.map((id) => plans[id]).map((plan) =>
    plan.priceUsdYearly === undefined || plan.priceUsdMonthly === 0
      ? 0
      : 1 - plan.priceUsdYearly / (plan.priceUsdMonthly * 12),
  );
  return Math.round(Math.max(0, ...savings) * 100);
}
