import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { APP, me, NOW, stubApi, usage } from "./fake-api";

beforeEach(() => {
  // Only Date is faked: the month list depends on "now", while promises and timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, "", "/apps/app_1");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usage", () => {
  it("shows meters against the plan limits and reloads for another month", async () => {
    const { calls } = stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/usage": ({ url }) => {
        const period = url.searchParams.get("period") ?? "";
        return {
          body:
            period === "2026-10"
              ? usage(period, { semantic_calls: 85_000, image_classifications: 100 })
              : usage(period, { semantic_calls: 1_234 }),
        };
      },
    });
    render(<App />);

    const semantic = await screen.findByRole("meter", { name: "Semantic calls" });
    expect(semantic.getAttribute("aria-valuenow")).toBe("85");
    expect(semantic.getAttribute("aria-valuetext")).toBe("85,000 of 100,000 (85%)");
    expect(screen.getByText("85,000 / 100,000")).toBeTruthy();
    expect(screen.getByText(/close to the limit/)).toBeTruthy();
    expect(screen.getByText(/^Limit reached/)).toBeTruthy();
    expect(screen.getByText("Not included in the Free plan.")).toBeTruthy();
    // A metric the plan does not include has no meter, only the note.
    expect(screen.queryByRole("meter", { name: "Custom emoji" })).toBeNull();

    const month = screen.getByLabelText("Month") as HTMLSelectElement;
    expect(
      within(month)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["October 2026", "September 2026", "August 2026"]);
    fireEvent.change(month, { target: { value: "2026-09" } });

    expect(await screen.findByText("1,234 / 100,000")).toBeTruthy();
    expect(calls.map((call) => call.path)).toContain("/api/apps/app_1/usage?period=2026-09");
  });

  it("measures the account's total and names this app's part of it", async () => {
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/usage": {
        body: usage("2026-10", { semantic_calls: 85_000 }, { semantic_calls: 12_000 }),
      },
    });
    render(<App />);

    const semantic = await screen.findByRole("meter", { name: "Semantic calls" });
    expect(semantic.getAttribute("aria-valuetext")).toBe("85,000 of 100,000 (85%)");
    expect(screen.getByText(/^This app: 12,000 of 85,000\. 85% used: close to the limit\./)).toBeTruthy();
    expect(screen.getByText(/Plan limits count the calls of every app of the account\./)).toBeTruthy();
  });

  it("meters custom emoji from the usage route: rows stored by the account, this app's part", async () => {
    const proApp = { ...APP, plan: "pro" as const };
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: proApp, keys: [] } },
      "GET /api/apps/app_1/usage": {
        body: usage("2026-10", { custom_emoji: 120 }, { custom_emoji: 45 }, "pro"),
      },
    });
    render(<App />);

    const meter = await screen.findByRole("meter", { name: "Custom emoji" });
    expect(meter.getAttribute("aria-valuetext")).toBe("120 of 2,000 (6%)");
    expect(screen.getByText(/^This app: 45 of 120\./)).toBeTruthy();
    // Stored emoji are not calls: the month still reads as one without calls.
    expect(screen.getByRole("heading", { name: "No calls in October 2026" })).toBeTruthy();
  });

  it("tells the user what to do when nothing was counted yet", async () => {
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/usage": { body: usage("2026-10") },
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "No calls in October 2026" })).toBeTruthy();
  });
});
