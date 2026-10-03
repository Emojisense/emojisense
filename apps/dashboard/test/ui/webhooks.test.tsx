import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import type { Role, WebhookSummary } from "../../src/shared/contract";
import { APP, me, NOW, stubApi } from "./fake-api";

const FULL_URL = "https://hooks.slack.com/services/T0001/B0001/s3cretT0ken";

const HOOK: WebhookSummary = {
  id: "wh_1",
  appId: "app_1",
  url: FULL_URL,
  events: ["custom_emoji.created"],
  enabled: true,
  createdAt: NOW,
  disabledAt: null,
  lastDelivery: null,
};

function openWebhooks(role: Role, hook: WebhookSummary) {
  const app = { ...APP, plan: "scale" as const, role, ownerId: "acc_ada", ownerName: "Ada Park" };
  window.history.replaceState(null, "", "/apps/app_1/webhooks");
  const api = stubApi({
    "GET /api/me": { body: me() },
    "GET /api/apps": { body: { apps: [app] } },
    "GET /api/apps/app_1": { body: { app, keys: [] } },
    "GET /api/apps/app_1/webhooks": { body: { webhooks: [hook] } },
    "GET /api/webhooks/wh_1/deliveries": { body: { deliveries: [] } },
    "PATCH /api/webhooks/wh_1": { body: { webhook: { ...hook, enabled: false, disabledAt: NOW } } },
  });
  render(<App />);
  return api;
}

describe("webhooks page", () => {
  it("shows a viewer the masked URL as host and …, says why, and offers no changes", async () => {
    openWebhooks("viewer", { ...HOOK, url: "https://hooks.slack.com/…" });

    const heading = await screen.findByRole("heading", { level: 2, name: "https://hooks.slack.com/…" });
    expect(heading.closest("section")?.textContent).toContain("The path is hidden");
    const list = screen.getByRole("navigation", { name: "Endpoints" });
    expect(within(list).getByText("hooks.slack.com/…")).toBeTruthy();
    expect(document.body.textContent).not.toContain("%E2%80%A6");
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete endpoint" })).toBeNull();
  });

  it("shows a developer the full URL and pauses without sending the URL back", async () => {
    const { calls } = openWebhooks("developer", HOOK);

    await screen.findByRole("heading", { level: 2, name: FULL_URL });
    expect(document.body.textContent).not.toContain("The path is hidden");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
    const patches = calls.filter((call) => call.method === "PATCH");
    expect(patches).toEqual([{ method: "PATCH", path: "/api/webhooks/wh_1", body: { enabled: false } }]);
  });
});
