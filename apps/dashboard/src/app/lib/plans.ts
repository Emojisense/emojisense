import { lowestPlanWith, PLAN_IDS, PLANS, type Plan, type PlanId } from "@emojisense/platform";
import { formatNumber } from "../format";

export type Feature =
  | "apps"
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
 * rest from the product contract. The API's `402` answer names the plan too, and wins.
 */
export const FEATURE_PLAN: Record<Feature, PlanId> = {
  apps: lowestPlan((plan) => plan.maxApps > 1, "pro"),
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

export interface FeatureCopy {
  emoji: string;
  title: string;
  text: string;
  points: string[];
}

const emojiLimit = (id: PlanId) => formatNumber(PLANS[id].limits.custom_emoji);

export const FEATURE_COPY: Record<Feature, FeatureCopy> = {
  apps: {
    emoji: "🧩",
    title: "More apps",
    text: "Your plan’s apps are all in use. Separate apps keep staging and dev traffic out of production’s usage.",
    points: [
      `${PLANS.pro.maxApps} apps on Pro, as many as you need on Scale`,
      "Own keys, usage and custom emoji per app",
      "Environment badges for prod, staging and dev",
    ],
  },
  custom_emoji: {
    emoji: "🎨",
    title: "Bring your own emoji",
    text: "Upload your team’s and your brand’s emoji. Search finds them next to the standard set, on the device and through the API.",
    points: [
      `${emojiLimit("solo")} custom emoji on Solo, ${emojiLimit("pro")} on Pro`,
      "PNG, GIF, WebP or SVG, up to 256 KB each",
      "Aliases, so “ship it” finds :shipit:",
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
    text: "Daily searches, the top queries and the searches that found nothing: your list of emoji to add next.",
    points: [
      `${PLANS.pro.analyticsRetentionDays} days of history on Pro, ${PLANS.scale.analyticsRetentionDays} on Scale`,
      "No user, IP address or message text is stored",
      "One click from a missed search to a new custom emoji",
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
