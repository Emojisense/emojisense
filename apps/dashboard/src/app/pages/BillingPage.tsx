import { PLAN_IDS, PLANS, type Plan, type PlanId } from "@emojisense/platform";
import { useId } from "react";
import { api, type BillingResponse } from "../api";
import { formatCompact, formatPeriod, formatPrice } from "../format";
import { planRank } from "../lib/plans";
import { useResource } from "../lib/useResource";
import { useUpgrade } from "../lib/useUpgrade";
import { useSession } from "../session";
import { ErrorState, LoadingState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { UsageMeter } from "../ui/UsageMeter";

const count = (value: number, unit: string) =>
  Number.isFinite(value) ? `${formatCompact(value)} ${unit}` : `Unlimited ${unit}`;

function planFeatures(plan: Plan): { text: string; included: boolean }[] {
  return [
    { text: `${count(plan.limits.semantic_calls, "semantic calls")} a month`, included: true },
    { text: `${count(plan.limits.image_classifications, "photo to emoji calls")} a month`, included: true },
    {
      text: plan.limits.custom_emoji > 0 ? count(plan.limits.custom_emoji, "custom emoji") : "Custom emoji",
      included: plan.limits.custom_emoji > 0,
    },
    {
      text: Number.isFinite(plan.maxApps)
        ? count(plan.maxApps, plan.maxApps === 1 ? "app" : "apps")
        : "Unlimited apps",
      included: true,
    },
    { text: "Hosted emoji sets", included: plan.hostedEmojiSets },
    {
      text:
        plan.analyticsRetentionDays > 0
          ? `${plan.analyticsRetentionDays} days of analytics`
          : "Search analytics",
      included: plan.analyticsRetentionDays > 0,
    },
    { text: "Team members and roles", included: plan.teamMembers },
    { text: "Tenants and webhooks", included: plan.tenants },
  ];
}

export function BillingPage() {
  const { me } = useSession();
  const [billing, { reload }] = useResource<BillingResponse>("billing", () => api.billing());
  const current = PLANS[billing.status === "ready" ? billing.data.plan.id : me.plan.id];
  const apps = billing.status === "ready" ? billing.data : null;

  return (
    <>
      <PageHeader title="Billing" lede="Your plan, this month’s usage, and every plan side by side." />
      <div className="stack-lg">
        <p className="notice">
          <span className="emoji" aria-hidden="true">
            🧾
          </span>
          <span>
            <strong>Billing opens soon.</strong> Upgrading puts you on the waitlist for that plan. Nothing is
            charged, and we email you before anything changes.
          </span>
        </p>

        <section className="card bill-current" aria-label="Current plan">
          <div className="bill-plan">
            <p className="section-label">Current plan</p>
            <p className="bill-plan-name">{current.name}</p>
            <p className="bill-plan-price">
              {formatPrice(current.priceUsdMonthly)} <span className="muted">per month</span>
            </p>
            {apps && (
              <p className="hint">
                {apps.limits.apps === null
                  ? `${apps.appCount} app${apps.appCount === 1 ? "" : "s"}`
                  : `${apps.appCount} of ${apps.limits.apps} apps`}{" "}
                · usage for {formatPeriod(apps.period)} (UTC)
              </p>
            )}
          </div>
          <div className="bill-usage">
            {billing.status === "loading" && <LoadingState label="Loading usage…" rows={3} />}
            {billing.status === "error" && <ErrorState message={billing.message} onRetry={reload} />}
            {billing.status === "ready" &&
              billing.data.usage.map((usage) => (
                <UsageMeter key={usage.metric} usage={usage} planName={current.name} compact />
              ))}
          </div>
        </section>

        <ul className="plan-grid" aria-label="Plans">
          {PLAN_IDS.map((id) => (
            <PlanCard key={id} planId={id} currentId={current.id} />
          ))}
        </ul>
        <p className="hint">
          Limits count per account and calendar month (UTC). Over a limit, search keeps working on the device.
        </p>
      </div>
    </>
  );
}

function PlanCard({ planId, currentId }: { planId: PlanId; currentId: PlanId }) {
  const plan = PLANS[planId];
  const { upgrade, pending, waitlistPlan } = useUpgrade();
  const headingId = useId();
  const isCurrent = planId === currentId;
  const higher = planRank(planId) > planRank(currentId);
  const joined = waitlistPlan === planId;

  return (
    <li className="plan-card" data-current={isCurrent || undefined} aria-labelledby={headingId}>
      <div className="plan-card-head">
        <h2 id={headingId} className="plan-card-name">
          {plan.name}
        </h2>
        {isCurrent && <span className="badge badge-solid">Current</span>}
        {joined && <span className="badge">On the waitlist</span>}
      </div>
      <p className="plan-card-price">
        <strong>{formatPrice(plan.priceUsdMonthly)}</strong>
        <span className="muted"> / month</span>
      </p>
      <p className="hint plan-card-note">
        {plan.priceUsdYearly
          ? `or ${formatPrice(plan.priceUsdYearly)} a year`
          : planId === "free"
            ? "No card needed"
            : "Billed monthly"}
      </p>
      <ul className="plan-features">
        {planFeatures(plan).map((feature) => (
          <li key={feature.text} data-included={feature.included || undefined}>
            <Icon name={feature.included ? "check" : "close"} />
            <span>
              {feature.text}
              {!feature.included && <span className="visually-hidden"> (not included)</span>}
            </span>
          </li>
        ))}
      </ul>
      {(isCurrent || higher) && (
        <div className="plan-card-action">
          {isCurrent ? (
            <button type="button" className="btn btn-block" disabled>
              Your plan
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={joined || pending !== null}
              onClick={() => upgrade(planId)}
            >
              {joined ? "On the waitlist" : pending === planId ? "Joining…" : `Upgrade to ${plan.name}`}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
