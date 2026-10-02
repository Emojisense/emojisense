import { describe, expect, it } from "vitest";
import type {
  AppDetailResponse,
  AppsResponse,
  CreatedKeyResponse,
  MeResponse,
  Role,
} from "../../src/shared/contract";
import { accessFor, can, type Permission } from "../../src/worker/access";
import { accountIdOf, body, createAppFor, createHarness, joinTeam, setPlan } from "./harness";

/** ada owns a Pro account with one dev app and one key; bob, carol and dave join her team. */
async function setup() {
  const h = createHarness();
  const ada = await h.signIn("ada");
  setPlan(h, "ada", "pro");
  const appId = await createAppFor(h, ada, { name: "Ada chat", environment: "dev" });
  const created = await h.call("POST", `/api/apps/${appId}/keys`, { cookie: ada, body: { kind: "secret" } });
  const keyId = (await body<CreatedKeyResponse>(created)).key.id;

  const members: Record<"viewer" | "developer" | "admin", string> = {
    viewer: await h.signIn("bob"),
    developer: await h.signIn("carol"),
    admin: await h.signIn("dave"),
  };
  for (const [role, cookie] of Object.entries(members)) await joinTeam(h, ada, cookie, role);
  const eve = await h.signIn("eve");
  return { h, ada, eve, members, appId, keyId, adaId: accountIdOf(h, "ada") };
}

describe("can", () => {
  const table: [Role, Permission[]][] = [
    ["viewer", ["view"]],
    ["developer", ["view", "edit"]],
    ["admin", ["view", "edit", "manage_team", "view_billing"]],
    ["owner", ["view", "edit", "manage_team", "view_billing", "change_plan"]],
  ];
  const all: Permission[] = ["view", "edit", "manage_team", "view_billing", "change_plan"];
  it.each(table)("%s may %j and nothing else", (role, allowed) => {
    for (const permission of all) expect(can(role, permission)).toBe(allowed.includes(permission));
  });
});

describe("accessFor", () => {
  it("returns the role, the owner's plan and the app, or undefined", async () => {
    const { h, appId, adaId } = await setup();
    expect(await accessFor(h.db, adaId, appId)).toMatchObject({ role: "owner", plan: { id: "pro" } });
    expect(await accessFor(h.db, accountIdOf(h, "bob"), appId)).toMatchObject({
      role: "viewer",
      app: { id: appId, account_id: adaId },
    });
    expect(await accessFor(h.db, accountIdOf(h, "eve"), appId)).toBeUndefined();
    expect(await accessFor(h.db, adaId, "missing")).toBeUndefined();
    expect(await accessFor(h.db, adaId, "bad id!")).toBeUndefined();
  });
});

describe("team members on app and key routes", () => {
  it("lists team apps after the member's own apps, with the role and owner", async () => {
    const { h, members, appId, adaId } = await setup();
    const own = await createAppFor(h, members.developer, { name: "Carol's" });
    const { apps } = await body<AppsResponse>(
      await h.call("GET", "/api/apps", { cookie: members.developer }),
    );
    expect(apps.map((a) => [a.id, a.role, a.ownerId === adaId])).toEqual([
      [own, "owner", false],
      [appId, "developer", true],
    ]);
    expect(apps[1]).toMatchObject({ plan: "pro", ownerName: "ada" });
  });

  it("lets every role read the app, its keys, usage and analytics", async () => {
    const { h, members, appId } = await setup();
    for (const cookie of Object.values(members)) {
      const detail = await h.call("GET", `/api/apps/${appId}`, { cookie });
      expect(detail.status).toBe(200);
      expect((await body<AppDetailResponse>(detail)).keys).toHaveLength(1);
      expect((await h.call("GET", `/api/apps/${appId}/usage`, { cookie })).status).toBe(200);
      expect((await h.call("GET", `/api/apps/${appId}/analytics`, { cookie })).status).toBe(200);
    }
    const eve = await h.signIn("eve");
    expect((await h.call("GET", `/api/apps/${appId}/analytics`, { cookie: eve })).status).toBe(404);
  });

  it("refuses every write to viewers with 403 forbidden_role", async () => {
    const { h, members, appId, keyId } = await setup();
    const cookie = members.viewer;
    const writes = [
      h.call("PATCH", `/api/apps/${appId}`, { cookie, body: { name: "Mine" } }),
      h.call("POST", `/api/apps/${appId}/keys`, { cookie, body: { kind: "secret" } }),
      h.call("PATCH", `/api/keys/${keyId}`, { cookie, body: { allowedOrigins: [] } }),
      h.call("DELETE", `/api/keys/${keyId}`, { cookie }),
    ];
    for (const response of await Promise.all(writes)) {
      expect(response.status).toBe(403);
      expect(await body(response)).toEqual({
        error: {
          code: "forbidden_role",
          message: "This needs the developer role or higher. Your role is viewer. Ask the owner or an admin.",
        },
      });
    }
    expect(h.db.rows("SELECT * FROM api_keys WHERE revoked_at IS NOT NULL")).toEqual([]);
  });

  it.each(["developer", "admin"] as const)("lets a %s change the app and its keys", async (role) => {
    const { h, members, appId, keyId } = await setup();
    const cookie = members[role];
    expect((await h.call("PATCH", `/api/apps/${appId}`, { cookie, body: { name: "Renamed" } })).status).toBe(
      200,
    );
    const created = await h.call("POST", `/api/apps/${appId}/keys`, {
      cookie,
      body: { kind: "publishable" },
    });
    expect(created.status).toBe(201);
    expect((await h.call("DELETE", `/api/keys/${keyId}`, { cookie })).status).toBe(200);
  });

  it("hides the owner's apps and keys from outsiders with 404", async () => {
    const { h, eve, appId, keyId } = await setup();
    const attempts = [
      h.call("GET", `/api/apps/${appId}`, { cookie: eve }),
      h.call("PATCH", `/api/apps/${appId}`, { cookie: eve, body: { name: "x" } }),
      h.call("DELETE", `/api/keys/${keyId}`, { cookie: eve }),
    ];
    for (const response of await Promise.all(attempts)) expect(response.status).toBe(404);
    expect((await body<AppsResponse>(await h.call("GET", "/api/apps", { cookie: eve }))).apps).toEqual([]);
  });

  it("suspends team access while the owner's plan has no team, and restores it after", async () => {
    const { h, members, appId } = await setup();
    const cookie = members.admin;
    setPlan(h, "ada", "solo");
    expect((await h.call("GET", `/api/apps/${appId}`, { cookie })).status).toBe(404);
    expect((await body<AppsResponse>(await h.call("GET", "/api/apps", { cookie }))).apps).toEqual([]);
    expect((await body<MeResponse>(await h.call("GET", "/api/me", { cookie }))).teams).toEqual([]);

    setPlan(h, "ada", "scale");
    expect((await h.call("GET", `/api/apps/${appId}`, { cookie })).status).toBe(200);
  });

  it("lists the teams in /api/me and keeps team apps out of the member's app count", async () => {
    const { h, members, adaId } = await setup();
    const me = await body<MeResponse>(await h.call("GET", "/api/me", { cookie: members.developer }));
    expect(me.teams).toEqual([{ ownerId: adaId, ownerName: "ada", role: "developer" }]);
    expect(me.appCount).toBe(0);
    expect(me.plan.id).toBe("free");
    // Apps are created in the member's own account, within the member's own plan.
    expect(
      (await h.call("POST", "/api/apps", { cookie: members.developer, body: { name: "Own" } })).status,
    ).toBe(201);
  });
});
