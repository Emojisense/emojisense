import { PLAN_IDS, PLANS, type Plan, type PlanId } from "@emojisense/platform";
import { formatCount, formatDays, formatUsd } from "./format";

export interface PlanFeature {
  key: string;
  label: string;
  /** `true`/`false` render as a check or a dash; strings render as text. */
  value: string | boolean;
  /** The number from PLANS, kept for the build smoke test. */
  raw?: number;
}

export interface PlanView {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  monthly: string;
  yearly?: { price: string; savings: string; raw: number };
  features: PlanFeature[];
  cta: { label: string; href: string };
}

/** Free uses the dashboard; paid plans are not on sale yet, so they lead to the waitlist. */
function ctaFor(id: PlanId, dashboardUrl: string): PlanView["cta"] {
  if (id === "free") return { label: "Get a free key", href: `${dashboardUrl}/` };
  if (id === "pro") return { label: "Join the Pro waitlist", href: `/waitlist/?plan=${id}` };
  return { label: "Join the waitlist", href: `/waitlist/?plan=${id}` };
}

function limit(value: number): Pick<PlanFeature, "value" | "raw"> {
  return value === 0 ? { value: false, raw: 0 } : { value: formatCount(value), raw: value };
}

export function featuresOf(plan: Plan): PlanFeature[] {
  return [
    // Policy, not a limit: search is free on every plan (docs/PRICING.md).
    { key: "search", label: "Semantic search and reaction suggestions", value: true },
    { key: "semantic_calls", label: "Worker calls a month", ...limit(plan.limits.semantic_calls) },
    {
      key: "image_classifications",
      label: "Photo to emoji a month",
      ...limit(plan.limits.image_classifications),
    },
    { key: "custom_emoji", label: "Custom emoji", ...limit(plan.limits.custom_emoji) },
    { key: "hosted_sets", label: "Hosted emoji sets", value: plan.hostedEmojiSets },
    {
      key: "analytics",
      label: "Analytics history",
      ...(plan.analyticsRetentionDays > 0
        ? { value: formatDays(plan.analyticsRetentionDays), raw: plan.analyticsRetentionDays }
        : { value: false, raw: 0 }),
    },
    {
      key: "apps",
      label: "Apps",
      value: formatCount(plan.maxApps),
      ...(Number.isFinite(plan.maxApps) ? { raw: plan.maxApps } : {}),
    },
    { key: "team", label: "Team members", value: plan.teamMembers },
    { key: "tenants", label: "Tenants", value: plan.tenants },
  ];
}

export function planViews(dashboardUrl: string, plans: Record<PlanId, Plan> = PLANS): PlanView[] {
  return PLAN_IDS.map((id) => {
    const plan = plans[id];
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
          }),
      features: featuresOf(plan),
      cta: ctaFor(id, dashboardUrl),
    };
  });
}
