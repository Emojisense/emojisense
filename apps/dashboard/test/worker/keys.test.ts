import { hashKey } from "@emojisense/platform";
import { describe, expect, it } from "vitest";
import type { AppDetailResponse, CreatedKeyResponse, KeyResponse } from "../../src/shared/contract";
import { body, createAppFor, createHarness, NOW } from "./harness";

async function setup(environment = "prod") {
  const h = createHarness();
  const cookie = await h.signIn();
  const appId = await createAppFor(h, cookie, { environment });
  const createKey = (input: unknown) => h.call("POST", `/api/apps/${appId}/keys`, { cookie, body: input });
  return { h, cookie, appId, createKey };
}

describe("key lifecycle", () => {
  it("returns the full key once and stores only its hash and prefix", async () => {
    const { h, cookie, appId, createKey } = await setup();
    const response = await createKey({ kind: "publishable", allowedOrigins: ["https://chat.example.com"] });
    expect(response.status).toBe(201);
    const { key, fullKey } = await body<CreatedKeyResponse>(response);

    expect(fullKey).toMatch(/^pk_live_[A-Za-z0-9]{32}$/);
    expect(key).toEqual({
      id: expect.any(String),
      appId,
      kind: "publishable",
      prefix: fullKey.slice(0, 12),
      allowedOrigins: ["https://chat.example.com"],
      createdAt: NOW,
      revokedAt: null,
    });
    const [row] = h.db.rows<{ hash: string; prefix: string }>("SELECT hash, prefix FROM api_keys");
    expect(row?.hash).toBe(await hashKey(fullKey));
    expect(JSON.stringify(h.db.rows("SELECT * FROM api_keys"))).not.toContain(fullKey);

    const detail = await h.call("GET", `/api/apps/${appId}`, { cookie });
    const text = await detail.text();
    expect(text).not.toContain(fullKey);
    expect(text).not.toContain(row?.hash);
    const parsed = JSON.parse(text) as AppDetailResponse;
    expect(parsed.app.activeKeyCount).toBe(1);
    expect(parsed.keys).toEqual([key]);
  });

  it("creates secret keys without origins", async () => {
    const { createKey } = await setup();
    const response = await createKey({ kind: "secret" });
    expect(response.status).toBe(201);
    const { key, fullKey } = await body<CreatedKeyResponse>(response);
    expect(fullKey).toMatch(/^sk_live_/);
    expect(key.allowedOrigins).toEqual([]);
  });

  it("rejects an unknown kind", async () => {
    const { createKey } = await setup();
    const response = await createKey({ kind: "admin" });
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { field: "kind" } });
  });

  it("updates the origins of a publishable key", async () => {
    const { h, cookie, createKey } = await setup();
    const { key } = await body<CreatedKeyResponse>(
      await createKey({ kind: "publishable", allowedOrigins: ["https://a.example.com"] }),
    );
    const response = await h.call("PATCH", `/api/keys/${key.id}`, {
      cookie,
      body: { allowedOrigins: ["https://B.example.com/", "https://*.example.org", "https://b.example.com"] },
    });
    expect(response.status).toBe(200);
    const updated = await body<KeyResponse>(response);
    expect(updated.key.allowedOrigins).toEqual(["https://b.example.com", "https://*.example.org"]);
    expect(
      h.db.rows<{ allowed_origins: string }>("SELECT allowed_origins FROM api_keys")[0]?.allowed_origins,
    ).toBe('["https://b.example.com","https://*.example.org"]');
  });

  it("refuses origin changes that make no sense", async () => {
    const { h, cookie, createKey } = await setup();
    const secret = (await body<CreatedKeyResponse>(await createKey({ kind: "secret" }))).key;
    const publishable = (
      await body<CreatedKeyResponse>(
        await createKey({ kind: "publishable", allowedOrigins: ["https://a.example.com"] }),
      )
    ).key;
    const patch = (id: string, payload: unknown) =>
      h.call("PATCH", `/api/keys/${id}`, { cookie, body: payload });

    expect((await patch(secret.id, { allowedOrigins: ["https://a.example.com"] })).status).toBe(400);
    expect(await body(await patch(publishable.id, {}))).toMatchObject({ error: { field: "allowedOrigins" } });
    const opened = await patch(publishable.id, { allowedOrigins: [] });
    expect(await body(opened)).toMatchObject({ error: { code: "invalid_origin" } });
  });

  it("revokes idempotently and freezes the key afterwards", async () => {
    const { h, cookie, appId, createKey } = await setup();
    const { key } = await body<CreatedKeyResponse>(await createKey({ kind: "secret" }));

    h.clock.now = NOW + 1_000;
    const first = await body<KeyResponse>(await h.call("DELETE", `/api/keys/${key.id}`, { cookie }));
    expect(first.key.revokedAt).toBe(NOW + 1_000);

    h.clock.now = NOW + 2_000;
    const second = await body<KeyResponse>(await h.call("DELETE", `/api/keys/${key.id}`, { cookie }));
    expect(second.key.revokedAt).toBe(NOW + 1_000);

    const patch = await h.call("PATCH", `/api/keys/${key.id}`, { cookie, body: { allowedOrigins: [] } });
    expect(patch.status).toBe(409);
    expect(await body(patch)).toMatchObject({ error: { code: "key_revoked" } });

    const detail = await body<AppDetailResponse>(await h.call("GET", `/api/apps/${appId}`, { cookie }));
    expect(detail.app.activeKeyCount).toBe(0);
    expect(detail.keys[0]?.revokedAt).toBe(NOW + 1_000);
  });

  it("lists active keys before revoked ones, newest first", async () => {
    const { h, cookie, appId, createKey } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      h.clock.now = NOW + i;
      ids.push((await body<CreatedKeyResponse>(await createKey({ kind: "secret" }))).key.id);
    }
    await h.call("DELETE", `/api/keys/${ids[2]}`, { cookie });
    const detail = await body<AppDetailResponse>(await h.call("GET", `/api/apps/${appId}`, { cookie }));
    expect(detail.keys.map((k) => k.id)).toEqual([ids[1], ids[0], ids[2]]);
  });
});

describe("allowed origins policy", () => {
  it("requires origins on publishable keys of staging and prod apps", async () => {
    for (const environment of ["prod", "staging"]) {
      const { createKey } = await setup(environment);
      const response = await createKey({ kind: "publishable" });
      expect(response.status).toBe(400);
      expect(await body(response)).toMatchObject({
        error: {
          code: "invalid_origin",
          field: "allowedOrigins",
          message: "Add at least one allowed origin. Only keys of dev apps may allow any origin.",
        },
      });
    }
  });

  it("lets dev apps create publishable keys for any origin", async () => {
    const { createKey } = await setup("dev");
    const response = await createKey({ kind: "publishable", allowedOrigins: [] });
    expect(response.status).toBe(201);
    expect((await body<CreatedKeyResponse>(response)).key.allowedOrigins).toEqual([]);
  });

  it("gives secret keys no origins", async () => {
    const { createKey } = await setup();
    const response = await createKey({ kind: "secret", allowedOrigins: ["https://a.example.com"] });
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({
      error: { code: "invalid_origin", field: "allowedOrigins" },
    });
  });

  it("names the origin that is wrong", async () => {
    const { createKey } = await setup();
    const response = await createKey({
      kind: "publishable",
      allowedOrigins: ["https://ok.example.com", "http://shop.example.com"],
    });
    expect(await body(response)).toMatchObject({
      error: { message: '"http://shop.example.com" uses http://. Use https://, except for localhost.' },
    });
  });
});
