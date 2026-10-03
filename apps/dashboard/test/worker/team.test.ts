import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AcceptInviteResponse,
  CreatedInviteResponse,
  MeResponse,
  TeamMemberResponse,
  TeamResponse,
} from "../../src/shared/contract";
import { sha256Hex } from "../../src/worker/crypto";
import { INVITE_TTL_MS } from "../../src/worker/routes/team";
import type { FakeSession } from "./clerk-fake";
import {
  accountIdOf,
  BASE,
  body,
  createAppFor,
  createHarness,
  createInvite,
  joinTeam,
  NOW,
  setPlan,
} from "./harness";

/** ada owns a Pro account. */
async function setup() {
  const h = createHarness();
  const ada = await h.signIn("ada");
  setPlan(h, "ada", "pro");
  const accept = (token: string, cookie: string) =>
    h.call("POST", `/api/invites/${token}/accept`, { cookie });
  const team = async (cookie: string, query = "") =>
    body<TeamResponse>(await h.call("GET", `/api/team${query}`, { cookie }));
  return { h, ada, adaId: accountIdOf(h, "ada"), accept, team };
}

describe("GET /api/team", () => {
  it("needs Pro: 402 plan_required on Free and Solo", async () => {
    const h = createHarness();
    const ada = await h.signIn("ada");
    for (const plan of ["free", "solo"] as const) {
      setPlan(h, "ada", plan);
      const response = await h.call("GET", "/api/team", { cookie: ada });
      expect(response.status).toBe(402);
      expect(await body(response)).toMatchObject({ error: { code: "plan_required", plan: "pro" } });
    }
  });

  it("lists the owner first, then members and open invites", async () => {
    const { h, ada, adaId, team } = await setup();
    const bob = await h.signIn("bob");
    await joinTeam(h, ada, bob, "developer");
    await createInvite(h, ada, { role: "viewer", email: "Cleo@Example.com" });

    expect(await team(ada)).toEqual({
      ownerId: adaId,
      role: "owner",
      members: [
        { id: adaId, name: "ada", email: "ada@dev.localhost", role: "owner", createdAt: NOW },
        {
          id: accountIdOf(h, "bob"),
          name: "bob",
          email: "bob@dev.localhost",
          role: "developer",
          createdAt: NOW,
        },
      ],
      invites: [
        {
          id: expect.any(String),
          role: "viewer",
          email: "cleo@example.com",
          createdAt: NOW,
          expiresAt: NOW + INVITE_TTL_MS,
        },
      ],
    });
  });

  it("shows the team to members of any role through ?owner=, and 404 to outsiders", async () => {
    const { h, ada, adaId, team } = await setup();
    const bob = await h.signIn("bob");
    await joinTeam(h, ada, bob, "viewer");
    expect((await team(bob, `?owner=${adaId}`)).role).toBe("viewer");

    const eve = await h.signIn("eve");
    const outsider = await h.call("GET", `/api/team?owner=${adaId}`, { cookie: eve });
    expect(outsider.status).toBe(404);
    expect((await h.call("GET", "/api/team?owner=bad%20id", { cookie: eve })).status).toBe(404);
  });

  it("requires a session", async () => {
    const { h } = await setup();
    expect((await h.call("GET", "/api/team")).status).toBe(401);
  });
});

describe("POST /api/team/invites", () => {
  it("returns the link once and stores only the token hash", async () => {
    const { h, ada, adaId } = await setup();
    const response = await h.call("POST", "/api/team/invites", { cookie: ada, body: { role: "admin" } });
    expect(response.status).toBe(201);
    const { invite, url } = await body<CreatedInviteResponse>(response);
    expect(url).toMatch(new RegExp(`^${BASE}/invite/[A-Za-z0-9_-]{43}$`));
    expect(invite).toMatchObject({ role: "admin", email: null, expiresAt: NOW + 7 * 24 * 3600 * 1000 });

    const token = url.slice(url.lastIndexOf("/") + 1);
    const rows = h.db.rows<Record<string, unknown>>("SELECT * FROM team_invites");
    expect(rows).toEqual([
      expect.objectContaining({ id: invite.id, owner_id: adaId, token_hash: await sha256Hex(token) }),
    ]);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it.each([
    [{}, "role"],
    [{ role: "owner" }, "role"],
    [{ role: "admin", email: "not-an-email" }, "email"],
  ])("rejects %j", async (input, field) => {
    const { h, ada } = await setup();
    const response = await h.call("POST", "/api/team/invites", { cookie: ada, body: input });
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "invalid_request", field } });
  });

  it("needs Pro", async () => {
    const { h, ada } = await setup();
    setPlan(h, "ada", "solo");
    const response = await h.call("POST", "/api/team/invites", { cookie: ada, body: { role: "viewer" } });
    expect(response.status).toBe(402);
    expect(await body(response)).toMatchObject({ error: { code: "plan_required", plan: "pro" } });
  });

  it("refuses requests from other origins", async () => {
    const { h, ada } = await setup();
    const response = await h.call("POST", "/api/team/invites", {
      cookie: ada,
      origin: "https://evil.example",
      body: { role: "admin" },
    });
    expect(response.status).toBe(403);
    expect(h.db.rows("SELECT * FROM team_invites")).toEqual([]);
  });
});

describe("POST /api/invites/:token/accept", () => {
  it("joins the owner's team with the invite's role", async () => {
    const { h, ada, adaId, accept } = await setup();
    const appId = await createAppFor(h, ada);
    const bob = await h.signIn("bob");
    const token = await createInvite(h, ada, { role: "developer" });

    const response = await accept(token, bob);
    expect(response.status).toBe(200);
    expect(await body<AcceptInviteResponse>(response)).toEqual({
      team: { ownerId: adaId, ownerName: "ada", role: "developer" },
    });
    expect((await body<MeResponse>(await h.call("GET", "/api/me", { cookie: bob }))).teams).toHaveLength(1);
    expect((await h.call("GET", `/api/apps/${appId}`, { cookie: bob })).status).toBe(200);
    expect(h.db.rows("SELECT accepted_at FROM team_invites")).toEqual([{ accepted_at: NOW }]);
  });

  it("works only once", async () => {
    const { h, ada, accept } = await setup();
    const token = await createInvite(h, ada, { role: "viewer" });
    expect((await accept(token, await h.signIn("bob"))).status).toBe(200);

    const reuse = await accept(token, await h.signIn("carol"));
    expect(reuse.status).toBe(410);
    expect(await body(reuse)).toMatchObject({ error: { code: "invite_used" } });
    expect(h.db.rows("SELECT member_id FROM team_members")).toHaveLength(1);
  });

  it("expires after 7 days", async () => {
    const { h, ada, accept } = await setup();
    const early = await createInvite(h, ada, { role: "viewer" });
    const late = await createInvite(h, ada, { role: "viewer" });
    h.clock.now = NOW + INVITE_TTL_MS - 1;
    expect((await accept(early, await h.signIn("bob"))).status).toBe(200);

    h.clock.now = NOW + INVITE_TTL_MS;
    const expired = await accept(late, await h.signIn("carol"));
    expect(expired.status).toBe(410);
    expect(await body(expired)).toMatchObject({ error: { code: "invite_expired" } });
    // Expired invites leave the list.
    const team = await body<TeamResponse>(await h.call("GET", "/api/team", { cookie: ada }));
    expect(team.invites).toEqual([]);
  });

  it("refuses unknown and malformed tokens", async () => {
    const { h, accept } = await setup();
    const bob = await h.signIn("bob");
    for (const token of ["x".repeat(43), "short", "%E0%A4%A"]) {
      const response = await accept(token, bob);
      expect(response.status).toBe(404);
    }
    expect(await body(await accept("x".repeat(43), bob))).toMatchObject({
      error: { code: "invite_not_found" },
    });
  });

  it("refuses the owner and existing members, and keeps the invite open", async () => {
    const { h, ada, accept, team } = await setup();
    const own = await accept(await createInvite(h, ada, { role: "admin" }), ada);
    expect(own.status).toBe(409);
    expect(await body(own)).toMatchObject({ error: { code: "invite_own_team" } });

    const bob = await h.signIn("bob");
    await joinTeam(h, ada, bob, "viewer");
    const again = await accept(await createInvite(h, ada, { role: "admin" }), bob);
    expect(again.status).toBe(409);
    expect(await body(again)).toMatchObject({ error: { code: "already_member" } });
    expect((await team(ada)).invites).toHaveLength(2);
    expect((await team(ada)).members.find((m) => m.name === "bob")?.role).toBe("viewer");
  });

  it("needs the owner to still have a team plan", async () => {
    const { h, ada, accept } = await setup();
    const token = await createInvite(h, ada, { role: "viewer" });
    setPlan(h, "ada", "free");
    const response = await accept(token, await h.signIn("bob"));
    expect(response.status).toBe(402);
    expect(await body(response)).toMatchObject({ error: { code: "plan_required", plan: "pro" } });
  });

  it("requires a session", async () => {
    const { h, ada } = await setup();
    const token = await createInvite(h, ada, { role: "viewer" });
    expect((await h.call("POST", `/api/invites/${token}/accept`)).status).toBe(401);
  });
});

describe("invites by email", () => {
  async function emailSetup() {
    const { h, ada } = await setup();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const clerk = h.clerk;
    if (!clerk) throw new Error("needs the fake Clerk");
    const acceptAs = (invite: string, session: FakeSession) =>
      h.call("POST", `/api/invites/${invite}/accept`, { token: clerk.token(session) });
    return { h, ada, acceptAs };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets in the Clerk user whose verified email matches, in any case", async () => {
    const { h, ada, acceptAs } = await emailSetup();
    const invite = await createInvite(h, ada, { role: "developer", email: "Sam@Example.com" });
    const response = await acceptAs(invite, { userId: "user_sam", email: "SAM@example.COM" });
    expect(response.status).toBe(200);
    expect(await body<AcceptInviteResponse>(response)).toMatchObject({ team: { role: "developer" } });
  });

  it("refuses another email and an unverified one, and keeps the invite open", async () => {
    const { h, ada, acceptAs } = await emailSetup();
    const invite = await createInvite(h, ada, { role: "viewer", email: "sam@example.com" });
    const sessions: [FakeSession, string][] = [
      [{ userId: "user_eve", email: "eve@example.com" }, "invite_email_mismatch"],
      // An unverified email creates no account at all.
      [{ userId: "user_sam", email: "sam@example.com", emailVerified: false }, "email_required"],
    ];
    for (const [session, code] of sessions) {
      const response = await acceptAs(invite, session);
      expect(response.status).toBe(403);
      expect(await body(response)).toMatchObject({ error: { code } });
    }
    expect(h.db.rows("SELECT accepted_at FROM team_invites")).toEqual([{ accepted_at: null }]);
    expect((await acceptAs(invite, { userId: "user_sam", email: "sam@example.com" })).status).toBe(200);
  });

  it("lets anyone with the link in when the invite has no email", async () => {
    const { h, ada, acceptAs } = await emailSetup();
    const invite = await createInvite(h, ada, { role: "viewer" });
    expect((await acceptAs(invite, { userId: "user_anyone" })).status).toBe(200);
  });

  it("matches a dev account by its dev email", async () => {
    const { h, ada, accept } = await setup();
    const bob = await h.signIn("bob");
    const wrong = await createInvite(h, ada, { role: "viewer", email: "carol@dev.localhost" });
    expect((await accept(wrong, bob)).status).toBe(403);
    const right = await createInvite(h, ada, { role: "viewer", email: "bob@dev.localhost" });
    expect((await accept(right, bob)).status).toBe(200);
  });
});

describe("managing members", () => {
  /** bob is an admin, carol a developer, dan a viewer of ada's team. */
  async function withMembers() {
    const ctx = await setup();
    const { h, ada } = ctx;
    const cookies = {
      bob: await h.signIn("bob"),
      carol: await h.signIn("carol"),
      dan: await h.signIn("dan"),
    };
    await joinTeam(h, ada, cookies.bob, "admin");
    await joinTeam(h, ada, cookies.carol, "developer");
    await joinTeam(h, ada, cookies.dan, "viewer");
    const ids = { bob: accountIdOf(h, "bob"), carol: accountIdOf(h, "carol"), dan: accountIdOf(h, "dan") };
    return { ...ctx, cookies, ids, owner: `?owner=${ctx.adaId}` };
  }

  it("lets the owner change a role", async () => {
    const { h, ada, ids, team } = await withMembers();
    const response = await h.call("PATCH", `/api/team/members/${ids.dan}`, {
      cookie: ada,
      body: { role: "developer" },
    });
    expect(response.status).toBe(200);
    expect(await body<TeamMemberResponse>(response)).toEqual({
      member: { id: ids.dan, name: "dan", email: "dan@dev.localhost", role: "developer", createdAt: NOW },
    });
    expect((await team(ada)).members.find((m) => m.id === ids.dan)?.role).toBe("developer");
  });

  it("lets an admin invite, change roles and remove members of the owner's team", async () => {
    const { h, cookies, ids, owner, adaId, accept, team } = await withMembers();
    const token = await createInvite(h, cookies.bob, { role: "viewer", owner: adaId });
    expect((await accept(token, await h.signIn("eve"))).status).toBe(200);

    const promote = await h.call("PATCH", `/api/team/members/${ids.carol}${owner}`, {
      cookie: cookies.bob,
      body: { role: "admin" },
    });
    expect(promote.status).toBe(200);
    const remove = await h.call("DELETE", `/api/team/members/${ids.dan}${owner}`, { cookie: cookies.bob });
    expect(await body(remove)).toEqual({ ok: true });
    // Everyone joined at NOW, so only the owner's place is fixed.
    const members = (await team(cookies.bob, owner)).members.map((m) => [m.name, m.role]);
    expect(members[0]).toEqual(["ada", "owner"]);
    expect(members.sort()).toEqual([
      ["ada", "owner"],
      ["bob", "admin"],
      ["carol", "admin"],
      ["eve", "viewer"],
    ]);
  });

  it("does not let developers or viewers manage the team", async () => {
    const { h, cookies, ids, owner, adaId } = await withMembers();
    const inviteId = (
      await body<CreatedInviteResponse>(
        await h.call("POST", `/api/team/invites${owner}`, { cookie: cookies.bob, body: { role: "viewer" } }),
      )
    ).invite.id;
    for (const cookie of [cookies.carol, cookies.dan]) {
      const attempts = [
        h.call("POST", `/api/team/invites${owner}`, { cookie, body: { role: "admin" } }),
        h.call("DELETE", `/api/team/invites/${inviteId}${owner}`, { cookie }),
        h.call("PATCH", `/api/team/members/${ids.bob}${owner}`, { cookie, body: { role: "viewer" } }),
        h.call("DELETE", `/api/team/members/${ids.bob}${owner}`, { cookie }),
      ];
      for (const response of await Promise.all(attempts)) {
        expect(response.status).toBe(403);
        expect(await body(response)).toMatchObject({ error: { code: "forbidden_role" } });
      }
    }
    expect(h.db.rows("SELECT role FROM team_members WHERE member_id = ?", ids.bob)).toEqual([
      { role: "admin" },
    ]);
    expect(
      h.db.rows("SELECT id FROM team_invites WHERE owner_id = ? AND id = ?", adaId, inviteId),
    ).toHaveLength(1);
  });

  it("lets any member leave, and then hides the team", async () => {
    const { h, cookies, ids, owner, adaId } = await withMembers();
    const response = await h.call("DELETE", `/api/team/members/${ids.dan}${owner}`, { cookie: cookies.dan });
    expect(response.status).toBe(200);
    expect((await h.call("GET", `/api/team?owner=${adaId}`, { cookie: cookies.dan })).status).toBe(404);
  });

  it("lets a member leave after the owner downgrades, while admins cannot manage the paused team", async () => {
    const { h, cookies, ids, owner, adaId } = await withMembers();
    setPlan(h, "ada", "free");
    const removed = await h.call("DELETE", `/api/team/members/${ids.dan}${owner}`, { cookie: cookies.bob });
    expect(removed.status).toBe(404);
    const left = await h.call("DELETE", `/api/team/members/${ids.dan}${owner}`, { cookie: cookies.dan });
    expect(left.status).toBe(200);
    expect(h.db.rows("SELECT role FROM team_members WHERE owner_id = ? ORDER BY role", adaId)).toEqual([
      { role: "admin" },
      { role: "developer" },
    ]);
  });

  it("never changes or removes the owner", async () => {
    const { h, ada, adaId, cookies, owner } = await withMembers();
    const attempts = [
      h.call("PATCH", `/api/team/members/${adaId}`, { cookie: ada, body: { role: "viewer" } }),
      h.call("DELETE", `/api/team/members/${adaId}`, { cookie: ada }),
      h.call("PATCH", `/api/team/members/${adaId}${owner}`, {
        cookie: cookies.bob,
        body: { role: "viewer" },
      }),
      h.call("DELETE", `/api/team/members/${adaId}${owner}`, { cookie: cookies.bob }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(409);
      expect(await body(response)).toMatchObject({ error: { code: "owner_immutable" } });
    }
  });

  it("answers 404 for unknown members and 400 for bad roles", async () => {
    const { h, ada, ids } = await withMembers();
    await h.signIn("eve");
    const unknown = await h.call("PATCH", `/api/team/members/${accountIdOf(h, "eve")}`, {
      cookie: ada,
      body: { role: "viewer" },
    });
    expect(unknown.status).toBe(404);
    expect((await h.call("DELETE", "/api/team/members/nobody", { cookie: ada })).status).toBe(404);
    const bad = await h.call("PATCH", `/api/team/members/${ids.dan}`, {
      cookie: ada,
      body: { role: "owner" },
    });
    expect(bad.status).toBe(400);
  });
});

describe("DELETE /api/team/invites/:id", () => {
  it("withdraws an open invite, so its link stops working", async () => {
    const { h, ada, accept, team } = await setup();
    const token = await createInvite(h, ada, { role: "viewer" });
    const [invite] = (await team(ada)).invites;
    const response = await h.call("DELETE", `/api/team/invites/${invite?.id}`, { cookie: ada });
    expect(await body(response)).toEqual({ ok: true });
    expect((await team(ada)).invites).toEqual([]);
    expect((await accept(token, await h.signIn("bob"))).status).toBe(404);
  });

  it("answers 404 for accepted, unknown and other owners' invites", async () => {
    const { h, ada, accept } = await setup();
    const token = await createInvite(h, ada, { role: "viewer" });
    await accept(token, await h.signIn("bob"));
    const [accepted] = h.db.rows<{ id: string }>("SELECT id FROM team_invites");
    expect((await h.call("DELETE", `/api/team/invites/${accepted?.id}`, { cookie: ada })).status).toBe(404);
    expect((await h.call("DELETE", "/api/team/invites/nope", { cookie: ada })).status).toBe(404);

    const open = await createInvite(h, ada, { role: "viewer" });
    const [row] = h.db.rows<{ id: string }>(
      "SELECT id FROM team_invites WHERE token_hash = ?",
      await sha256Hex(open),
    );
    const eve = await h.signIn("eve");
    setPlan(h, "eve", "pro");
    expect((await h.call("DELETE", `/api/team/invites/${row?.id}`, { cookie: eve })).status).toBe(404);
  });

  it("still works after a downgrade, so the owner can clean up", async () => {
    const { h, ada, team } = await setup();
    await createInvite(h, ada, { role: "viewer" });
    const [invite] = (await team(ada)).invites;
    setPlan(h, "ada", "free");
    expect((await h.call("DELETE", `/api/team/invites/${invite?.id}`, { cookie: ada })).status).toBe(200);
  });
});
