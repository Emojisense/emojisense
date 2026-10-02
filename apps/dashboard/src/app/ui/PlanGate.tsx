import { PLANS, type PlanId } from "@emojisense/platform";
import { useId } from "react";
import { formatPrice } from "../format";
import { FEATURE_COPY, FEATURE_PLAN, type Feature, planRank } from "../lib/plans";
import { useUpgrade } from "../lib/useUpgrade";
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
  const { upgrade, pending, error, waitlistPlan } = useUpgrade();
  const { detail } = useAppScope();
  const titleId = useId();
  const joined = waitlistPlan !== null && planRank(waitlistPlan) >= planRank(required.id);
  const waitlistName = waitlistPlan ? PLANS[waitlistPlan].name : required.name;
  // A team app runs on its owner's plan: only the owner can upgrade it.
  const owner =
    detail.status === "ready" && detail.data.app.role !== "owner"
      ? (detail.data.app.ownerName ?? "the owner")
      : null;

  const upgradeButton = owner ? (
    <p className="hint">
      This app runs on {owner}’s plan. Ask {owner} to upgrade to {required.name}.
    </p>
  ) : (
    <button
      type="button"
      className={compact ? "btn btn-primary btn-sm" : "btn btn-primary btn-lg btn-block"}
      disabled={pending !== null || joined}
      onClick={() => upgrade(required.id)}
    >
      {joined ? "On the waitlist" : pending ? "Joining…" : `Upgrade to ${required.name}`}
    </button>
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
          <span className="gate-compact-sub">
            {joined ? `You are on the ${waitlistName} waitlist. We will email you when it opens.` : copy.text}
          </span>
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
          {joined && !owner && (
            <p className="notice notice-success" role="status">
              You are on the {waitlistName} waitlist. We will email you when billing opens.
            </p>
          )}
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          {upgradeButton}
          <Link to="/billing" className="btn btn-ghost btn-block">
            Compare plans
          </Link>
          {!owner && (
            <p className="hint">
              Billing opens soon. Upgrading adds you to the waitlist; nothing is charged.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
