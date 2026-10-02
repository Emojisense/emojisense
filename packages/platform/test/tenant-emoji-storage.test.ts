import { describe, expect, it } from "vitest";
import {
  checkSvg,
  createCustomEmojiStorage,
  inspectEmojiImage,
  MAX_EMOJI_BYTES,
  parseAliases,
  parseShortcode,
  toCustomEmoji,
} from "../src/tenant-emoji-storage.js";
import { memoryBucket, SqliteD1 } from "./sqlite-d1.js";

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)));
export const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13]);
const svg = (inner: string) =>
  bytes(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">${inner}</svg>`);

describe("image checks", () => {
  it("detects the type from the bytes", () => {
    expect(inspectEmojiImage(PNG)).toMatchObject({ ok: true, image: { contentType: "image/png" } });
    expect(inspectEmojiImage(bytes("GIF89a", [1, 0]))).toMatchObject({ image: { contentType: "image/gif" } });
    expect(inspectEmojiImage(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toMatchObject({
      image: { contentType: "image/webp" },
    });
    expect(inspectEmojiImage(bytes('﻿<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"></svg>'))).toMatchObject({
      image: { contentType: "image/svg+xml" },
    });
  });

  it("refuses other formats and oversized files", () => {
    expect(inspectEmojiImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({
      ok: false,
      error: "unsupported_image",
    });
    expect(inspectEmojiImage(bytes("<html><body>hi</body></html>"))).toMatchObject({
      error: "unsupported_image",
    });
    expect(inspectEmojiImage(bytes([0xc3, 0x28]))).toMatchObject({ error: "unsupported_image" });
    const large = new Uint8Array(MAX_EMOJI_BYTES + 1);
    large.set(PNG);
    expect(inspectEmojiImage(large)).toMatchObject({ ok: false, error: "image_too_large" });
  });

  it.each([
    ["<script>alert(1)</script>", "script"],
    ['<rect onload="alert(1)"/>', "event handler"],
    ["<rect/onclick=alert(1) />", "event handler"],
    ['<a href="javascript:alert(1)"><rect/></a>', "javascript"],
    ['<a href="&#106;avascript:alert(1)"><rect/></a>', "javascript"],
    ['<a href="&#x6A;ava&#x09;script:alert(1)"><rect/></a>', "javascript"],
    ['<image href="https://tracker.example/p.png"/>', "external"],
    ['<use xlink:href="https://evil.example/s.svg#x"/>', "external"],
    ["<foreignObject><div>hi</div></foreignObject>", "foreignObject"],
    ["<style>@import url(https://evil.example/x.css);</style>", "imports"],
    ['<rect style="fill:url(https://evil.example/x)"/>', "url()"],
  ])("refuses unsafe SVG: %s", (inner, reason) => {
    const result = inspectEmojiImage(svg(inner));
    expect(result).toMatchObject({ ok: false, error: "unsafe_svg" });
    expect(result.ok ? "" : result.message).toContain(reason);
  });

  it("refuses DOCTYPE and entity declarations", () => {
    expect(checkSvg('<!DOCTYPE svg [<!ENTITY a "b">]><svg></svg>')).toContain("DOCTYPE");
  });

  it("keeps safe SVG features", () => {
    const safe = svg(
      '<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="8" height="8"/>' +
        '<use href="#g"/><image href="data:image/png;base64,iVBORw0KGgo="/><text>one</text>',
    );
    expect(inspectEmojiImage(safe)).toMatchObject({ ok: true });
  });
});

describe("field parsing", () => {
  it("normalizes shortcodes", () => {
    expect(parseShortcode(":Party_Parrot:")).toEqual({ ok: true, value: "party_parrot" });
    expect(parseShortcode("+1")).toEqual({ ok: true, value: "+1" });
    expect(parseShortcode("party parrot")).toMatchObject({ ok: false, field: "shortcode" });
    expect(parseShortcode("x".repeat(65))).toMatchObject({ ok: false });
    expect(parseShortcode(undefined)).toMatchObject({ ok: false });
  });

  it("splits, normalizes and dedupes aliases", () => {
    expect(parseAliases(" Party  Time, party time ,,dance")).toEqual({
      ok: true,
      value: ["party time", "dance"],
    });
    expect(parseAliases(undefined)).toEqual({ ok: true, value: [] });
    expect(parseAliases(Array.from({ length: 21 }, (_, i) => `a${i}`).join(","))).toMatchObject({
      ok: false,
    });
    expect(parseAliases("x".repeat(65))).toMatchObject({ ok: false });
  });
});

describe("custom emoji storage", () => {
  function setup(limit = 10) {
    const db = new SqliteD1();
    const { accountId, appId } = db.seedApp();
    const bucket = memoryBucket();
    const storage = createCustomEmojiStorage({ db, bucket, now: () => 1000 });
    const image = { bytes: PNG, contentType: "image/png" as const };
    const put = (shortcode: string, tenantId: string | null = "ten_1", app = appId) =>
      storage.putCustomEmoji({
        appId: app,
        accountId,
        limit,
        tenantId,
        shortcode,
        aliases: ["party"],
        image,
        source: "api",
      });
    return { db, bucket, storage, put, accountId, appId };
  }

  it("stores the row and the image under the contract key", async () => {
    const { bucket, put, appId } = setup();
    const result = await put("parrot");
    if (!result.ok) throw new Error(result.error);
    const { emoji } = result;
    expect(emoji).toMatchObject({
      app_id: appId,
      tenant_id: "ten_1",
      shortcode: "parrot",
      aliases: '["party"]',
      content_type: "image/png",
      bytes: PNG.byteLength,
      source: "api",
      created_at: 1000,
    });
    expect(emoji.image_key).toBe(`custom/${appId}/ten_1/${emoji.id}.png`);
    expect(bucket.objects.get(emoji.image_key)).toEqual({ bytes: PNG, contentType: "image/png" });
    expect(toCustomEmoji(emoji, "https://api.example.com/", "acme")).toEqual({
      id: emoji.id,
      shortcode: "parrot",
      aliases: ["party"],
      imageUrl: `https://api.example.com/v1/custom/${appId}/${emoji.id}`,
      tenantId: "ten_1",
      tenantExternalId: "acme",
      source: "api",
      bytes: PNG.byteLength,
      createdAt: 1000,
    });
  });

  it("refuses a taken shortcode in the same scope, but not in another tenant", async () => {
    const { bucket, put } = setup();
    expect((await put("parrot")).ok).toBe(true);
    expect(await put("parrot")).toEqual({ ok: false, error: "shortcode_taken" });
    expect((await put("parrot", "ten_2")).ok).toBe(true);
    expect((await put("parrot", null)).ok).toBe(true);
    expect(bucket.objects.size).toBe(3);
  });

  it("counts every app of the account against the custom emoji limit", async () => {
    const { db, bucket, put, accountId } = setup(2);
    db.seedApp({ accountId, appId: "app_2" });
    expect((await put("one")).ok).toBe(true);
    expect((await put("two", null, "app_2")).ok).toBe(true);
    expect(await put("three")).toEqual({ ok: false, error: "limit_reached", used: 2, limit: 2 });
    expect(bucket.objects.size).toBe(2);
  });

  it("re-checks the limit inside the insert and removes the image when it loses a race", async () => {
    const { db, bucket, storage, accountId, appId } = setup(1);
    // Another upload lands between the pre-check and the insert.
    const racingBucket = {
      ...bucket,
      put: async (...args: Parameters<typeof bucket.put>) => {
        db.exec(
          `INSERT INTO custom_emoji (id, app_id, tenant_id, shortcode, image_key, content_type, bytes, created_at)
           VALUES ('other', ?, '', 'other', 'k', 'image/png', 1, 0)`,
          appId,
        );
        return bucket.put(...args);
      },
    };
    const racing = createCustomEmojiStorage({ db, bucket: racingBucket, now: () => 1 });
    const result = await racing.putCustomEmoji({
      appId,
      accountId,
      limit: 1,
      tenantId: null,
      shortcode: "late",
      aliases: [],
      image: { bytes: PNG, contentType: "image/png" },
      source: "api",
    });
    expect(result).toMatchObject({ ok: false, error: "limit_reached" });
    expect(bucket.objects.size).toBe(0);
    expect(await storage.countAccountCustomEmoji(accountId)).toBe(1);
  });

  it("lists and deletes within the scope only", async () => {
    const { bucket, storage, put, appId } = setup();
    await put("b");
    await put("a");
    await put("a", "ten_2");
    const listed = await storage.listCustomEmoji({ appId, tenantId: "ten_1" });
    expect(listed.map((e) => e.shortcode)).toEqual(["a", "b"]);

    const deleted = await storage.deleteCustomEmoji({ appId, tenantId: "ten_1", shortcode: "a" });
    expect(deleted?.shortcode).toBe("a");
    expect(bucket.objects.has(deleted?.image_key ?? "")).toBe(false);
    expect(await storage.deleteCustomEmoji({ appId, tenantId: "ten_1", shortcode: "a" })).toBeUndefined();
    expect((await storage.listCustomEmoji({ appId, tenantId: "ten_2" })).map((e) => e.shortcode)).toEqual([
      "a",
    ]);
    expect(bucket.objects.size).toBe(2);
  });
});
