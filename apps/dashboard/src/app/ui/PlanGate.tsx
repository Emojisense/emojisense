import { isPaidPlan, PLANS, type PlanId } from "@emojisense/platform";
import { useId } from "react";
import { formatPrice } from "../format";
import { checkoutIntentQuery } from "../lib/checkoutIntent";
import { FEATURE_COPY, FEATURE_PLAN, type Feature } from "../lib/plans";
import { Link } from "../router";
import { useAppScope } from "../shell/context";
import { Icon } from "./Icon";

interface PlanGateProps {
  feature: Feature;
  /** The plan named by the API's 402 answer; defaults to the lowest plan with the feature. */
  plan?: PlanId;
  compact?: boolean;
}

/** Shown when a feature needs a higher plan: a calm invitation that names the plan, never an error. */
export function PlanGate({ feature, plan, compact = false }: PlanGateProps) {
  const required = PLANS[plan ?? FEATURE_PLAN[feature]];
  const copy = FEATURE_COPY[feature];
  const { detail } = useAppScope();
  const titleId = useId();
  // A team app runs on its owner's plan: only the owner can upgrade it.
  const owner =
    detail.status === "ready" && detail.data.app.role !== "owner"
      ? (detail.data.app.ownerName ?? "the owner")
      : null;
  // Billing shows the price and the interval and starts Whop's checkout.
  const upgradeHref = isPaidPlan(required.id)
    ? `/billing?${checkoutIntentQuery({ plan: required.id, interval: "month" })}`
    : "/billing";

  const upgradeButton = owner ? (
    <p className="hint">
      This app runs on {owner}’s plan. Ask {owner} to upgrade to {required.name}.
    </p>
  ) : (
    <Link
      to={upgradeHref}
      className={compact ? "btn btn-primary btn-sm" : "btn btn-primary btn-lg btn-block"}
    >
      Upgrade to {required.name}
    </Link>
  );

  if (compact) {
    return (
      <section className="gate-compact" aria-labelledby={titleId}>
        <span className="gate-emoji emoji" aria-hidden="true">
          {copy.emoji}
        </span>
        <div className="gate-compact-text">
          <strong id={titleId}>
            {copy.title} with {required.name}
          </strong>
          <span className="gate-compact-sub">{copy.text}</span>
        </div>
        {upgradeButton}
      </section>
    );
  }

  return (
    <section className="gate" aria-labelledby={titleId}>
      <div className="gate-main">
        <span className="gate-emoji emoji" aria-hidden="true">
          {copy.emoji}
        </span>
        <p className="section-label">Available on {required.name} and up</p>
        <h2 id={titleId} className="gate-title">
          {copy.title}
        </h2>
        <p className="gate-text">{copy.text}</p>
        <ul className="gate-list">
          {copy.points.map((point) => (
            <li key={point}>
              <Icon name="check" />
              {point}
            </li>
          ))}
        </ul>
      </div>
      <div className="gate-side">
        <div className="gate-price">
          <span className="section-label">{required.name} plan</span>
          <p>
            <strong>{formatPrice(required.priceUsdMonthly)}</strong> <span className="muted">per month</span>
          </p>
        </div>
        <div className="gate-actions">
          {upgradeButton}
          <Link to="/billing" className="btn btn-ghost btn-block">
            Compare plans
          </Link>
          {!owner && <p className="hint">Paid through Whop. Cancel at any time.</p>}
        </div>
      </div>
    </section>
  );
}
