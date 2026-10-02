import type { CustomEmoji } from "@emojisense/platform";
import { describe, expect, it } from "vitest";
import type { CustomEmojiListResponse, UsageResponse } from "../../src/shared/contract";
import { API_URL, emojiHarness, file, IMAGES, uploadTo } from "./emoji-fixtures";
import { body, createAppFor, createHarness } from "./harness";

describe("POST /api/apps/:id/emoji", () => {
  it("stores the image in R2 and returns the contract shape", async () => {
    const { appId, bucket, upload, h } = await emojiHarness();
    const response = await upload({
      file: file(IMAGES.png),
      shortcode: ":Party_Parrot:",
      aliases: "Celebrate!, dance, dance",
    });
    expect(response.status).toBe(201);
    const emoji = await body<CustomEmoji>(response);
    expect(emoji).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9]{20}$/),
      shortcode: "party_parrot",
      aliases: ["celebrate", "dance"],
      imageUrl: `${API_URL}/v1/custom/${appId}/${emoji.id}`,
      tenantId: null,
      source: "upload",
      bytes: IMAGES.png.byteLength,
      createdAt: h.clock.now,
    });
    expect(bucket.objects.get(`custom/${appId}/_/${emoji.id}.png`)).toMatchObject({
      contentType: "image/png",
    });
  });

  it("detects the type from the bytes, not the file name", async () => {
    const { appId, bucket, upload } = await emojiHarness();
    const response = await upload({ file: file(IMAGES.svg, "x.png", "image/png"), shortcode: "dot" });
    const emoji = await body<CustomEmoji>(response);
    expect(bucket.objects.get(`custom/${appId}/_/${emoji.id}.svg`)?.contentType).toBe("image/svg+xml");
  });

  it("answers 402 plan_required with the lowest plan that has custom emoji", async () => {
    const { upload, bucket } = await emojiHarness("free");
    const response = await upload({ file: file(IMAGES.png), shortcode: "a" });
    expect(response.status).toBe(402);
    expect(await body(response)).toEqual({
      error: {
        code: "plan_required",
        plan: "solo",
        message: "Custom emoji needs the Solo plan or higher. The current plan is Free.",
      },
    });
    expect(bucket.objects.size).toBe(0);
  });

  it("answers 402 at the plan limit, naming the next plan with room", async () => {
    const { upload, fill } = await emojiHarness("solo");
    fill(500);
    const response = await upload({ file: file(IMAGES.png), shortcode: "one_more" });
    expect(response.status).toBe(402);
    expect(await body(response)).toEqual({
      error: {
        code: "plan_required",
        plan: "pro",
        message:
          "Your Solo plan allows 500 custom emoji across all apps of the account, and all are used. Pro allows 2,000.",
      },
    });
  });

  it("counts the emoji of every app of the account against the limit", async () => {
    const { h, cookie, upload, fill, appId } = await emojiHarness("pro");
    fill(1_999);
    const otherApp = await createAppFor(h, cookie, { name: "Second" });
    expect((await uploadTo(h, otherApp, cookie, { file: file(IMAGES.png), shortcode: "fits" })).status).toBe(
      201,
    );
    const refused = await upload({ file: file(IMAGES.png), shortcode: "too_many" });
    expect(refused.status).toBe(402);
    expect(await body(refused)).toMatchObject({ error: { code: "plan_required", plan: "scale" } });
    const list = await body<CustomEmojiListResponse>(
      await h.call("GET", `/api/apps/${appId}/emoji`, { cookie }),
    );
    expect(list).toMatchObject({ used: 2_000, limit: 2_000 });
  });

  it("answers 403 plan_limit at the limit of the top plan", async () => {
    const { upload, fill } = await emojiHarness("scale");
    fill(10_000);
    const response = await upload({ file: file(IMAGES.png), shortcode: "one_more" });
    expect(response.status).toBe(403);
    expect(await body(response)).toMatchObject({ error: { code: "plan_limit" } });
  });

  it.each<[Record<string, string>, number, string, string]>([
    [{ shortcode: "ok" }, 400, "invalid_request", "file"],
    [{ file: "not a file", shortcode: "ok" }, 400, "invalid_request", "file"],
    [{ file: "png" }, 400, "invalid_request", "shortcode"],
    [{ file: "png", shortcode: "two words" }, 400, "invalid_request", "shortcode"],
    [{ file: "png", shortcode: "x".repeat(65) }, 400, "invalid_request", "shortcode"],
    [
      { file: "png", shortcode: "ok", aliases: Array.from({ length: 21 }, (_, i) => `a${i}`).join(",") },
      400,
      "invalid_request",
      "aliases",
    ],
    [{ file: "png", shortcode: "ok", tenantId: "nope" }, 400, "invalid_request", "tenantId"],
    [{ file: "text", shortcode: "ok" }, 415, "unsupported_image", "file"],
    [{ file: "unsafeSvg", shortcode: "ok" }, 400, "unsafe_svg", "file"],
  ])("rejects %j", async (fields, status, code, field) => {
    const { upload, bucket } = await emojiHarness();
    const form: Record<string, string | Blob> = { ...fields };
    const image = IMAGES[fields.file as keyof typeof IMAGES] as Uint8Array | undefined;
    if (image) form.file = file(image);
    const response = await upload(form);
    expect(response.status).toBe(status);
    expect(await body(response)).toMatchObject({ error: { code, field } });
    expect(bucket.objects.size).toBe(0);
  });

  it("rejects images over 256 KB with 413", async () => {
    const { upload } = await emojiHarness();
    const large = new Uint8Array(256 * 1024 + 1);
    large.set(IMAGES.png);
    const response = await upload({ file: file(large), shortcode: "big" });
    expect(response.status).toBe(413);
    expect(await body(response)).toMatchObject({ error: { code: "image_too_large", field: "file" } });
  });

  it("requires a multipart body", async () => {
    const { h, appId, cookie } = await emojiHarness();
    const response = await h.call("POST", `/api/apps/${appId}/emoji`, { cookie, body: { shortcode: "a" } });
    expect(response.status).toBe(415);
  });

  it("refuses a shortcode that exists in the same scope with 409", async () => {
    const { upload } = await emojiHarness();
    await upload({ file: file(IMAGES.png), shortcode: "shipit" });
    const again = await upload({ file: file(IMAGES.gif), shortcode: ":ShipIt:" });
    expect(again.status).toBe(409);
    expect(await body(again)).toMatchObject({ error: { code: "shortcode_taken", field: "shortcode" } });
  });

  it("stores tenant emoji under the tenant, next to an app-wide one with the same shortcode", async () => {
    const { h, appId, upload, bucket } = await emojiHarness("scale");
    h.db.exec("INSERT INTO tenants (id, app_id, external_id, created_at) VALUES ('t1', ?, 'acme', 0)", appId);
    await upload({ file: file(IMAGES.png), shortcode: "logo" });
    const response = await upload({ file: file(IMAGES.png), shortcode: "logo", tenantId: "t1" });
    expect(response.status).toBe(201);
    const emoji = await body<CustomEmoji>(response);
    expect(emoji.tenantId).toBe("t1");
    expect(bucket.objects.has(`custom/${appId}/t1/${emoji.id}.png`)).toBe(true);
  });

  it("answers 503 when the R2 binding is missing", async () => {
    const { h, upload } = await emojiHarness();
    h.env.EMOJI = undefined;
    expect((await upload({ file: file(IMAGES.png), shortcode: "a" })).status).toBe(503);
  });
});

describe("GET /api/apps/:id/emoji", () => {
  it("lists the app's emoji newest first with used and limit", async () => {
    const { h, appId, cookie, upload } = await emojiHarness("pro");
    await upload({ file: file(IMAGES.png), shortcode: "first" });
    h.clock.now += 1000;
    await upload({ file: file(IMAGES.gif), shortcode: "second" });
    const list = await body<CustomEmojiListResponse>(
      await h.call("GET", `/api/apps/${appId}/emoji`, { cookie }),
    );
    expect(list.emoji.map((e) => e.shortcode)).toEqual(["second", "first"]);
    expect(list).toMatchObject({ used: 2, limit: 2000 });
  });

  it("filters by tenant and counts every emoji of the app", async () => {
    const { h, appId, cookie, upload } = await emojiHarness("scale");
    h.db.exec("INSERT INTO tenants (id, app_id, external_id, created_at) VALUES ('t1', ?, 'acme', 0)", appId);
    await upload({ file: file(IMAGES.png), shortcode: "wide" });
    await upload({ file: file(IMAGES.png), shortcode: "mine", tenantId: "t1" });
    const list = await body<CustomEmojiListResponse>(
      await h.call("GET", `/api/apps/${appId}/emoji?tenantId=t1`, { cookie }),
    );
    expect(list.emoji.map((e) => e.shortcode)).toEqual(["mine"]);
    expect(list.used).toBe(2);
  });

  it("works on the free plan, with a limit of 0", async () => {
    const { h, appId, cookie } = await emojiHarness("free");
    const list = await body<CustomEmojiListResponse>(
      await h.call("GET", `/api/apps/${appId}/emoji`, { cookie }),
    );
    expect(list).toEqual({ emoji: [], used: 0, limit: 0 });
  });

  it("feeds the custom_emoji meter of the usage page: the account's stored emoji, this app's part", async () => {
    const { h, appId, cookie, upload, fill } = await emojiHarness("pro");
    fill(2);
    const otherApp = await createAppFor(h, cookie, { name: "Second" });
    await uploadTo(h, otherApp, cookie, { file: file(IMAGES.png), shortcode: "elsewhere" });
    await upload({ file: file(IMAGES.png), shortcode: "a" });
    const meter = async (period = "") => {
      const path = `/api/apps/${appId}/usage${period}`;
      const usage = await body<UsageResponse>(await h.call("GET", path, { cookie }));
      return usage.metrics.find((m) => m.metric === "custom_emoji");
    };
    expect(await meter()).toMatchObject({ used: 4, appUsed: 3, limit: 2000 });
    // A stock, not a monthly counter: an earlier month shows the same rows.
    expect(await meter("?period=2026-09")).toMatchObject({ used: 4, appUsed: 3 });
  });
});

describe("PATCH and DELETE /api/apps/:id/emoji/:emojiId", () => {
  async function withEmoji() {
    const harness = await emojiHarness();
    const created = await body<CustomEmoji>(
      await harness.upload({ file: file(IMAGES.png), shortcode: "shipit", aliases: "ship it" }),
    );
    const path = `/api/apps/${harness.appId}/emoji/${created.id}`;
    return { ...harness, created, path };
  }

  it("renames and replaces aliases", async () => {
    const { h, cookie, path } = await withEmoji();
    const response = await h.call("PATCH", path, {
      cookie,
      body: { shortcode: "ship-it", aliases: ["Deploy"] },
    });
    expect(response.status).toBe(200);
    expect(await body<CustomEmoji>(response)).toMatchObject({ shortcode: "ship-it", aliases: ["deploy"] });
    const aliasesOnly = await h.call("PATCH", path, { cookie, body: { aliases: "a, b" } });
    expect(await body<CustomEmoji>(aliasesOnly)).toMatchObject({ shortcode: "ship-it", aliases: ["a", "b"] });
  });

  it("validates the changes", async () => {
    const { h, cookie, path, upload } = await withEmoji();
    await upload({ file: file(IMAGES.png), shortcode: "taken" });
    expect((await h.call("PATCH", path, { cookie, body: {} })).status).toBe(400);
    const bad = await h.call("PATCH", path, { cookie, body: { shortcode: "a b" } });
    expect(await body(bad)).toMatchObject({ error: { code: "invalid_request", field: "shortcode" } });
    const taken = await h.call("PATCH", path, { cookie, body: { shortcode: "taken" } });
    expect(taken.status).toBe(409);
  });

  it("deletes the row and the image, then answers 404", async () => {
    const { h, cookie, path, bucket, created, appId } = await withEmoji();
    const response = await h.call("DELETE", path, { cookie });
    expect(await body(response)).toEqual({ ok: true });
    expect(bucket.objects.has(`custom/${appId}/_/${created.id}.png`)).toBe(false);
    expect((await h.call("DELETE", path, { cookie })).status).toBe(404);
    expect((await h.call("PATCH", path, { cookie, body: { aliases: [] } })).status).toBe(404);
  });

  it("still deletes after a downgrade to free", async () => {
    const { h, cookie, path, setPlan } = await withEmoji();
    setPlan("free");
    expect((await h.call("DELETE", path, { cookie })).status).toBe(200);
  });
});

describe("custom emoji access", () => {
  it("answers 404 to another account and 401 without a session", async () => {
    const { h, appId, upload } = await emojiHarness();
    const other = await h.signIn("mallory");
    expect((await h.call("GET", `/api/apps/${appId}/emoji`, { cookie: other })).status).toBe(404);
    expect((await upload({ file: file(IMAGES.png), shortcode: "a" }, other)).status).toBe(404);
    expect((await h.call("GET", `/api/apps/${appId}/emoji`)).status).toBe(401);
  });

  it("lets a viewer list but not change, and a developer change", async () => {
    const { h, appId, upload, member } = await emojiHarness("pro");
    const viewer = await member("vic", "viewer");
    const developer = await member("dev", "developer");
    expect((await h.call("GET", `/api/apps/${appId}/emoji`, { cookie: viewer })).status).toBe(200);
    const refused = await upload({ file: file(IMAGES.png), shortcode: "a" }, viewer);
    expect(refused.status).toBe(403);
    expect(await body(refused)).toMatchObject({ error: { code: "forbidden_role" } });
    const created = await upload({ file: file(IMAGES.png), shortcode: "a" }, developer);
    expect(created.status).toBe(201);
    const { id } = await body<CustomEmoji>(created);
    const path = `/api/apps/${appId}/emoji/${id}`;
    expect((await h.call("DELETE", path, { cookie: viewer })).status).toBe(403);
    expect((await h.call("PATCH", path, { cookie: viewer, body: { aliases: [] } })).status).toBe(403);
  });

  it("blocks writes from other origins", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    const response = await h.call("DELETE", "/api/apps/x/emoji/y", {
      cookie,
      origin: "https://evil.example",
    });
    expect(response.status).toBe(403);
  });
});

describe("custom emoji webhook events", () => {
  async function withWebhook() {
    const harness = await emojiHarness("scale");
    const { h, cookie, appId } = harness;
    const sent: { type: string; appId: string; data: CustomEmoji }[] = [];
    h.fetchMock.mockImplementation(async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    });
    const created = await h.call("POST", `/api/apps/${appId}/webhooks`, {
      cookie,
      body: {
        url: "https://hooks.example.com/emojisense",
        events: ["custom_emoji.created", "custom_emoji.deleted"],
      },
    });
    expect(created.status).toBe(201);
    return { ...harness, sent };
  }

  it("emits custom_emoji.created on upload and custom_emoji.deleted on delete", async () => {
    const { h, cookie, appId, upload, sent } = await withWebhook();
    const emoji = await body<CustomEmoji>(await upload({ file: file(IMAGES.png), shortcode: "shipit" }));
    await h.call("DELETE", `/api/apps/${appId}/emoji/${emoji.id}`, { cookie });
    await h.settle();
    expect(sent.map((event) => event.type)).toEqual(["custom_emoji.created", "custom_emoji.deleted"]);
    for (const event of sent) {
      expect(event).toMatchObject({ appId, data: { ...emoji, tenantExternalId: null } });
    }
  });

  it("names the tenant by its external id", async () => {
    const { h, appId, upload, sent } = await withWebhook();
    h.db.exec("INSERT INTO tenants (id, app_id, external_id, created_at) VALUES ('t1', ?, 'acme', 0)", appId);
    await upload({ file: file(IMAGES.png), shortcode: "logo", tenantId: "t1" });
    await h.settle();
    expect(sent[0]?.data).toMatchObject({ shortcode: "logo", tenantId: "t1", tenantExternalId: "acme" });
  });

  it("sends nothing when an upload is refused, or below Scale", async () => {
    const { h, upload, sent } = await withWebhook();
    await upload({ file: file(IMAGES.text), shortcode: "bad" });
    await h.settle();
    expect(sent).toEqual([]);

    const pro = await emojiHarness("pro");
    await pro.upload({ file: file(IMAGES.png), shortcode: "ok" });
    await pro.h.settle();
    expect(pro.h.fetchMock).not.toHaveBeenCalled();
  });
});
