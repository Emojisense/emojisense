import { PLANS } from "@emojisense/platform";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { browser } from "../../src/app/lib/useCheckout";
import { toPlanSummary } from "../../src/worker/plans";
import { APP, billing, me, stubApi, unauthorized } from "./fake-api";

const WHOP_URL = "https://whop.com/checkout/ch_test/";

let assign: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sessionStorage.clear();
  assign = vi.spyOn(browser, "assign").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function openBilling(path: string, routes: Parameters<typeof stubApi>[0]) {
  window.history.replaceState(null, "", path);
  const api = stubApi({
    "GET /api/me": { body: me() },
    "GET /api/apps": { body: { apps: [APP] } },
    ...routes,
  });
  render(<App />);
  return api;
}

const card = (name: string) => screen.getByRole("listitem", { name });

/** The plan cards render at once; their buttons work when GET /api/billing has answered. */
const loaded = () => screen.findByText(/usage for October 2026/);

describe("Billing page: buying a plan", () => {
  it("Upgrade starts Whop's checkout for the plan and goes there", async () => {
    const { calls } = openBilling("/billing", {
      "GET /api/billing": { body: billing("free") },
      "POST /api/billing/checkout": { body: { url: WHOP_URL } },
    });
    await loaded();
    expect(within(card("Free")).getByRole("button", { name: "Your plan" })).toBeTruthy();

    fireEvent.click(within(card("Pro")).getByRole("button", { name: "Upgrade to Pro" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(WHOP_URL));
    expect(calls).toContainEqual({
      method: "POST",
      path: "/api/billing/checkout",
      body: { plan: "pro", interval: "month" },
    });
    expect(sessionStorage.getItem("emojisense:checkout-started")).toBe('{"plan":"pro","interval":"month"}');
  });

  it("bills Solo yearly when the toggle says so; other plans stay monthly", async () => {
    const { calls } = openBilling("/billing", {
      "GET /api/billing": { body: billing("free") },
      "POST /api/billing/checkout": { body: { url: WHOP_URL } },
    });
    await loaded();
    fireEvent.click(screen.getByRole("radio", { name: /Yearly/ }));
    expect(card("Solo").textContent).toContain(`$${PLANS.solo.priceUsdYearly} / year`);
    expect(card("Pro").textContent).toContain("$20 / month");

    fireEvent.click(within(card("Solo")).getByRole("button", { name: "Upgrade to Solo" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    expect(calls).toContainEqual({
      method: "POST",
      path: "/api/billing/checkout",
      body: { plan: "solo", interval: "year" },
    });
  });

  it("highlights the plan picked on the website and preselects its interval", async () => {
    openBilling("/billing?plan=solo&interval=year", { "GET /api/billing": { body: billing("free") } });
    const pick = await screen.findByText(/You picked/);
    expect(pick.textContent).toContain("Solo");
    expect(pick.textContent).toContain("yearly");
    expect(within(card("Solo")).getByText("Your pick")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Yearly/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("shows the API's answer next to the button when checkout fails", async () => {
    openBilling("/billing", {
      "GET /api/billing": { body: billing("free") },
      "POST /api/billing/checkout": {
        status: 502,
        body: {
          error: {
            code: "checkout_failed",
            message: "Whop did not start the checkout. Try again in a minute.",
          },
        },
      },
    });
    await loaded();
    fireEvent.click(within(card("Pro")).getByRole("button", { name: "Upgrade to Pro" }));
    expect((await within(card("Pro")).findByRole("alert")).textContent).toContain("Whop did not start");
    expect(assign).not.toHaveBeenCalled();
    expect(
      (within(card("Pro")).getByRole("button", { name: "Upgrade to Pro" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("says so and sells nothing when payments are not set up", async () => {
    openBilling("/billing", {
      "GET /api/billing": {
        body: billing("free", {}, { provider: null, purchasable: { solo: [], pro: [], scale: [] } }),
      },
    });
    expect(await screen.findByText(/Payments are not set up on this server/)).toBeTruthy();
    expect(
      (within(card("Pro")).getByRole("button", { name: "Upgrade to Pro" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("Billing page: Scale is not on sale", () => {
  const planCards = () =>
    within(screen.getByRole("list", { name: "Plans" }))
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);

  it.each([
    ["free", PLANS.free],
    ["pro", PLANS.pro],
  ] as const)(
    "shows a %s account the plans on sale only, without a Tenants and webhooks row",
    async (id, plan) => {
      openBilling("/billing", {
        "GET /api/me": { body: me({ plan: toPlanSummary(plan) }) },
        "GET /api/billing": { body: billing(id) },
      });
      await loaded();
      expect(planCards()).toEqual(["Free", "Solo", "Pro"]);
      expect(screen.queryByRole("listitem", { name: "Scale" })).toBeNull();
      expect(document.body.textContent).not.toContain("Scale");
      expect(document.body.textContent).not.toContain("Tenants and webhooks");
    },
  );

  it("ignores an old link that picks Scale", async () => {
    openBilling("/billing?plan=scale&interval=month", { "GET /api/billing": { body: billing("free") } });
    await loaded();
    expect(screen.queryByText(/You picked/)).toBeNull();
    expect(screen.queryByText("Your pick")).toBeNull();
    expect(planCards()).toEqual(["Free", "Solo", "Pro"]);
  });

  it("keeps the card of an account on Scale, as its plan", async () => {
    openBilling("/billing", {
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS.scale) }) },
      "GET /api/billing": { body: billing("scale") },
    });
    await loaded();
    expect(planCards()).toEqual(["Free", "Solo", "Pro", "Scale"]);
    expect(within(card("Scale")).getByRole("button", { name: "Your plan" })).toBeTruthy();
    expect(card("Scale").textContent).toContain("Tenants and webhooks");
    expect(within(card("Pro")).getByRole("button", { name: "Switch to Pro" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Current plan" }).textContent).toContain("Scale");
  });
});

describe("Billing page: features not on sale", () => {
  const meter = (name: string) => screen.queryByRole("meter", { name });

  it("shows no photo or custom emoji limits on the cards or the meters of a Pro account", async () => {
    openBilling("/billing", {
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS.pro) }) },
      "GET /api/billing": { body: billing("pro") },
    });
    await loaded();
    expect(document.body.textContent).not.toMatch(/photo/i);
    expect(meter("AI calls")).toBeTruthy();
    expect(meter("Image classifications")).toBeNull();
    expect(meter("Custom emoji")).toBeNull();
  });

  it("meters them once the account uses them, so a hidden limit is never a surprise", async () => {
    const used = billing("pro");
    used.usage = used.usage.map((usage) =>
      usage.metric === "semantic_calls" ? usage : { ...usage, used: 10, percent: 0.1 },
    );
    openBilling("/billing", {
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS.pro) }) },
      "GET /api/billing": { body: used },
    });
    await loaded();
    expect(meter("Image classifications")).toBeTruthy();
    expect(meter("Custom emoji")).toBeTruthy();
  });
});

describe("Billing page: a paid subscription", () => {
  it("shows the renewal date, the manage link, switches and the way down to Free", async () => {
    openBilling("/billing", {
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS.pro) }) },
      "GET /api/billing": { body: billing("pro") },
    });
    await loaded();
    const current = screen.getByRole("region", { name: "Current plan" });
    expect(current.textContent).toContain("Pro");
    expect(current.textContent).toContain("renews on Nov 15, 2026");
    const manage = within(current).getByRole("link", { name: /Manage subscription/ });
    expect(manage.getAttribute("href")).toBe("https://whop.com/billing/manage/mber_test/");
    expect(manage.getAttribute("target")).toBe("_blank");

    expect(within(card("Pro")).getByRole("button", { name: "Your plan" })).toBeTruthy();
    expect(within(card("Solo")).getByRole("button", { name: "Switch to Solo" })).toBeTruthy();
    expect(card("Solo").textContent).toContain("stops renewing when this one starts");
    expect(within(card("Free")).getByRole("link", { name: /Cancel in Whop/ })).toBeTruthy();
  });

  it("warns about a failed payment with the grace date, here and in the sidebar", async () => {
    openBilling("/billing", {
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS.pro), billingStatus: "past_due" }) },
      "GET /api/billing": {
        body: billing("pro", { status: "past_due", graceUntil: Date.UTC(2026, 9, 22, 12) }),
      },
    });
    const banner = await screen.findByText(/Update the payment method in Whop/);
    expect(banner.closest("p")?.textContent).toContain("by Oct 22, 2026");
    expect(screen.getByText("The last payment failed. Update the card in Billing.")).toBeTruthy();
  });

  it("explains a cancelled plan and when it ends", async () => {
    openBilling("/billing", {
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS.solo) }) },
      "GET /api/billing": { body: billing("solo", { status: "canceling" }) },
    });
    const banner = await screen.findByText(/Your Solo plan is cancelled\./);
    expect(banner.closest("p")?.textContent).toContain("until Nov 15, 2026");
    expect(card("Free").textContent).toContain("Moves to Free on Nov 15, 2026");
  });
});

describe("Billing page: back from Whop", () => {
  it("confirms the new plan once the webhook has changed it, and refreshes the session", async () => {
    sessionStorage.setItem("emojisense:checkout-started", '{"plan":"pro","interval":"month"}');
    const { calls } = openBilling("/billing?checkout=success", {
      "GET /api/billing": { body: billing("pro") },
    });
    // Generous waits: the confirmation takes a few renders, and CI machines can be busy.
    expect(await screen.findByText(/You are on Pro now\./, {}, { timeout: 5000 })).toBeTruthy();
    await vi.waitFor(() => expect(calls.filter((call) => call.path === "/api/me")).toHaveLength(2), {
      timeout: 5000,
    });
    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem("emojisense:checkout-started")).toBeNull();
  });

  it("says so when Whop reports a failed or cancelled payment, and does not wait", async () => {
    const { calls } = openBilling("/billing?checkout=success&status=canceled", {
      "GET /api/billing": { body: billing("free") },
    });
    expect(await screen.findByText(/The payment did not go through/)).toBeTruthy();
    expect(screen.queryByText(/Whop is confirming the payment/)).toBeNull();
    expect(calls.filter((call) => call.path === "/api/billing")).toHaveLength(1);
  });

  it("waits for Whop while the plan has not changed yet", async () => {
    sessionStorage.setItem("emojisense:checkout-started", '{"plan":"pro","interval":"month"}');
    openBilling("/billing?checkout=success", { "GET /api/billing": { body: billing("free") } });
    expect(await screen.findByText(/Whop is confirming the payment/)).toBeTruthy();
    expect(screen.queryByText(/You are on Pro now/)).toBeNull();
  });
});

describe("a plan picked on the website, before sign-in", () => {
  it("keeps the pick through sign-in", async () => {
    window.history.replaceState(null, "", "/billing?plan=solo&interval=year");
    stubApi({ "GET /api/me": unauthorized });
    render(<App />);
    expect(await screen.findByText(/take you to checkout for Solo/)).toBeTruthy();
    expect(sessionStorage.getItem("emojisense:checkout")).toBe("plan=solo&interval=year");
  });

  it("returns to Billing with the pick after sign-in", async () => {
    sessionStorage.setItem("emojisense:checkout", "plan=solo&interval=year");
    openBilling("/", { "GET /api/billing": { body: billing("free") } });
    expect(await screen.findByText(/You picked/)).toBeTruthy();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/billing?plan=solo&interval=year");
    // Used once: the next sign-in goes to the apps again.
    expect(sessionStorage.getItem("emojisense:checkout")).toBeNull();
  });
});
