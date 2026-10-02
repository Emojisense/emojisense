import { PAST_DUE_GRACE_DAYS, PLAN_IDS, PLANS, type Plan, type PlanId } from "@emojisense/platform";
import type { Messages } from "../../i18n/catalogs";
import en from "../../i18n/en.json";
import { formatCountIn, formatUsdIn } from "../../i18n/format";
import { createTranslator } from "../../i18n/translate";

export interface PricingFaq {
  q: string;
  a: string;
  link?: { href: string; label: string; hreflang?: string };
}

export interface FaqLocale {
  /** Intl tag. */
  tag: string;
  /** The catalog's `pricing.faq.items` and `plans.unlimited`. */
  items: Messages["pricing"]["faq"]["items"];
  unlimited: string;
  /** True when the docs links lead to a page in another language (English). */
  docsInEnglish: boolean;
}

const ENGLISH: FaqLocale = {
  tag: "en",
  items: en.pricing.faq.items,
  unlimited: en.plans.unlimited,
  docsInEnglish: false,
};

/** Pricing questions. Every number is read from PLANS, so the answers follow the plans. */
export function pricingFaqs(plans: Record<PlanId, Plan> = PLANS, page: FaqLocale = ENGLISH): PricingFaq[] {
  const { t } = createTranslator(page.items, page.tag);
  const usd = (value: number) => formatUsdIn(page.tag, value);
  const count = (value: number) => formatCountIn(page.tag, value, page.unlimited);
  const docs = (href: string, label: string) => ({ href, label, ...(page.docsInEnglish ? { hreflang: "en" } : {}) });
  const free = plans.free;
  const yearly = PLAN_IDS.map((id) => plans[id]).filter((plan) => plan.priceUsdYearly !== undefined);
  const yearlyAnswer =
    yearly.length === 0
      ? t("yearly.none")
      : t("yearly.a", {
          items: yearly
            .map((plan) =>
              t("yearly.item", {
                plan: plan.name,
                yearly: usd(plan.priceUsdYearly ?? 0),
                monthly: usd(plan.priceUsdMonthly * 12),
              }),
            )
            .join("; "),
        });

  return [
    {
      q: t("free.q"),
      a: t("free.a", {
        calls: count(free.limits.semantic_calls),
        photos: count(free.limits.image_classifications),
      }),
    },
    {
      q: t("call.q"),
      a: t("call.a"),
      link: { href: "#calls", label: t("call.link") },
    },
    { q: t("limit.q"), a: t("limit.a") },
    { q: t("failed.q"), a: t("failed.a") },
    { q: t("reset.q"), a: t("reset.a") },
    { q: t("yearly.q"), a: yearlyAnswer },
    { q: t("billing.q"), a: t("billing.a") },
    { q: t("cancel.q"), a: t("cancel.a") },
    {
      q: t("paymentFailed.q"),
      a: t("paymentFailed.a", { days: new Intl.NumberFormat(page.tag).format(PAST_DUE_GRACE_DAYS) }),
    },
    { q: t("refunds.q"), a: t("refunds.a") },
    {
      q: t("selfHost.q"),
      a: t("selfHost.a"),
      link: docs("/docs/self-host/", t("selfHost.link")),
    },
    {
      q: t("store.q"),
      a: t("store.a"),
      link: docs("/docs/privacy/", t("store.link")),
    },
  ];
}
