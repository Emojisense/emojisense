import { PAST_DUE_GRACE_DAYS, PLAN_IDS, PLANS, type Plan, type PlanId } from "@emojisense/platform";
import { formatCount, formatUsd } from "../../lib/format";

export interface PricingFaq {
  q: string;
  a: string;
  link?: { href: string; label: string };
}

/** Pricing questions. Every number is read from PLANS, so the answers follow the plans. */
export function pricingFaqs(plans: Record<PlanId, Plan> = PLANS): PricingFaq[] {
  const free = plans.free;
  const yearly = PLAN_IDS.map((id) => plans[id]).filter((plan) => plan.priceUsdYearly !== undefined);
  const yearlyAnswer =
    yearly.length === 0
      ? "Not yet. Every plan bills monthly for now."
      : `${yearly
          .map(
            (plan) =>
              `${plan.name} costs ${formatUsd(plan.priceUsdYearly ?? 0)} a year instead of ${formatUsd(plan.priceUsdMonthly * 12)}`,
          )
          .join("; ")}. The other plans bill monthly.`;

  return [
    {
      q: "Is the free plan really free?",
      a: `Yes, and you need no card. It includes ${formatCount(free.limits.semantic_calls)} AI calls and ${formatCount(free.limits.image_classifications)} photo classifications a month, every SDK and integration, and unlimited on-device answers. There is no “powered by” badge on any plan.`,
    },
    {
      q: "What counts as a call?",
      a: "A meaning search or a reaction suggestion that reaches our edge API. Answers from the device and ready-made answers for popular searches are free and unlimited. Photo to emoji has its own monthly count.",
      link: { href: "#calls", label: "See how a search is answered" },
    },
    {
      q: "What happens when I reach a limit?",
      a: "Nothing breaks for your users. The API keeps answering with overLimit: true, and the SDK switches to the on-device dictionary and ready-made answers on its own. Cached answers are still served. New AI calls and photos resume on the 1st of the next month.",
    },
    {
      q: "Do you count requests that fail?",
      a: "No. If our AI cannot answer, your users still get results from the dictionary, and the request is not counted.",
    },
    {
      q: "When do limits reset?",
      a: "On the first day of each month, UTC. There are no daily caps.",
    },
    {
      q: "Is there a yearly price?",
      a: yearlyAnswer,
    },
    {
      q: "How does billing work?",
      a: "Choose a plan on this page, then sign in to the dashboard and pay on Whop's checkout. Whop is our payment provider: it takes the card or another local payment method and sends the receipts. The plan changes for all your apps as soon as the payment goes through.",
    },
    {
      q: "Can I cancel or change my plan?",
      a: "Yes, at any time. In the dashboard, Billing → Manage subscription opens Whop, where you cancel. You keep the plan until the end of the period you paid for; then the account moves to Free, and your apps keep working within the Free limits. To change plans, choose another one on the Billing page: the new plan starts when it is paid, and the old one stops renewing. Whop does not prorate.",
    },
    {
      q: "What if a payment fails?",
      a: `Whop tries the charge again and emails you. Your plan keeps working for ${PAST_DUE_GRACE_DAYS} days. Update the payment method in Billing → Manage subscription; if no payment goes through by then, the account moves to Free.`,
    },
    {
      q: "Do you give refunds?",
      a: "[Refund policy: to be decided before launch.] Until it is published, write to [support email] about any payment.",
    },
    {
      q: "Can I self-host instead?",
      a: "Yes. The engine, SDKs, data pack, API server and dashboard are MIT. Run them on your own Cloudflare account and pay Cloudflare directly. The open data pack is updated every quarter; hosted plans get daily dictionary updates.",
      link: { href: "/docs/self-host/", label: "Read the self-host guide" },
    },
    {
      q: "What do you store about my users?",
      a: "Nothing personal. We never store who searched, IP addresses, message text or images. Photos are processed in memory.",
      link: { href: "/docs/privacy/", label: "Read the privacy notes" },
    },
  ];
}
