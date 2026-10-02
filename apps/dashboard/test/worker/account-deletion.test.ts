import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE_ACCOUNT_PHRASE, type MeResponse } from "../../src/shared/contract";
import { accountIdOf, body, createHarness, type Harness, NOW, setCookies, setPlan } from "./harness";

/** An R2 stand-in that keeps objects in a Map. */
function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: async (key: string, value: ArrayBuffer | Uint8Array) => {
      objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
      return {};
    },
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    }),
  };
}

/**
 * One row in every table that belongs to `login`, with ids that start with `<login>_`, plus its
 * custom emoji image. Returns the account id.
 */
function seedAccount(h: Harness, login: string, bucket?: ReturnType<typeof memoryBucket>): string {
  const accountId = accountIdOf(h, login);
  const app = `${login}_app`;
  const tenant = `${login}_tenant`;
  const image = `custom/${app}/${tenant}/${login}_emoji.png`;
  const sql: [string, ...(string | number)[]][] = [
    ["INSERT INTO apps (id, account_id, name, created_at) VALUES (?, ?, 'App', 0)", app, accountId],
    [
      `INSERT INTO api_keys (id, app_id, kind, prefix, hash, created_at)
       VALUES (?, ?, 'secret', 'sk_live_xxxx', ?, 0)`,
      `${login}_key`,
      app,
      `${login}_hash`,
    ],
    [
      "INSERT INTO usage_monthly (app_id, period, metric, count) VALUES (?, '2026-10', 'semantic_calls', 3)",
      app,
    ],
    [
      "INSERT INTO query_daily (app_id, day, query, searches, misses) VALUES (?, '2026-10-15', ?, 5, 1)",
      app,
      `${login}_query`,
    ],
    [
      "INSERT INTO tenants (id, app_id, external_id, created_at) VALUES (?, ?, ?, 0)",
      tenant,
      app,
      `${login}_customer`,
    ],
    [
      `INSERT INTO custom_emoji (id, app_id, tenant_id, shortcode, image_key, content_type, bytes, created_at)
       VALUES (?, ?, ?, 'party', ?, 'image/png', 4, 0)`,
      `${login}_emoji`,
      app,
      tenant,
      image,
    ],
    [
      "INSERT INTO webhooks (id, app_id, url, secret, created_at) VALUES (?, ?, 'https://hooks.example.com', ?, 0)",
      `${login}_hook`,
      app,
      `whsec_${login}`,
    ],
    [
      "INSERT INTO webhook_deliveries (id, webhook_id, event, status, created_at) VALUES (?, ?, 'webhook.test', 200, 0)",
      `${login}_delivery`,
      `${login}_hook`,
    ],
    [
      `INSERT INTO team_invites (id, owner_id, role, token_hash, email, created_at, expires_at)
       VALUES (?, ?, 'viewer', ?, 'guest@example.com', 0, ?)`,
      `${login}_invite`,
      accountId,
      `${login}_token`,
      NOW + 1,
    ],
    [
      "INSERT INTO waitlist (email, plan, created_at) VALUES (?, 'pro', 0)",
      `${login}@dev.localhost`.toUpperCase(),
    ],
  ];
  for (const [statement, ...params] of sql) h.db.exec(statement, ...params);
  bucket?.objects.set(image, new Uint8Array([1, 2, 3, 4]));
  return accountId;
}

function tables(h: Harness): string[] {
  return h.db
    .rows<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .map((row) => row.name);
}

/** Every row of every table, as JSON text, so a test can look for any trace of an account. */
function snapshot(h: Harness): Record<string, string[]> {
  return Object.fromEntries(
    tables(h).map((table) => [table, h.db.rows(`SELECT * FROM ${table}`).map((row) => JSON.stringify(row))]),
  );
}

async function setup() {
  const bucket = memoryBucket();
  const h = createHarness({ EMOJI: bucket });
  const ada = await h.signIn("ada");
  const bob = await h.signIn("bob");
  setPlan(h, "ada", "scale");
  setPlan(h, "bob", "scale");
  const adaId = seedAccount(h, "ada", bucket);
  const bobId = seedAccount(h, "bob", bucket);
  // Each one is a member of the other's team.
  h.db.exec(
    "INSERT INTO team_members (owner_id, member_id, role, created_at) VALUES (?, ?, 'admin', 0), (?, ?, 'viewer', 0)",
    adaId,
    bobId,
    bobId,
    adaId,
  );
  const remove = (confirm: unknown, cookie = ada, origin?: string) =>
    h.call("DELETE", "/api/me", { cookie, body: { confirm }, ...(origin ? { origin } : {}) });
  return { h, bucket, ada, bob, adaId, bobId, remove };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DELETE /api/me", () => {
  it("deletes the account and every row it owns, and leaves other accounts alone", async () => {
    const { h, bucket, ada, bob, adaId, remove } = await setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const before = snapshot(h);
    // The seed covers every table, so a new table fails here until the deletion handles it.
    for (const [table, rows] of Object.entries(before)) {
      expect(
        rows.some((row) => row.includes(adaId) || /ada[_@]|ADA@/.test(row)),
        table,
      ).toBe(true);
    }

    const response = await remove(" ADA@dev.localhost ");
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true });
    expect(setCookies(response).some((c) => c.startsWith("es_session=;") && c.includes("Max-Age=0"))).toBe(
      true,
    );
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: "account_deleted", apps: 1, customEmoji: 1 }));

    const isAda = (row: string) => row.includes(adaId) || /ada[_@]|ADA@/.test(row);
    const expected = Object.fromEntries(
      Object.entries(before).map(([table, rows]) => [table, rows.filter((row) => !isAda(row))]),
    );
    expect(snapshot(h)).toEqual(expected);
    expect(expected.apps).toHaveLength(1);
    expect(expected.custom_emoji).toHaveLength(1);

    expect([...bucket.objects.keys()]).toEqual(["custom/bob_app/bob_tenant/bob_emoji.png"]);
    expect((await h.call("GET", "/api/me", { cookie: ada })).status).toBe(401);
    const me = await body<MeResponse>(await h.call("GET", "/api/me", { cookie: bob }));
    expect(me.teams).toEqual([]);
    expect(me.appCount).toBe(1);
  });

  it("needs a session and a same-origin request", async () => {
    const { h, remove } = await setup();
    expect((await h.call("DELETE", "/api/me", { body: { confirm: "ada@dev.localhost" } })).status).toBe(401);
    const crossSite = await remove("ada@dev.localhost", undefined, "https://evil.example");
    expect(crossSite.status).toBe(403);
    expect(await body(crossSite)).toMatchObject({ error: { code: "forbidden_origin" } });
    expect(h.db.rows("SELECT id FROM accounts")).toHaveLength(2);
  });

  it.each([[undefined], [""], ["bob@dev.localhost"], [DELETE_ACCOUNT_PHRASE], [42]])(
    "refuses the confirmation %j and deletes nothing",
    async (confirm) => {
      const { h, remove } = await setup();
      const before = snapshot(h);
      const response = await remove(confirm);
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({
        error: {
          code: "confirmation_required",
          field: "confirm",
          message: "To delete the account, send its email address in confirm.",
        },
      });
      expect(snapshot(h)).toEqual(before);
    },
  );

  it("needs a JSON body", async () => {
    const { h, ada } = await setup();
    const response = await h.call("DELETE", "/api/me", { cookie: ada });
    expect(response.status).toBe(415);
  });

  it("asks an account without an email for the phrase", async () => {
    const { h, ada, adaId, remove } = await setup();
    h.db.exec("UPDATE accounts SET email = NULL WHERE id = ?", adaId);
    const refused = await remove("ada@dev.localhost");
    expect(await body(refused)).toMatchObject({
      error: {
        code: "confirmation_required",
        message: `To delete the account, send "${DELETE_ACCOUNT_PHRASE}" in confirm.`,
      },
    });

    expect((await remove(" Delete My Account ")).status).toBe(200);
    expect(h.db.rows("SELECT id FROM accounts WHERE id = ?", adaId)).toEqual([]);
    // Without an email, no waitlist entry can be linked to the account.
    expect(h.db.rows("SELECT email FROM waitlist ORDER BY email")).toHaveLength(2);
    expect((await h.call("GET", "/api/me", { cookie: ada })).status).toBe(401);
  });

  it("deletes nothing when the images cannot be deleted, so a retry can finish", async () => {
    const { h, bucket, ada, remove } = await setup();
    bucket.delete.mockRejectedValueOnce(new TypeError("R2 down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = snapshot(h);

    const response = await remove("ada@dev.localhost");
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ error: { code: "storage_unavailable" } });
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ level: "error", event: "account_images_delete_failed", error: "TypeError" }),
    );
    expect(snapshot(h)).toEqual(before);
    expect((await h.call("GET", "/api/me", { cookie: ada })).status).toBe(200);

    expect((await remove("ada@dev.localhost")).status).toBe(200);
    expect(bucket.objects.has("custom/ada_app/ada_tenant/ada_emoji.png")).toBe(false);
  });

  it("refuses when custom emoji exist but no image bucket is bound", async () => {
    const h = createHarness();
    const ada = await h.signIn("ada");
    seedAccount(h, "ada");
    const response = await h.call("DELETE", "/api/me", {
      cookie: ada,
      body: { confirm: "ada@dev.localhost" },
    });
    expect(response.status).toBe(503);
    expect(h.db.rows("SELECT id FROM accounts")).toHaveLength(1);
  });

  it("works without a bucket for an account that has no custom emoji", async () => {
    const h = createHarness();
    const ada = await h.signIn("ada");
    const response = await h.call("DELETE", "/api/me", {
      cookie: ada,
      body: { confirm: "ada@dev.localhost" },
    });
    expect(response.status).toBe(200);
    expect(h.db.rows("SELECT id FROM accounts")).toEqual([]);
    expect(h.db.rows("SELECT id FROM sessions")).toEqual([]);
  });

  it("deletes the images in chunks of 1,000 keys", async () => {
    const { h, bucket, adaId, remove } = await setup();
    for (let i = 0; i < 1500; i++) {
      h.db.exec(
        `INSERT INTO custom_emoji (id, app_id, shortcode, image_key, content_type, bytes, created_at)
         VALUES (?, 'ada_app', ?, ?, 'image/png', 4, 0)`,
        `ada_bulk_${i}`,
        `bulk_${i}`,
        `custom/ada_app/_/bulk_${i}.png`,
      );
    }
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await remove("ada@dev.localhost")).status).toBe(200);
    expect(bucket.delete.mock.calls.map(([keys]) => keys.length)).toEqual([1000, 501]);
    expect(h.db.rows("SELECT id FROM accounts WHERE id = ?", adaId)).toEqual([]);
  });
});
