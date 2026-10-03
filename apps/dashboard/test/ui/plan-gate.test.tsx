import { PLANS } from "@emojisense/platform";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { toPlanSummary } from "../../src/worker/plans";
import { APP, billing, me, stubApi } from "./fake-api";

const planRequired = (plan: string) => ({
  status: 402,
  body: { error: { code: "plan_required", message: `This is part of the ${plan} plan.`, plan } },
});

describe("plan gates", () => {
  it("shows a calm upsell that names the plan from the 402; Upgrade opens Billing with it", async () => {
    window.history.replaceState(null, "", "/apps/app_1/analytics");
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [APP] } },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/analytics": planRequired("pro"),
      "GET /api/billing": { body: billing() },
    });
    render(<App />);

    const gate = await screen.findByRole("region", { name: "See what people search for" });
    expect(within(gate).getByText("Available on Pro and up")).toBeTruthy();
    expect(within(gate).getByText("$20")).toBeTruthy();
    // An invitation, never an error.
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(within(gate).getByRole("link", { name: "Upgrade to Pro" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Billing" })).toBeTruthy();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/billing?plan=pro&interval=month");
    expect(screen.getByText(/You picked/).textContent).toContain("Pro");
  });

  it("says Coming soon, with no price and no upgrade, when the plan the API names is not on sale", async () => {
    window.history.replaceState(null, "", "/apps/app_1/webhooks");
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [APP] } },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/webhooks": planRequired("scale"),
    });
    render(<App />);

    const gate = await screen.findByRole("region", { name: "Get told when things change" });
    expect(within(gate).getByText("Coming soon.")).toBeTruthy();
    expect(within(gate).queryByRole("link")).toBeNull();
    expect(gate.textContent).not.toContain("Scale");
    expect(gate.textContent).not.toContain("$");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers no plan when the API names one that is not on sale for more apps", async () => {
    window.history.replaceState(null, "", "/apps");
    stubApi({
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS.pro), appCount: 0 }) },
      "GET /api/apps": { body: { apps: [] } },
      "POST /api/apps": {
        status: 402,
        body: { error: { code: "plan_required", message: "Your Pro plan allows 3 apps.", plan: "scale" } },
      },
    });
    render(<App />);

    fireEvent.change(await screen.findByLabelText("App name"), { target: { value: "Fourth" } });
    fireEvent.click(screen.getByRole("button", { name: "Create app" }));

    const gate = await screen.findByRole("region", { name: "More apps" });
    expect(gate.textContent).toContain("No plan has more apps yet.");
    expect(within(gate).queryByRole("link")).toBeNull();
  });

  it("asks a team member to talk to the owner instead of offering an upgrade", async () => {
    const teamApp = { ...APP, role: "developer" as const, ownerId: "acc_ada", ownerName: "Ada Park" };
    window.history.replaceState(null, "", "/apps/app_1/analytics");
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [teamApp] } },
      "GET /api/apps/app_1": { body: { app: teamApp, keys: [] } },
      "GET /api/apps/app_1/analytics": planRequired("pro"),
    });
    render(<App />);

    const gate = await screen.findByRole("region", { name: "See what people search for" });
    expect(gate.textContent).toContain("This app runs on Ada Park’s plan. Ask Ada Park to upgrade to Pro.");
    expect(within(gate).queryByRole("link", { name: /Upgrade/ })).toBeNull();
  });

  it("lists locked features in the sidebar without plan labels; the page names the plan", async () => {
    window.history.replaceState(null, "", "/apps/app_1");
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [APP] } },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/analytics": {
        status: 402,
        body: { error: { code: "plan_required", message: "Analytics need Pro.", plan: "pro" } },
      },
    });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Chat app app" });
    expect(within(nav).getByRole("link", { name: "Analytics" })).toBeTruthy();
    expect(document.querySelector(".sidebar .nav-lock")).toBeNull();

    fireEvent.click(within(nav).getByRole("link", { name: "Analytics" }));
    expect(await screen.findByRole("heading", { name: "See what people search for" })).toBeTruthy();
    expect(screen.getByText("Available on Pro and up")).toBeTruthy();
    expect(screen.getByText("Sample data")).toBeTruthy();
  });

  it.each([
    ["free", APP],
    ["pro", { ...APP, plan: "pro" as const }],
  ])("hides Tenants and Webhooks from a %s app, since no plan on sale has them", async (_, app) => {
    window.history.replaceState(null, "", "/apps/app_1");
    stubApi({
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS[app.plan]) }) },
      "GET /api/apps": { body: { apps: [app] } },
      "GET /api/apps/app_1": { body: { app, keys: [] } },
    });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Chat app app" });
    expect(within(nav).queryByRole("link", { name: /Tenants/ })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /Webhooks/ })).toBeNull();
    expect(document.querySelector(".sidebar")?.textContent).not.toContain("Scale");
  });

  it("keeps Tenants and Webhooks for an app on Scale, without lock hints", async () => {
    const app = { ...APP, plan: "scale" as const };
    window.history.replaceState(null, "", "/apps/app_1");
    stubApi({
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS.scale) }) },
      "GET /api/apps": { body: { apps: [app] } },
      "GET /api/apps/app_1": { body: { app, keys: [] } },
    });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Chat app app" });
    expect(within(nav).getByRole("link", { name: "Tenants" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Webhooks" })).toBeTruthy();
  });

  it("hides Custom emoji from a free app; its page says Coming soon, since no plan sells them", async () => {
    window.history.replaceState(null, "", "/apps/app_1/emoji");
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [APP] } },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/emoji": planRequired("solo"),
    });
    render(<App />);

    const gate = await screen.findByRole("region", { name: "Bring your own emoji" });
    expect(within(gate).getByText("Coming soon.")).toBeTruthy();
    expect(within(gate).queryByRole("link")).toBeNull();
    expect(gate.textContent).not.toContain("$");
    expect(gate.textContent).not.toMatch(/Solo|Pro/);
    const nav = screen.getByRole("navigation", { name: "Chat app app" });
    expect(within(nav).queryByRole("link", { name: "Custom emoji" })).toBeNull();
  });

  it("keeps Custom emoji for a Solo app that has them", async () => {
    const app = { ...APP, plan: "solo" as const };
    window.history.replaceState(null, "", "/apps/app_1");
    stubApi({
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS.solo) }) },
      "GET /api/apps": { body: { apps: [app] } },
      "GET /api/apps/app_1": { body: { app, keys: [] } },
    });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Chat app app" });
    expect(within(nav).getByRole("link", { name: "Custom emoji" })).toBeTruthy();
  });
});

describe("sidebar plan nudge", () => {
  it.each([
    ["free", "Emoji sets, analytics and a team come with paid plans."],
    ["solo", "Analytics, more apps and a team come with Pro."],
  ] as const)("invites a %s account to the next plan on sale", async (id, pitch) => {
    window.history.replaceState(null, "", "/apps");
    stubApi({
      "GET /api/me": { body: me({ plan: toPlanSummary(PLANS[id]) }) },
      "GET /api/apps": { body: { apps: [] } },
    });
    render(<App />);
    expect(await screen.findByText(pitch)).toBeTruthy();
  });

  it.each(["pro", "scale"] as const)(
    "shows no nudge to a %s account: no higher plan is on sale",
    async (id) => {
      window.history.replaceState(null, "", "/apps");
      stubApi({
        "GET /api/me": { body: me({ plan: toPlanSummary(PLANS[id]) }) },
        "GET /api/apps": { body: { apps: [] } },
      });
      render(<App />);
      expect(await screen.findByRole("navigation", { name: "Account" })).toBeTruthy();
      expect(document.querySelector(".side-plan")).toBeNull();
      expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
    },
  );
});

describe("live search key", () => {
  it("keeps a pasted publishable key in this tab only and refuses secret keys", async () => {
    window.history.replaceState(null, "", "/apps/app_1");
    sessionStorage.clear();
    const { calls } = stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [APP] } },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Paste a publishable key" }));
    const field = screen.getByLabelText("Publishable key");
    fireEvent.change(field, { target: { value: "sk_live_SecretSecret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Use key" }));
    expect(screen.getByText(/Secret keys never go in a browser/).getAttribute("role")).toBe("alert");
    expect(sessionStorage.getItem("emojisense:try-key:app_1")).toBeNull();

    fireEvent.change(field, { target: { value: "pk_live_TryTheSearch42" } });
    fireEvent.click(screen.getByRole("button", { name: "Use key" }));
    expect(await screen.findByText("pk_live_TryT…")).toBeTruthy();
    expect(sessionStorage.getItem("emojisense:try-key:app_1")).toBe("pk_live_TryTheSearch42");
    // The dashboard API never sees it.
    expect(JSON.stringify(calls.filter((call) => call.path.startsWith("/api/")))).not.toContain(
      "pk_live_TryT",
    );

    fireEvent.click(screen.getByRole("button", { name: "Forget key" }));
    expect(sessionStorage.getItem("emojisense:try-key:app_1")).toBeNull();
  });
});
