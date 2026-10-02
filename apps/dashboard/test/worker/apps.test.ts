import { describe, expect, it, vi } from "vitest";
import type { AppDetailResponse, AppResponse, AppsResponse, MeResponse } from "../../src/shared/contract";
import { body, createAppFor, createHarness, setPlan } from "./harness";

describe("apps", () => {
  it("creates an app on the account's plan and lists it", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    const response = await h.call("POST", "/api/apps", {
      cookie,
      body: { name: "  Chat app ", environment: "staging" },
    });
    expect(response.status).toBe(201);
    const { app } = await body<{ app: AppsResponse["apps"][number] }>(response);
    expect(app).toMatchObject({
      name: "Chat app",
      environment: "staging",
      plan: "free",
      emojiSet: "native",
      activeKeyCount: 0,
      role: "owner",
      ownerName: "ada",
    });

    const list = await body<AppsResponse>(await h.call("GET", "/api/apps", { cookie }));
    expect(list.apps).toEqual([app]);
  });

  it("defaults the environment to prod", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    const response = await h.call("POST", "/api/apps", { cookie, body: { name: "Bot" } });
    expect((await body<{ app: { environment: string } }>(response)).app.environment).toBe("prod");
  });

  it.each([
    [{}, "name"],
    [{ name: "   " }, "name"],
    [{ name: "x".repeat(65) }, "name"],
    [{ name: "a\u0007b" }, "name"],
    [{ name: "Bot", environment: "production" }, "environment"],
  ])("rejects %j", async (input, field) => {
    const h = createHarness();
    const cookie = await h.signIn();
    const response = await h.call("POST", "/api/apps", { cookie, body: input });
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "invalid_request", field } });
  });

  it("requires a JSON object body", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    const form = await h.call("POST", "/api/apps", {
      cookie,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(form.status).toBe(415);
    const broken = await h.call("POST", "/api/apps", {
      cookie,
      headers: { "content-type": "application/json" },
    });
    expect(await body(broken)).toMatchObject({ error: { code: "invalid_json" } });
    const array = await h.call("POST", "/api/apps", { cookie, body: ["x"] });
    expect(array.status).toBe(400);
  });

  it("enforces maxApps of the free plan with 402 plan_required", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    await createAppFor(h, cookie);
    const response = await h.call("POST", "/api/apps", { cookie, body: { name: "Second" } });
    expect(response.status).toBe(402);
    expect(await body(response)).toEqual({
      error: {
        code: "plan_required",
        plan: "pro",
        message: "Your Free plan allows 1 app, and you have reached that limit. Pro allows 3 apps.",
      },
    });
    expect((await body<MeResponse>(await h.call("GET", "/api/me", { cookie }))).appCount).toBe(1);
  });

  it("uses the account's plan for maxApps and names Scale after Pro", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    await createAppFor(h, cookie);
    h.db.exec("UPDATE accounts SET plan = 'pro'");

    await createAppFor(h, cookie, { name: "Two" });
    await createAppFor(h, cookie, { name: "Three" });
    const fourth = await h.call("POST", "/api/apps", { cookie, body: { name: "Four" } });
    expect(fourth.status).toBe(402);
    expect(await body(fourth)).toMatchObject({ error: { code: "plan_required", plan: "scale" } });
    const list = await body<AppsResponse>(await h.call("GET", "/api/apps", { cookie }));
    expect(list.apps.map((a) => a.plan)).toEqual(["pro", "pro", "pro"]);

    h.db.exec("UPDATE accounts SET plan = 'scale'");
    expect((await h.call("POST", "/api/apps", { cookie, body: { name: "Four" } })).status).toBe(201);
  });

  it("ignores the legacy apps.plan column", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    const appId = await createAppFor(h, cookie);
    h.db.exec("UPDATE apps SET plan = 'scale' WHERE id = ?", appId);
    const list = await body<AppsResponse>(await h.call("GET", "/api/apps", { cookie }));
    expect(list.apps[0]?.plan).toBe("free");
    expect((await h.call("POST", "/api/apps", { cookie, body: { name: "Two" } })).status).toBe(402);
  });

  it("refuses writes from another origin but accepts clients without Origin", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    const sibling = await h.call("POST", "/api/apps", {
      cookie,
      origin: "https://www.emojisense.example",
      body: { name: "Bot" },
    });
    expect(sibling.status).toBe(403);
    expect(await body(sibling)).toMatchObject({ error: { code: "forbidden_origin" } });
    const cli = await h.call("POST", "/api/apps", { cookie, origin: null, body: { name: "Bot" } });
    expect(cli.status).toBe(201);
  });
});

describe("PATCH /api/apps/:id", () => {
  async function setup() {
    const h = createHarness();
    const cookie = await h.signIn();
    const appId = await createAppFor(h, cookie);
    const patch = (input: unknown) => h.call("PATCH", `/api/apps/${appId}`, { cookie, body: input });
    return { h, cookie, appId, patch };
  }

  it("renames the app and keeps the emoji set", async () => {
    const { h, cookie, appId, patch } = await setup();
    const response = await patch({ name: "  Support bot " });
    expect(response.status).toBe(200);
    expect((await body<AppResponse>(response)).app).toMatchObject({
      id: appId,
      name: "Support bot",
      emojiSet: "native",
    });
    const detail = await body<AppDetailResponse>(await h.call("GET", `/api/apps/${appId}`, { cookie }));
    expect(detail.app.name).toBe("Support bot");
  });

  it("needs a plan with hosted emoji sets for anything but native", async () => {
    const { h, appId, patch } = await setup();
    const free = await patch({ emojiSet: "twemoji" });
    expect(free.status).toBe(402);
    expect(await body(free)).toEqual({
      error: {
        code: "plan_required",
        plan: "solo",
        message: "A hosted emoji set needs the Solo plan or higher. The current plan is Free.",
      },
    });
    expect((await patch({ emojiSet: "native" })).status).toBe(200);

    setPlan(h, "ada", "solo");
    const solo = await patch({ name: "Chat", emojiSet: "fluent" });
    expect((await body<AppResponse>(solo)).app).toMatchObject({ name: "Chat", emojiSet: "fluent" });
    expect(h.db.rows("SELECT emoji_set FROM apps WHERE id = ?", appId)).toEqual([{ emoji_set: "fluent" }]);
  });

  it.each([
    [{}, undefined],
    [{ name: "" }, "name"],
    [{ emojiSet: "openmoji" }, "emojiSet"],
    [{ emojiSet: null }, "emojiSet"],
  ])("rejects %j", async (input, field) => {
    const { patch } = await setup();
    const response = await patch(input);
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({
      error: { code: "invalid_request", ...(field ? { field } : {}) },
    });
  });
});

describe("ownership", () => {
  it("hides one account's apps and keys from another", async () => {
    const h = createHarness();
    const ada = await h.signIn("ada");
    const bob = await h.signIn("bob");
    const appId = await createAppFor(h, ada, { environment: "dev" });
    const created = await h.call("POST", `/api/apps/${appId}/keys`, {
      cookie: ada,
      body: { kind: "secret" },
    });
    const keyId = (await body<{ key: { id: string } }>(created)).key.id;

    expect((await body<AppsResponse>(await h.call("GET", "/api/apps", { cookie: bob }))).apps).toEqual([]);
    const attempts = [
      h.call("GET", `/api/apps/${appId}`, { cookie: bob }),
      h.call("GET", `/api/apps/${appId}/usage`, { cookie: bob }),
      h.call("POST", `/api/apps/${appId}/keys`, { cookie: bob, body: { kind: "secret" } }),
      h.call("PATCH", `/api/keys/${keyId}`, { cookie: bob, body: { allowedOrigins: [] } }),
      h.call("DELETE", `/api/keys/${keyId}`, { cookie: bob }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(404);
      expect(await body(response)).toMatchObject({ error: { code: "not_found" } });
    }

    const detail = await body<AppDetailResponse>(await h.call("GET", `/api/apps/${appId}`, { cookie: ada }));
    expect(detail.keys).toHaveLength(1);
    expect(detail.keys[0]?.revokedAt).toBeNull();
  });

  it("answers 404 for malformed ids", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    expect((await h.call("GET", "/api/apps/%E0%A4%A", { cookie })).status).toBe(404);
    expect((await h.call("GET", `/api/apps/${"x".repeat(65)}`, { cookie })).status).toBe(404);
  });
});

describe("routing", () => {
  it("answers unknown routes and wrong methods with JSON", async () => {
    const h = createHarness();
    const missing = await h.call("GET", "/api/nope");
    expect(missing.status).toBe(404);
    expect(await body(missing)).toMatchObject({ error: { code: "not_found" } });

    const wrong = await h.call("PUT", "/api/apps");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET, POST");
  });

  it("hides internal errors behind a generic message and logs no account data", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    h.db.exec("DROP TABLE team_members");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await h.call("GET", "/api/me", { cookie });
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({
      error: { code: "internal_error", message: "Something went wrong on our side. Try again." },
    });
    const line = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, string>;
    expect(line).toMatchObject({ level: "error", event: "unhandled_error", route: "GET /api/me" });
    expect(JSON.stringify(line)).not.toContain("ada");
    log.mockRestore();
  });
});
