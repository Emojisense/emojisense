import type { CultureAdminOverview, CulturePreview, CultureProposal } from "@emojisense/platform";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { APP, me, stubApi } from "./fake-api";

const proposal: CultureProposal = {
  id: "prop_1",
  entryId: "spooky-season",
  status: "draft",
  record: {
    id: "spooky-season",
    status: "draft",
    kind: "event",
    context: { en: "The weeks before Halloween" },
    when: { from: "2026-10-15", to: "2026-11-03" },
    regions: ["US"],
    locales: ["en"],
    triggers: { en: ["spooky season"] },
    emoji: [{ hexcode: "1F383", weight: 0.8 }],
    source: "ai-proposed",
    createdBy: "workers-ai:test",
    createdAt: "2026-10-15",
  },
  evidence: {
    origin: "trend",
    trends: [
      { day: "2026-10-15", locale: "en", country: "US", query: "spooky season", score: 6.4, searches: 412 },
    ],
    model: "@cf/google/gemma-4-26b-a4b-it",
    prompt: "propose.v2",
    gate: { queries: 217, triggers: 1 },
    droppedTriggers: [],
    warnings: [],
  },
  createdAt: Date.UTC(2026, 9, 15, 4, 41),
  updatedAt: Date.UTC(2026, 9, 15, 4, 41),
  reviewedAt: null,
  reviewerName: null,
  reason: null,
};

const preview: CulturePreview = {
  id: "spooky-season",
  issues: [],
  gate: { queries: 217, triggers: 1, failed: false },
  locales: [
    {
      locale: "en",
      context: "The weeks before Halloween",
      triggers: [
        {
          trigger: "spooky season",
          canonical: [{ emoji: "👻", hexcode: "1F47B", culture: false }],
          boosted: [
            { emoji: "👻", hexcode: "1F47B", culture: false },
            { emoji: "🎃", hexcode: "1F383", culture: true },
          ],
          added: 1,
          regions: [
            {
              region: "US",
              inScope: true,
              results: [
                { emoji: "👻", hexcode: "1F47B", culture: false },
                { emoji: "🎃", hexcode: "1F383", culture: true },
              ],
            },
            { region: "DE", inScope: false, results: [{ emoji: "👻", hexcode: "1F47B", culture: false }] },
          ],
        },
      ],
    },
  ],
};

const overview: CultureAdminOverview = {
  proposals: [proposal],
  counts: { draft: 1, approved: 0, rejected: 0 },
  live: [],
  publish: null,
  publishPending: false,
};

const account = (id: string) => me({ account: { ...me().account, id } });

describe("internal Culture page", () => {
  it("shows a draft with its evidence and search preview, and approves it with a reason", async () => {
    window.history.replaceState(null, "", "/internal/culture");
    const { calls } = stubApi({
      "GET /api/me": { body: account("acc_editor") },
      "GET /api/apps": { body: { apps: [APP] } },
      "GET /api/admin": { body: { admin: true, culture: true } },
      "GET /api/admin/culture": { body: overview },
      "GET /api/admin/culture/proposals/prop_1": { body: { proposal, preview } },
      "POST /api/admin/culture/proposals/prop_1/approve": {
        body: { proposal: { ...proposal, status: "approved" }, live: { id: "spooky-season" } },
      },
    });
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Culture" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Culture" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByText("×6.4")).toBeTruthy();
    const withEntry = await screen.findByRole("list", { name: "With the entry: spooky season" });
    expect(within(withEntry).getByText("(added)")).toBeTruthy();
    expect(screen.getByRole("list", { name: /Germany: spooky season/ }).textContent).toBe("👻");

    const approve = screen.getByRole("button", { name: "Approve…" });
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(approve);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Fits the season" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: "POST",
          path: "/api/admin/culture/proposals/prop_1/approve",
          body: { reason: "Fits the season", record: proposal.record },
        }),
      ),
    );
  });

  it("does not exist for an account outside ADMIN_EMAILS", async () => {
    window.history.replaceState(null, "", "/internal/culture");
    const { calls } = stubApi({
      "GET /api/me": { body: account("acc_member") },
      "GET /api/apps": { body: { apps: [APP] } },
      "GET /api/admin": { body: { admin: false, culture: false } },
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: /not found/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Culture" })).toBeNull();
    expect(calls.some((call) => call.path.startsWith("/api/admin/culture"))).toBe(false);
  });
});
