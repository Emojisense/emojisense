import { describe, expect, it } from "vitest";
import { importAll } from "../../src/app/lib/emojiImport";
import { createDb, importListing } from "../../src/app/mock/data";
import { handle } from "../../src/app/mock/handlers";
import type { CustomEmojiListResponse, EmojiImportResponse, UsageResponse } from "../../src/shared/contract";

const RELAY = "app_relay_prod";
const STAGING = "app_relay_staging";

function call(db: ReturnType<typeof createDb>, method: string, path: string, body: unknown = {}) {
  const form = body instanceof FormData ? body : null;
  return handle(db, {
    method,
    url: new URL(path, "http://localhost"),
    json: form ? {} : (body as Record<string, unknown>),
    form,
  });
}

function upload(shortcode: string, bytes: number) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], `${shortcode}.png`, { type: "image/png" }));
  form.set("shortcode", shortcode);
  return form;
}

describe("mock mode custom emoji", () => {
  it("lists used and limit for the whole account, like the Worker", async () => {
    const db = createDb("pro");
    await call(db, "POST", `/api/apps/${STAGING}/emoji`, upload("staging-only", 500));
    const { body } = await call(db, "GET", `/api/apps/${RELAY}/emoji`);
    const list = body as CustomEmojiListResponse;
    expect(list.limit).toBe(2_000);
    expect(list.used).toBe(list.emoji.length + 1);

    const usage = (await call(db, "GET", `/api/apps/${RELAY}/usage`)).body as UsageResponse;
    expect(usage.metrics.find((metric) => metric.metric === "custom_emoji")).toMatchObject({
      used: list.used,
      appUsed: list.emoji.length,
    });
  });

  it("answers uploads with the Worker's codes", async () => {
    const db = createDb("pro");
    const tooLarge = await call(db, "POST", `/api/apps/${RELAY}/emoji`, upload("huge", 256 * 1024 + 1));
    expect(tooLarge).toMatchObject({
      status: 413,
      body: { error: { code: "image_too_large", field: "file" } },
    });
    const taken = await call(db, "POST", `/api/apps/${RELAY}/emoji`, upload("shipit", 500));
    expect(taken).toMatchObject({ status: 409, body: { error: { code: "shortcode_taken" } } });
    const created = await call(db, "POST", `/api/apps/${RELAY}/emoji`, upload("new-one", 500));
    expect(created).toMatchObject({ status: 201, body: { shortcode: "new-one", tenantId: null } });
  });

  it("imports in batches of 50 until nothing remains", async () => {
    const db = createDb("pro");
    const token = "xoxp-mock-token";
    const listing = importListing("slack", token);
    const batches: EmojiImportResponse[] = [];
    const result = await importAll(async () => {
      const { body } = await call(db, "POST", `/api/apps/${RELAY}/emoji/import/slack`, { token });
      batches.push(body as EmojiImportResponse);
      return body as EmojiImportResponse;
    });

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.imported <= 50)).toBe(true);
    expect(result.remaining).toBe(0);
    // lgtm and plus-one were in Relay before the import.
    expect(result.skippedBy.exists).toBe(2);
    expect(result.imported).toBe(listing.candidates.length - 2);
  });
});
