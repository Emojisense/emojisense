import type {
  CultureAdminOverview,
  CultureAdminRpc,
  CultureEntryRecord,
  CultureLiveExport,
  CulturePreview,
  CultureProposal,
} from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import type { AdminStatusResponse } from "../../src/shared/contract";
import { accountIdOf, body, createHarness } from "./harness";

const record: CultureEntryRecord = {
  id: "spooky-season",
  status: "draft",
  kind: "event",
  context: { en: "The weeks before Halloween" },
  when: { from: "2026-10-15", to: "2026-11-03" },
  regions: ["*"],
  locales: ["en"],
  triggers: { en: ["spooky season"] },
  emoji: [{ hexcode: "1F47B", weight: 0.8 }],
  source: "ai-proposed",
  createdBy: "workers-ai:test",
  createdAt: "2026-10-15",
};

const proposal: CultureProposal = {
  id: "prop_1",
  entryId: record.id,
  status: "draft",
  record,
  evidence: {
    origin: "trend",
    trends: [],
    model: "m",
    prompt: "propose.v2",
    gate: { queries: 4, triggers: 1 },
    droppedTriggers: [],
    warnings: [],
  },
  createdAt: 0,
  updatedAt: 0,
  reviewedAt: null,
  reviewerName: null,
  reason: null,
};

const preview: CulturePreview = {
  id: record.id,
  issues: [],
  locales: [],
  gate: { queries: 4, triggers: 1, failed: false },
};

/** A CultureAdmin RPC stand-in that records its calls. */
function fakeCultureAdmin() {
  const overview: CultureAdminOverview = {
    proposals: [proposal],
    counts: { draft: 1, approved: 0, rejected: 0 },
    live: [],
    publish: null,
    publishPending: false,
  };
  const service = {
    overview: vi.fn(async () => overview),
    proposal: vi.fn(async (id: string) =>
      id === proposal.id
        ? { ok: true as const, value: { proposal, preview } }
        : { ok: false as const, code: "not_found" as const, message: "No such proposal." },
    ),
    preview: vi.fn(async () => preview),
    update: vi.fn(async () => ({ ok: true as const, value: { proposal, preview } })),
    approve: vi.fn(async () => ({
      ok: false as const,
      code: "invalid" as const,
      message: "Fix the errors before you approve.",
      issues: [{ level: "error" as const, message: "bad" }],
    })),
    reject: vi.fn(async () => ({
      ok: true as const,
      value: { proposal: { ...proposal, status: "rejected" as const } },
    })),
    retire: vi.fn(async () => ({
      ok: false as const,
      code: "not_found" as const,
      message: "No such live entry.",
    })),
    publish: vi.fn(async () => ({ status: "published" as const })),
    exportLive: vi.fn(
      async (): Promise<CultureLiveExport> => ({
        format: "emojisense-culture-live-export",
        formatVersion: 1,
        exportedAt: 1,
        entries: [],
      }),
    ),
  } satisfies CultureAdminRpc;
  return service;
}

function setup(adminEmails = "boss@example.com") {
  const service = fakeCultureAdmin();
  const h = createHarness({ ADMIN_EMAILS: adminEmails, CULTURE_ADMIN: service });
  return { h, service };
}

describe("admin access", () => {
  it("shows the Culture page only to accounts whose verified email is in ADMIN_EMAILS", async () => {
    const { h, service } = setup(" Boss@Example.com , other@example.com");
    const ada = await h.clerkSignIn("ada");
    expect(await body<AdminStatusResponse>(await h.call("GET", "/api/admin", { cookie: ada }))).toEqual({
      admin: false,
      culture: false,
    });
    // Not an admin: the routes look like they do not exist.
    expect((await h.call("GET", "/api/admin/culture", { cookie: ada })).status).toBe(404);
    expect((await h.call("POST", "/api/admin/culture/publish", { cookie: ada, body: {} })).status).toBe(404);
    expect(service.publish).not.toHaveBeenCalled();

    const boss = await h.clerkSignIn("boss");
    expect(await body<AdminStatusResponse>(await h.call("GET", "/api/admin", { cookie: boss }))).toEqual({
      admin: true,
      culture: true,
    });
    const overview = await h.call("GET", "/api/admin/culture?status=draft", { cookie: boss });
    expect(overview.status).toBe(200);
    expect(service.overview).toHaveBeenCalledWith({ status: "draft" });
  });

  it("ignores an email the session does not mark as verified", async () => {
    const { h, service } = setup();
    if (!h.clerk) throw new Error("fake Clerk expected");
    await h.call("GET", "/api/me", {
      token: h.clerk.token({ userId: "user_eve", email: "eve@example.com" }),
    });
    const unverified = h.clerk.token({ userId: "user_eve", email: "boss@example.com", emailVerified: false });
    expect((await h.call("GET", "/api/admin/culture", { token: unverified })).status).toBe(404);
    expect(service.overview).not.toHaveBeenCalled();
  });

  it("needs a session, a same-origin write, and the service binding", async () => {
    const { h } = setup();
    expect((await h.call("GET", "/api/admin")).status).toBe(401);
    const boss = await h.clerkSignIn("boss");
    const foreign = await h.call("POST", "/api/admin/culture/publish", {
      cookie: boss,
      body: {},
      origin: "https://evil.example",
    });
    expect(foreign.status).toBe(403);

    const unbound = createHarness({ ADMIN_EMAILS: "boss@example.com" });
    const token = await unbound.clerkSignIn("boss");
    const response = await unbound.call("GET", "/api/admin/culture", { cookie: token });
    expect(response.status).toBe(503);
    expect((await body<{ error: { code: string } }>(response)).error.code).toBe("culture_unavailable");
  });

  it("lets the local dev sign-in be an admin when its email is listed", async () => {
    const { h } = setup("ada@dev.localhost");
    const cookie = await h.signIn("ada");
    expect((await body<AdminStatusResponse>(await h.call("GET", "/api/admin", { cookie }))).admin).toBe(true);
  });
});

describe("culture review routes", () => {
  it("approves and rejects as the signed-in editor, by name, never by email", async () => {
    const { h, service } = setup();
    const boss = await h.clerkSignIn("boss");
    const approve = await h.call("POST", "/api/admin/culture/proposals/prop_1/approve", {
      cookie: boss,
      body: { reason: "fits", record },
    });
    expect(approve.status).toBe(422);
    expect(service.approve).toHaveBeenCalledWith("prop_1", {
      reviewer: { accountId: accountIdOf(h, "boss"), name: "boss" },
      reason: "fits",
      record,
    });
    const reject = await h.call("POST", "/api/admin/culture/proposals/prop_1/reject", {
      cookie: boss,
      body: { reason: "too narrow" },
    });
    expect(reject.status).toBe(200);
    expect((await body<{ proposal: CultureProposal }>(reject)).proposal.status).toBe("rejected");
  });

  it("maps service results to HTTP: not found, invalid bodies, publish and export", async () => {
    const { h, service } = setup();
    const boss = await h.clerkSignIn("boss");
    expect((await h.call("GET", "/api/admin/culture/proposals/nope", { cookie: boss })).status).toBe(404);
    expect((await h.call("GET", "/api/admin/culture/proposals/prop_1", { cookie: boss })).status).toBe(200);
    expect(
      (await h.call("POST", "/api/admin/culture/preview", { cookie: boss, body: { record: 3 } })).status,
    ).toBe(400);
    expect(
      (await h.call("POST", "/api/admin/culture/preview", { cookie: boss, body: { record } })).status,
    ).toBe(200);
    expect(
      (await h.call("PATCH", "/api/admin/culture/proposals/prop_1", { cookie: boss, body: { record } }))
        .status,
    ).toBe(200);
    expect(
      (await h.call("POST", "/api/admin/culture/live/x/retire", { cookie: boss, body: { reason: "old" } }))
        .status,
    ).toBe(404);
    const published = await h.call("POST", "/api/admin/culture/publish", { cookie: boss, body: {} });
    expect(await body(published)).toEqual({ status: "published" });
    const exported = await h.call("POST", "/api/admin/culture/export", {
      cookie: boss,
      body: { markExported: true },
    });
    expect(exported.headers.get("content-disposition")).toContain("culture-live-export.json");
    expect(service.exportLive).toHaveBeenCalledWith({ markExported: true });
  });
});
