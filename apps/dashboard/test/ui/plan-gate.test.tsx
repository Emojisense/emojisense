import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { APP, me, stubApi } from "./fake-api";

const planRequired = (plan: string) => ({
  status: 402,
  body: { error: { code: "plan_required", message: `This is part of the ${plan} plan.`, plan } },
});

describe("plan gates", () => {
  it("shows a calm upsell that names the plan from the 402, and Upgrade joins its waitlist", async () => {
    window.history.replaceState(null, "", "/apps/app_1/analytics");
    const { calls } = stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [APP] } },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/analytics": planRequired("pro"),
      "POST /api/billing/upgrade": ({ body }) => ({
        body: { status: "waitlist", plan: (body as { plan: string }).plan },
      }),
    });
    render(<App />);

    const gate = await screen.findByRole("region", { name: "See what people search for" });
    expect(within(gate).getByText("Available on Pro and up")).toBeTruthy();
    expect(within(gate).getByText("$20")).toBeTruthy();
    // An invitation, never an error.
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(within(gate).getByRole("button", { name: "Upgrade to Pro" }));
    expect(await within(gate).findByText(/You are on the Pro waitlist/)).toBeTruthy();
    expect(calls).toContainEqual({ method: "POST", path: "/api/billing/upgrade", body: { plan: "pro" } });
  });

  it("uses the plan the API names, even when the page expected another", async () => {
    window.history.replaceState(null, "", "/apps/app_1/webhooks");
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [APP] } },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/webhooks": planRequired("scale"),
    });
    render(<App />);

    const gate = await screen.findByRole("region", { name: "Get told when things change" });
    expect(within(gate).getByRole("button", { name: "Upgrade to Scale" })).toBeTruthy();
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
    expect(within(gate).queryByRole("button", { name: /Upgrade/ })).toBeNull();
  });

  it("marks plan features in the sidebar by the app's plan", async () => {
    window.history.replaceState(null, "", "/apps/app_1");
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [APP] } },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
    });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Chat app app" });
    expect(within(nav).getByRole("link", { name: "Analytics Pro" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Webhooks Scale" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Keys" })).toBeTruthy();
  });
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
