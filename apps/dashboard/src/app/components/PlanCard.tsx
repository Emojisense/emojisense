import { getPlan, METRICS, PLAN_IDS, PLANS } from "@emojisense/platform";
import { type FormEvent, useId, useState } from "react";
import { ApiError, api, errorMessage } from "../api";
import { formatNumber, formatPrice, METRIC_COPY } from "../format";
import { useSession } from "../session";
import { PlanPill } from "./Pills";

function limitText(limit: number | null): string {
  if (limit === null) return "Unlimited";
  if (limit === 0) return "Not included";
  return `${formatNumber(limit)} / mo`;
}

export function PlanCard() {
  const { me } = useSession();
  const { plan } = me;
  const headingId = useId();
  const belowPro = PLAN_IDS.indexOf(plan.id) < PLAN_IDS.indexOf("pro");

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <h2 id={headingId} className="section-title">
          Your plan
        </h2>
        <PlanPill name={plan.name} />
      </div>
      <div className="card-body">
        <p className="plan-price">
          {formatPrice(plan.priceUsdMonthly)} <span>per month</span>
        </p>
        <dl className="limits">
          {METRICS.map((metric) => (
            <div key={metric}>
              <dt>{METRIC_COPY[metric].label}</dt>
              <dd>{limitText(plan.limits[metric])}</dd>
            </div>
          ))}
          <div>
            <dt>Apps</dt>
            <dd>
              {me.appCount} of {plan.maxApps ?? "unlimited"}
            </dd>
          </div>
        </dl>
        <p className="hint">Limits count per app and per calendar month (UTC).</p>
        {belowPro && <ProWaitlist />}
      </div>
    </section>
  );
}

function ProWaitlist() {
  const { me, update } = useSession();
  const pro = PLANS.pro;
  const [email, setEmail] = useState(me.account.email ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const emailId = useId();
  const errorId = useId();
  const joined = me.waitlistPlan ? getPlan(me.waitlistPlan).name : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const result = await api.joinWaitlist(email, "pro");
      update((current) => ({ ...current, waitlistPlan: result.plan }));
    } catch (caught) {
      setError({
        message: errorMessage(caught),
        field: caught instanceof ApiError ? caught.field : undefined,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="upsell">
      <h3 className="section-title">Need more room?</h3>
      <p className="hint">
        Pro: {formatNumber(pro.limits.semantic_calls)} semantic calls,{" "}
        {formatNumber(pro.limits.image_classifications)} image classifications,{" "}
        {formatNumber(pro.limits.custom_emoji)} custom emoji and {pro.maxApps} apps, for $
        {pro.priceUsdMonthly} per month.
      </p>
      {/* Stays mounted so screen readers announce the confirmation. */}
      <p role="status" className={joined ? "notice notice-success" : undefined}>
        {joined ? `You are on the ${joined} waitlist. We will email you when it opens. 🎉` : ""}
      </p>
      {!joined && (
        <form className="form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={emailId}>Email for the waitlist</label>
            <input
              id={emailId}
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={error?.field === "email"}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          {error && (
            <p id={errorId} className="notice notice-error" role="alert">
              {error.message}
            </p>
          )}
          <button type="submit" className="button button-primary" disabled={sending}>
            {sending ? "Joining…" : "Join the Pro waitlist"}
          </button>
        </form>
      )}
    </div>
  );
}
