import { PLAN_IDS, PLANS, type Plan, type PlanId } from "@emojisense/platform";
import type { Messages } from "../i18n/catalogs";
import en from "../i18n/en.json";
import { formatCountIn, formatDaysIn, formatUsdIn } from "../i18n/format";
import { interpolate } from "../i18n/translate";

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

/** The plan words of one language (the catalog's `plans` part) and its Intl tag. */
export interface PricingLocale {
  tag: string;
  words: Messages["plans"];
}

export const ENGLISH_PRICING: PricingLocale = { tag: "en", words: en.plans };

type FeatureText = keyof Messages["plans"]["features"];
type GroupId = keyof Messages["plans"]["groups"];

/** One row of the feature catalog: how to read a feature from a plan. */
export interface FeatureSpec {
  key: string;
  /** Its label, hint and unit words in the catalog (plans.features). */
  text: FeatureText;
  /** Show on plan cards when the plan adds or raises it. */
  onCard?: boolean;
  read(plan: Plan, page: PricingLocale): Pick<PlanFeature, "value" | "raw" | "unit">;
}

export interface FeatureGroup {
  id: GroupId;
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

function textOf(page: PricingLocale, text: FeatureText): { label: string; hint?: string; unit?: unknown } {
  return page.words.features[text];
}

/** A unit that is one string for every count. */
function unitOf(page: PricingLocale, text: FeatureText): string {
  const unit = textOf(page, text).unit;
  return typeof unit === "string" ? unit : "";
}

function count(page: PricingLocale, value: number): string {
  return formatCountIn(page.tag, value, page.words.unlimited);
}

function limit(
  page: PricingLocale,
  value: number,
  text: FeatureText,
): Pick<PlanFeature, "value" | "raw" | "unit"> {
  return value === 0
    ? { value: false, raw: 0 }
    : { value: count(page, value), raw: value, unit: unitOf(page, text) };
}

/** Every feature on the pricing page, grouped for the comparison table. Order is display order. */
export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "core",
    features: [
      {
        key: "search",
        text: "search",
        onCard: true,
        // Policy, not a limit: search is free on every plan (docs/PRICING.md).
        read: () => ({ value: true }),
      },
      {
        key: "sdks",
        text: "sdks",
        onCard: true,
        read: () => ({ value: true }),
      },
      {
        key: "on_device",
        text: "onDevice",
        onCard: true,
        // Not metered on any plan: on-device hits and static shards (docs/PRICING.md).
        read: (_plan, page) => ({ value: page.words.unlimited, unit: unitOf(page, "onDevice") }),
      },
    ],
  },
  {
    id: "usage",
    features: [
      {
        key: "semantic_calls",
        text: "semanticCalls",
        onCard: true,
        read: (plan, page) => limit(page, plan.limits.semantic_calls, "semanticCalls"),
      },
      {
        key: "image_classifications",
        text: "photos",
        onCard: true,
        read: (plan, page) => limit(page, plan.limits.image_classifications, "photos"),
      },
      {
        key: "over_limit",
        text: "overLimit",
        read: () => ({ value: true }),
      },
    ],
  },
  {
    id: "emoji",
    features: [
      {
        key: "custom_emoji",
        text: "customEmoji",
        onCard: true,
        read: (plan, page) => limit(page, plan.limits.custom_emoji, "customEmoji"),
      },
      {
        key: "emoji_import",
        text: "emojiImport",
        onCard: true,
        read: (plan) => ({ value: bundled.emojiImport(plan) }),
      },
      {
        key: "hosted_sets",
        text: "hostedSets",
        onCard: true,
        read: (plan) => ({ value: plan.hostedEmojiSets }),
      },
    ],
  },
  {
    id: "teams",
    features: [
      {
        key: "analytics",
        text: "analytics",
        onCard: true,
        read: (plan, page) =>
          plan.analyticsRetentionDays > 0
            ? {
                value: formatDaysIn(page.tag, plan.analyticsRetentionDays),
                raw: plan.analyticsRetentionDays,
                unit: unitOf(page, "analytics"),
              }
            : { value: false, raw: 0 },
      },
      {
        key: "apps",
        text: "apps",
        onCard: true,
        read: (plan, page) => {
          const forms = page.words.features.apps.unit;
          const category = Number.isFinite(plan.maxApps)
            ? new Intl.PluralRules(page.tag).select(plan.maxApps)
            : "other";
          return {
            value: count(page, plan.maxApps),
            unit: (forms as Record<string, string | undefined>)[category] ?? forms.other,
            ...(Number.isFinite(plan.maxApps) ? { raw: plan.maxApps } : {}),
          };
        },
      },
      {
        key: "team",
        text: "team",
        onCard: true,
        read: (plan) => ({ value: plan.teamMembers }),
      },
    ],
  },
  {
    id: "platform",
    features: [
      {
        key: "tenants",
        text: "tenants",
        onCard: true,
        read: (plan) => ({ value: plan.tenants }),
      },
      {
        key: "webhooks",
        text: "webhooks",
        onCard: true,
        read: (plan) => ({ value: bundled.webhooks(plan) }),
      },
    ],
  },
  {
    id: "support",
    features: [
      {
        key: "community_support",
        text: "communitySupport",
        read: () => ({ value: true }),
      },
      {
        key: "priority_support",
        text: "prioritySupport",
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

function featureOf(spec: FeatureSpec, plan: Plan, page: PricingLocale): PlanFeature {
  return { key: spec.key, label: textOf(page, spec.text).label, ...spec.read(plan, page) };
}

function specFor(key: string): FeatureSpec {
  const spec = FEATURE_SPECS.find((candidate) => candidate.key === key);
  if (!spec) throw new Error(`Unknown pricing feature "${key}"`);
  return spec;
}

export function featuresOf(plan: Plan, page: PricingLocale = ENGLISH_PRICING): PlanFeature[] {
  return SUMMARY_KEYS.map((key) => featureOf(specFor(key), plan, page));
}

function isIncluded(feature: PlanFeature): boolean {
  return feature.value !== false;
}

/**
 * Card features for "Everything in <previous>, plus": features this plan includes that the
 * previous plan lacks or has less of. The first plan lists everything it includes.
 */
export function highlightsOf(
  plan: Plan,
  previous?: Plan,
  page: PricingLocale = ENGLISH_PRICING,
): PlanFeature[] {
  return FEATURE_SPECS.filter((spec) => spec.onCard)
    .map((spec) => ({
      current: featureOf(spec, plan, page),
      before: previous && featureOf(spec, previous, page),
    }))
    .filter(({ current, before }) => isIncluded(current) && (!before || before.value !== current.value))
    .map(({ current }) => current);
}

export function comparisonOf(
  plans: Record<PlanId, Plan> = PLANS,
  page: PricingLocale = ENGLISH_PRICING,
): ComparisonGroup[] {
  return FEATURE_GROUPS.map((group) => ({
    id: group.id,
    title: page.words.groups[group.id],
    rows: group.features.map((spec) => {
      const text = textOf(page, spec.text);
      return {
        key: spec.key,
        label: text.label,
        ...(text.hint ? { hint: text.hint } : {}),
        cells: PLAN_IDS.map((id) => {
          const { value, raw } = spec.read(plans[id], page);
          return { plan: id, value, ...(raw === undefined ? {} : { raw }) };
        }),
      };
    }),
  }));
}

/** The dashboard's Billing page with the plan picked: sign-in first, then Whop's checkout. */
export function checkoutHref(dashboardUrl: string, plan: PlanId, interval: "month" | "year"): string {
  return `${dashboardUrl}/billing?${new URLSearchParams({ plan, interval })}`;
}

/** Free starts in the dashboard; a paid plan opens Billing in the dashboard with that plan. */
function ctaFor(plan: Plan, dashboardUrl: string, page: PricingLocale): PlanView["cta"] {
  if (plan.priceUsdMonthly === 0) return { label: page.words.getFreeKey, href: `${dashboardUrl}/` };
  return {
    label: interpolate(page.words.getPlan, { plan: plan.name }),
    href: checkoutHref(dashboardUrl, plan.id, "month"),
    ...(plan.priceUsdYearly === undefined ? {} : { yearlyHref: checkoutHref(dashboardUrl, plan.id, "year") }),
  };
}

export function planViews(
  dashboardUrl: string,
  plans: Record<PlanId, Plan> = PLANS,
  page: PricingLocale = ENGLISH_PRICING,
): PlanView[] {
  const usd = (value: number) => formatUsdIn(page.tag, value);
  return PLAN_IDS.map((id, index) => {
    const plan = plans[id];
    const previousId = PLAN_IDS[index - 1];
    const previous = previousId === undefined ? undefined : plans[previousId];
    const yearly = plan.priceUsdYearly;
    return {
      id,
      name: plan.name,
      monthlyUsd: plan.priceUsdMonthly,
      monthly: usd(plan.priceUsdMonthly),
      ...(yearly === undefined
        ? {}
        : {
            yearly: {
              price: usd(yearly),
              savings: usd(plan.priceUsdMonthly * 12 - yearly),
              raw: yearly,
            },
            yearlyPerMonth: usd(Math.round((yearly / 12) * 100) / 100),
          }),
      features: featuresOf(plan, page),
      highlights: highlightsOf(plan, previous, page),
      ...(previous ? { inherits: previous.name } : {}),
      cta: ctaFor(plan, dashboardUrl, page),
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
