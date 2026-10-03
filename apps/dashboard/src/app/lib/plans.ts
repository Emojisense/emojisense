import {
  type Environment,
  isHigherPlan,
  isListedPlan,
  LISTED_PLAN_IDS,
  lowestPlanWith,
  type Metric,
  PLAN_IDS,
  PLANS,
  type Plan,
  type PlanId,
} from "@emojisense/platform";
import type { MetricUsage } from "../../shared/contract";

export type Feature =
  | "apps"
  | "dev_keys"
  | "staging_keys"
  | "custom_emoji"
  | "emoji_import"
  | "hosted_sets"
  | "analytics"
  | "team"
  | "tenants"
  | "webhooks";

export const planRank = (plan: PlanId) => PLAN_IDS.indexOf(plan);

const lowestPlan = (has: (plan: Plan) => boolean, fallback: PlanId): PlanId =>
  lowestPlanWith(has) ?? fallback;

/**
 * The lowest plan with each feature, for lock hints before a request. Flags come from PLANS; the
 * rest from the product contract. The API's `402` answer names the plan too, and wins. Tenants and
 * webhooks are on Scale, which is not on sale: accounts on it keep them, others do not see them.
 */
export const FEATURE_PLAN: Record<Feature, PlanId> = {
  apps: lowestPlan((plan) => plan.maxApps > 1, "pro"),
  dev_keys: lowestPlan((plan) => plan.environments.includes("dev"), "solo"),
  staging_keys: lowestPlan((plan) => plan.environments.includes("staging"), "pro"),
  custom_emoji: lowestPlan((plan) => plan.limits.custom_emoji > 0, "solo"),
  emoji_import: "pro",
  hosted_sets: lowestPlan((plan) => plan.hostedEmojiSets, "solo"),
  analytics: lowestPlan((plan) => plan.analyticsRetentionDays > 0, "pro"),
  team: lowestPlan((plan) => plan.teamMembers, "pro"),
  tenants: lowestPlan((plan) => plan.tenants, "scale"),
  webhooks: "scale",
};

export function planIncludes(plan: PlanId, feature: Feature): boolean {
  return planRank(plan) >= planRank(FEATURE_PLAN[feature]);
}

/** The plan feature behind an environment's keys; prod is on every plan and has none. */
export const ENVIRONMENT_FEATURE: Record<Environment, Feature | null> = {
  prod: null,
  staging: "staging_keys",
  dev: "dev_keys",
};

/** The cheapest plan on sale that passes `test`; `undefined` when none does (Scale is not sold). */
export function lowestListedPlanWith(test: (plan: Plan) => boolean): PlanId | undefined {
  return LISTED_PLAN_IDS.find((id) => test(PLANS[id]));
}

/** True when a plan on sale is higher than `plan`, so an upgrade can be offered. */
export function hasHigherListedPlan(plan: PlanId): boolean {
  return LISTED_PLAN_IDS.some((id) => isHigherPlan(id, plan));
}

/**
 * Built and running under the PLANS limits, but sold on no plan yet (DECISIONS.md, "Custom emoji
 * not sold at launch"). Accounts whose plan has them keep using them; nobody is offered them.
 */
const UNSOLD_FEATURES: readonly Feature[] = ["custom_emoji", "emoji_import"];

/**
 * False for a feature no plan on sale offers (its lowest plan is not on sale, or it is not sold
 * yet): the dashboard does not offer it.
 */
export function isFeatureListed(feature: Feature): boolean {
  return !UNSOLD_FEATURES.includes(feature) && isListedPlan(FEATURE_PLAN[feature]);
}

/** Photo to emoji is metered under the PLANS limits but sold on no plan yet ("Soon" on the website). */
function isMetricListed(metric: Metric): boolean {
  if (metric === "image_classifications") return false;
  if (metric === "custom_emoji") return isFeatureListed("custom_emoji");
  return true;
}

/**
 * A meter of a metric no plan sells shows only once the account used it this month, so its limit
 * is not offered as a plan feature. A "not included" one stays hidden: it would offer the feature.
 */
export function isUsageShown(usage: MetricUsage): boolean {
  return isMetricListed(usage.metric) || (usage.used > 0 && usage.status !== "not_included");
}

export interface FeatureCopy {
  emoji: string;
  title: string;
  text: string;
  points: string[];
  /** What a gate says when no plan on sale has the feature, or more of it. Default "Coming soon." */
  unlistedNote?: string;
}

export const FEATURE_COPY: Record<Feature, FeatureCopy> = {
  apps: {
    emoji: "🧩",
    title: "More apps",
    text: "Your plan’s apps are all in use. Each app is one product, with its own keys and analytics.",
    points: [
      `Up to ${PLANS.pro.maxApps} apps on Pro`,
      "Own keys and analytics per app",
      "Production, staging and development keys in every app",
    ],
    unlistedNote: "No plan has more apps yet.",
  },
  dev_keys: {
    emoji: "🛠️",
    title: "Development keys",
    text: "Keys for localhost and preview builds, kept apart from production. Revoke them without touching your live keys.",
    points: [
      "Publishable dev keys can allow any origin",
      "Same emoji set as production",
      "Calls count against the same monthly limits",
    ],
  },
  staging_keys: {
    emoji: "🧪",
    title: "Staging keys",
    text: "A separate set of keys for QA and release candidates, so a test build never ships a production key.",
    points: [
      "Own keys and allowed origins for your staging hosts",
      "Same emoji set as production",
      "Calls count against the same monthly limits",
    ],
  },
  custom_emoji: {
    emoji: "🎨",
    title: "Bring your own emoji",
    text: "Upload your team’s and your brand’s emoji. Search finds them next to the standard set, on the device and through the API.",
    points: [
      "PNG, GIF, WebP or SVG, up to 256 KB each",
      "Aliases, so “ship it” finds :shipit:",
      "Searched on the device and through the API",
    ],
  },
  emoji_import: {
    emoji: "📦",
    title: "Import from Slack and Discord",
    text: "Bring a workspace’s emoji over in one step, with their names and aliases.",
    points: [
      "Slack user token or Discord bot token",
      "We use the token once and never store it",
      "Aliases of aliases and emoji over your limit are skipped",
    ],
  },
  hosted_sets: {
    emoji: "🖼️",
    title: "Choose the emoji artwork",
    text: "Show Twemoji, Noto or Fluent in every picker, so emoji look the same on every device.",
    points: [
      "Served from the edge cache, immutable",
      "Switch sets without a release",
      "Attribution handled for you",
    ],
  },
  analytics: {
    emoji: "🔭",
    title: "See what people search for",
    text: "Daily searches, the top queries and the searches that found nothing.",
    points: [
      `${PLANS.pro.analyticsRetentionDays} days of history on Pro`,
      "No user, IP address or message text is stored",
      "Top searches and missed searches for each app",
    ],
  },
  team: {
    emoji: "👥",
    title: "Work on your apps together",
    text: "Invite teammates to your apps as admins, developers or viewers.",
    points: [
      "Invite links that expire after 7 days",
      "Roles from read-only to full access",
      "One bill for the whole team",
    ],
  },
  tenants: {
    emoji: "🏢",
    title: "One emoji set per customer",
    text: "Give each of your customers their own custom emoji, kept apart from the others and searched together with yours.",
    points: [
      "Create tenants here or with the Tenants API",
      "Search with tenant=<id> to add their emoji",
      "Per-tenant counts in the dashboard",
    ],
  },
  webhooks: {
    emoji: "🛰️",
    title: "Get told when things change",
    text: "Receive signed events when custom emoji or tenants change, and when usage passes 80% and 100% of a limit.",
    points: ["HMAC-SHA256 signatures", "Three attempts per event", "A delivery log for each endpoint"],
  },
};
