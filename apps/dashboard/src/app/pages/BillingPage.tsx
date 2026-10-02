import {
  type BillingInterval,
  billingIntervalsOf,
  isPaidPlan,
  type PaidPlanId,
  PLAN_IDS,
  PLANS,
  type Plan,
  type PlanId,
} from "@emojisense/platform";
import { type ReactNode, useEffect, useId, useState } from "react";
import { api, type BillingResponse, type BillingSubscription } from "../api";
import { formatCompact, formatDate, formatPeriod, formatPrice } from "../format";
import { forgetCheckoutIntent, parseCheckoutIntent } from "../lib/checkoutIntent";
import { planRank } from "../lib/plans";
import { checkoutKey, forgetStartedCheckout, startedCheckout, useCheckout } from "../lib/useCheckout";
import { useResource } from "../lib/useResource";
import { navigate, useSearchParams } from "../router";
import { useSession } from "../session";
import { ErrorState, LoadingState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
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

/** Statuses in which the account pays through Whop. */
const PAYING = new Set(["active", "canceling", "past_due"]);

/** The interval a plan card offers: yearly only where the plan is sold yearly. */
function cardInterval(plan: PlanId, chosen: BillingInterval): BillingInterval {
  return billingIntervalsOf(plan).includes(chosen) ? chosen : "month";
}

const YEARLY_PLANS = PLAN_IDS.filter((id) => billingIntervalsOf(id).includes("year"));

function yearlySavingPercent(): number {
  const savings = YEARLY_PLANS.map((id) => {
    const plan = PLANS[id];
    return 1 - (plan.priceUsdYearly ?? 0) / (plan.priceUsdMonthly * 12);
  });
  return Math.round(Math.max(0, ...savings) * 100);
}

const POLL_MS = 3000;
const POLL_TRIES = 20;

type Confirmation = "waiting" | "confirmed" | "late";

/**
 * After Whop's checkout the plan changes when Whop's webhook arrives, usually within seconds. The
 * page asks again every 3 seconds for a minute, then refreshes the session so gates open.
 */
function useCheckoutConfirmation(
  active: boolean,
  billing: BillingResponse | null,
  reload: () => void,
  refresh: () => Promise<void>,
): Confirmation | null {
  const [tries, setTries] = useState(0);
  const [state, setState] = useState<Confirmation | null>(active ? "waiting" : null);
  const started = startedCheckout();

  const done =
    billing !== null &&
    billing.subscription.status === "active" &&
    (!started ||
      (billing.plan.id === started.plan && (billing.subscription.interval ?? "month") === started.interval));

  useEffect(() => {
    if (!active || state !== "waiting" || billing === null) return;
    if (done) {
      setState("confirmed");
      forgetStartedCheckout();
      void refresh();
      return;
    }
    if (tries >= POLL_TRIES) {
      setState("late");
      return;
    }
    const timer = setTimeout(() => {
      setTries((n) => n + 1);
      reload();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [active, state, billing, done, tries, reload, refresh]);

  // Kept after ?checkout=success leaves the address bar, so the confirmation stays on screen.
  return state;
}

function Banner({
  emoji,
  tone,
  children,
}: {
  emoji: string;
  tone?: "success" | "warning";
  children: ReactNode;
}) {
  return (
    <p className={tone ? `notice notice-${tone}` : "notice"} role="status">
      <span className="emoji" aria-hidden="true">
        {emoji}
      </span>
      <span>{children}</span>
    </p>
  );
}

function ManageLink({ url, children = "Manage subscription" }: { url: string; children?: ReactNode }) {
  return (
    <a className="btn btn-sm" href={url} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="visually-hidden"> (opens Whop in a new tab)</span>
    </a>
  );
}

function StatusBanners({
  plan,
  subscription,
  provider,
  confirmation,
}: {
  plan: Plan;
  subscription: BillingSubscription;
  provider: BillingResponse["provider"];
  confirmation: Confirmation | null;
}) {
  const banners: ReactNode[] = [];
  if (confirmation === "waiting") {
    banners.push(
      <Banner key="waiting" emoji="⏳">
        <strong>Thank you!</strong> Whop is confirming the payment. Your plan changes here in a moment.
      </Banner>,
    );
  } else if (confirmation === "confirmed") {
    banners.push(
      <Banner key="confirmed" emoji="🎉" tone="success">
        <strong>You are on {plan.name} now.</strong> Its limits and features work for all your apps.
      </Banner>,
    );
  } else if (confirmation === "late") {
    banners.push(
      <Banner key="late" emoji="🕰️">
        <strong>Whop has not confirmed the payment yet.</strong> Your plan changes when it does. Reload this
        page in a few minutes.
      </Banner>,
    );
  }
  if (subscription.status === "past_due") {
    banners.push(
      <Banner key="past_due" emoji="💳" tone="warning">
        <strong>The last payment failed.</strong> Update the payment method in Whop
        {subscription.graceUntil ? ` by ${formatDate(subscription.graceUntil)}` : ""}, or the account moves to
        Free then.
      </Banner>,
    );
  } else if (subscription.status === "canceling") {
    banners.push(
      <Banner key="canceling" emoji="🗓️">
        <strong>Your {plan.name} plan is cancelled.</strong> It stays active
        {subscription.currentPeriodEnd
          ? ` until ${formatDate(subscription.currentPeriodEnd)}`
          : " until the period ends"}
        , then the account moves to Free. To keep it, resume it in Manage subscription.
      </Banner>,
    );
  } else if (subscription.status === "canceled" && plan.id === "free" && confirmation === null) {
    banners.push(
      <Banner key="canceled" emoji="👋">
        <strong>Your subscription ended</strong>
        {subscription.currentPeriodEnd ? ` on ${formatDate(subscription.currentPeriodEnd)}` : ""}. The account
        is on Free. Choose a plan below to subscribe again.
      </Banner>,
    );
  }
  if (provider === null) {
    banners.push(
      <Banner key="unconfigured" emoji="🧾">
        Payments are not set up on this server, so plans cannot be bought here.
      </Banner>,
    );
  }
  return banners.length > 0 ? <div className="bill-banners">{banners}</div> : null;
}

function subscriptionLine(subscription: BillingSubscription | null, plan: Plan): string {
  if (plan.id === "free" || !subscription) return "No card needed";
  const billed = subscription.interval === "year" ? "Billed yearly" : "Billed monthly";
  const end = subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : null;
  switch (subscription.status) {
    case "active":
      return end ? `${billed} · renews on ${end}` : billed;
    case "canceling":
      return end ? `Cancelled · ends on ${end}` : "Cancelled";
    case "past_due":
      return "Payment failed";
    default:
      return billed;
  }
}

export function BillingPage() {
  const { me, refresh } = useSession();
  const params = useSearchParams();
  const intent = parseCheckoutIntent(params);
  // Whop may add `status` to the return URL; a failed or cancelled payment changes nothing.
  const whopStatus = params.get("status");
  const stopped = whopStatus === "failed" || whopStatus === "canceled";
  const returning = params.get("checkout") === "success" && !stopped;
  const [billing, { reload }] = useResource<BillingResponse>("billing", () => api.billing());
  const data = billing.status === "ready" ? billing.data : null;
  const current = PLANS[data?.plan.id ?? me.plan.id];
  const subscription = data?.subscription ?? null;
  const [interval, chooseInterval] = useState<BillingInterval>(
    intent?.interval ?? subscription?.interval ?? "month",
  );
  const checkout = useCheckout();
  const confirmation = useCheckoutConfirmation(returning, data, reload, refresh);
  const savings = yearlySavingPercent();

  // Signed in: the pick is in the URL now, so the stored one is done.
  useEffect(() => {
    forgetCheckoutIntent();
  }, []);

  useEffect(() => {
    if (subscription?.interval && !intent) chooseInterval(subscription.interval);
  }, [subscription?.interval, intent]);

  // Once the plan is confirmed, the address bar loses ?checkout=success, so a reload is calm.
  useEffect(() => {
    if (confirmation === "confirmed") navigate("/billing", { replace: true });
  }, [confirmation]);

  return (
    <>
      <PageHeader title="Billing" lede="Your plan, this month’s usage, and every plan side by side." />
      <div className="stack-lg">
        {data && (
          <StatusBanners
            plan={current}
            subscription={data.subscription}
            provider={data.provider}
            confirmation={confirmation}
          />
        )}
        {params.get("checkout") === "success" && stopped && (
          <Banner emoji="↩️">
            <strong>The payment did not go through,</strong> so nothing changed. You can try again below.
          </Banner>
        )}
        {intent && intent.plan !== current.id && confirmation === null && (
          <Banner emoji="🛒">
            You picked <strong>{PLANS[intent.plan].name}</strong>, billed{" "}
            {intent.interval === "year" ? "yearly" : "monthly"}. Select “
            {actionLabel(intent.plan, intent.interval, current.id, subscription)}” to go to checkout.
          </Banner>
        )}

        <section className="card bill-current" aria-label="Current plan">
          <div className="bill-plan">
            <p className="section-label">Current plan</p>
            <p className="bill-plan-name">{current.name}</p>
            <p className="bill-plan-price">
              {subscription?.interval === "year" && current.priceUsdYearly ? (
                <>
                  {formatPrice(current.priceUsdYearly)} <span className="muted">per year</span>
                </>
              ) : (
                <>
                  {formatPrice(current.priceUsdMonthly)} <span className="muted">per month</span>
                </>
              )}
            </p>
            <p className="hint">{subscriptionLine(subscription, current)}</p>
            {data && (
              <p className="hint">
                {data.limits.apps === null
                  ? `${data.appCount} app${data.appCount === 1 ? "" : "s"}`
                  : `${data.appCount} of ${data.limits.apps} apps`}{" "}
                · usage for {formatPeriod(data.period)} (UTC)
              </p>
            )}
            {subscription?.manageUrl && (
              <div className="bill-manage">
                <ManageLink url={subscription.manageUrl} />
              </div>
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

        {YEARLY_PLANS.length > 0 && (
          <div className="bill-interval">
            <Segmented
              label="Billing period"
              value={interval}
              options={[
                { value: "month", label: "Monthly" },
                { value: "year", label: savings > 0 ? `Yearly · save ${savings}%` : "Yearly" },
              ]}
              onChange={chooseInterval}
            />
            <p className="hint">
              Yearly billing is for {YEARLY_PLANS.map((id) => PLANS[id].name).join(" and ")}. Other plans bill
              monthly.
            </p>
          </div>
        )}

        <ul className="plan-grid" aria-label="Plans">
          {PLAN_IDS.map((id) => (
            <PlanCard
              key={id}
              planId={id}
              currentId={current.id}
              interval={cardInterval(id, interval)}
              billing={data}
              picked={intent?.plan === id}
              checkout={checkout}
            />
          ))}
        </ul>
        <p className="hint">
          Payments, invoices and cancellation run on Whop. Limits count per account and calendar month (UTC).
          Over a limit, search keeps working on the device.
        </p>
      </div>
    </>
  );
}

/** The button text for buying `plan` billed `interval`, seen from the current plan. */
function actionLabel(
  plan: PaidPlanId,
  interval: BillingInterval,
  currentId: PlanId,
  subscription: BillingSubscription | null,
): string {
  const name = PLANS[plan].name;
  if (plan === currentId && subscription && PAYING.has(subscription.status)) {
    return interval === "year" ? "Switch to yearly" : "Switch to monthly";
  }
  return planRank(plan) > planRank(currentId) ? `Upgrade to ${name}` : `Switch to ${name}`;
}

interface PlanCardProps {
  planId: PlanId;
  currentId: PlanId;
  interval: BillingInterval;
  billing: BillingResponse | null;
  picked: boolean;
  checkout: ReturnType<typeof useCheckout>;
}

function PlanCard({ planId, currentId, interval, billing, picked, checkout }: PlanCardProps) {
  const plan = PLANS[planId];
  const headingId = useId();
  const noteId = useId();
  const subscription = billing?.subscription ?? null;
  const paying = subscription !== null && PAYING.has(subscription.status);
  // A plan given by hand (no subscription) is current at any interval.
  const isCurrent = planId === currentId && (!paying || (subscription?.interval ?? "month") === interval);
  const yearly = interval === "year" && plan.priceUsdYearly !== undefined;

  return (
    <li
      className="plan-card"
      data-current={isCurrent || undefined}
      data-picked={(picked && !isCurrent) || undefined}
      aria-labelledby={headingId}
    >
      <div className="plan-card-head">
        <h2 id={headingId} className="plan-card-name">
          {plan.name}
        </h2>
        {isCurrent && <span className="badge badge-solid">Current</span>}
        {picked && !isCurrent && <span className="badge">Your pick</span>}
      </div>
      <p className="plan-card-price">
        <strong>{formatPrice(yearly ? (plan.priceUsdYearly ?? 0) : plan.priceUsdMonthly)}</strong>
        <span className="muted"> / {yearly ? "year" : "month"}</span>
      </p>
      <p className="hint plan-card-note">
        {yearly
          ? `${formatPrice(Math.round(((plan.priceUsdYearly ?? 0) / 12) * 100) / 100)} a month, billed yearly`
          : plan.priceUsdYearly
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
      <div className="plan-card-action">
        <PlanAction
          planId={planId}
          currentId={currentId}
          interval={interval}
          isCurrent={isCurrent}
          billing={billing}
          checkout={checkout}
          noteId={noteId}
        />
      </div>
    </li>
  );
}

function PlanAction({
  planId,
  currentId,
  interval,
  isCurrent,
  billing,
  checkout,
  noteId,
}: {
  planId: PlanId;
  currentId: PlanId;
  interval: BillingInterval;
  isCurrent: boolean;
  billing: BillingResponse | null;
  checkout: ReturnType<typeof useCheckout>;
  noteId: string;
}) {
  const subscription = billing?.subscription ?? null;
  const paying = subscription !== null && PAYING.has(subscription.status);

  if (isCurrent) {
    return (
      <button type="button" className="btn btn-block" disabled>
        Your plan
      </button>
    );
  }

  if (!isPaidPlan(planId)) {
    // Down to Free: cancel the subscription in Whop; the plan stays until the period ends.
    if (subscription?.status === "canceling") {
      return (
        <p className="hint plan-card-lower">
          {subscription.currentPeriodEnd
            ? `Moves to Free on ${formatDate(subscription.currentPeriodEnd)}`
            : "Moves to Free when the period ends"}
        </p>
      );
    }
    if (paying && subscription?.manageUrl) {
      return (
        <>
          <a
            className="btn btn-block"
            href={subscription.manageUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={noteId}
          >
            Cancel in Whop
            <span className="visually-hidden"> (opens Whop in a new tab)</span>
          </a>
          <p id={noteId} className="hint plan-card-lower">
            You keep {PLANS[currentId].name} until the paid period ends.
          </p>
        </>
      );
    }
    return null;
  }

  const key = checkoutKey(planId, interval);
  const forSale = billing?.purchasable[planId]?.includes(interval) ?? false;
  const busy = checkout.pending !== null;
  const error = checkout.error?.key === key ? checkout.error.message : null;
  const label = actionLabel(planId, interval, currentId, subscription);
  const switching = paying && subscription !== null;

  return (
    <>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={planRank(planId) > planRank(currentId) ? "btn btn-primary btn-block" : "btn btn-block"}
        disabled={!forSale || busy}
        aria-describedby={switching ? noteId : undefined}
        onClick={() => void checkout.start(planId, interval)}
      >
        {checkout.pending === key ? "Opening checkout…" : label}
      </button>
      {switching && (
        <p id={noteId} className="hint plan-card-lower">
          Your {PLANS[currentId].name} subscription stops renewing when this one starts. Whop does not
          prorate.
        </p>
      )}
      {billing !== null && billing.provider !== null && !forSale && (
        <p className="hint plan-card-lower">Not for sale yet.</p>
      )}
    </>
  );
}
