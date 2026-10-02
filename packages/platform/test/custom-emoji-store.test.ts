import { beforeEach, describe, expect, it } from "vitest";
import {
  CUSTOM_EMOJI_CACHE_CONTROL,
  CUSTOM_EMOJI_EDGE_CACHE_CONTROL,
  countAccountCustomEmoji,
  createCustomEmoji,
  deleteCustomEmoji,
  deleteCustomEmojiByShortcode,
  listCustomEmoji,
  listUsableCustomEmoji,
  type NewCustomEmoji,
  purgeCustomEmojiImages,
  removeImages,
  updateCustomEmoji,
} from "../src/custom-emoji-store.js";
import { IMAGES, pngImage } from "./fakes.js";
import { memoryBucket, SqliteD1 } from "./sqlite-d1.js";

describe("custom emoji store", () => {
  let db: SqliteD1;
  let bucket: ReturnType<typeof memoryBucket>;
  let accountId: string;
  let ids = 0;

  const emoji = (overrides: Partial<NewCustomEmoji> = {}): NewCustomEmoji => ({
    appId: "app1",
    accountId,
    tenantId: null,
    shortcode: `emoji${ids}`,
    aliases: [],
    image: pngImage(),
    source: "upload",
    limit: 10,
    now: 1_000 + ids,
    id: `e${++ids}`,
    ...overrides,
  });

  beforeEach(() => {
    db = new SqliteD1();
    bucket = memoryBucket();
    ids = 0;
    ({ accountId } = db.seedApp({ appId: "app1" }));
    db.seedApp({ accountId, appId: "app2" });
    db.seedApp({ accountId: "acc_other", appId: "app_other" });
    db.exec(`INSERT INTO tenants (id, app_id, external_id, created_at) VALUES
      ('t1', 'app1', 'acme', 0), ('t2', 'app1', 'globex', 0)`);
  });

  it("stores the image in R2 under the contract key, then the row", async () => {
    const result = await createCustomEmoji(db, bucket, emoji({ shortcode: "shipit", aliases: ["ship it"] }));
    expect(result).toMatchObject({
      status: "created",
      row: {
        id: "e1",
        app_id: "app1",
        tenant_id: "",
        shortcode: "shipit",
        aliases: '["ship it"]',
        image_key: "custom/app1/_/e1.png",
        content_type: "image/png",
        bytes: IMAGES.png.byteLength,
        source: "upload",
      },
    });
    expect(bucket.objects.get("custom/app1/_/e1.png")?.contentType).toBe("image/png");
    expect(await countAccountCustomEmoji(db, accountId)).toBe(1);
  });

  it("asks caches to keep the image forever", async () => {
    const puts: unknown[] = [];
    const watching = { ...bucket, put: async (...args: Parameters<typeof bucket.put>) => puts.push(args[2]) };
    await createCustomEmoji(db, watching, emoji());
    expect(puts).toEqual([
      { httpMetadata: { contentType: "image/png", cacheControl: CUSTOM_EMOJI_CACHE_CONTROL } },
    ]);
  });

  it("refuses a taken shortcode in the same scope and leaves no image behind", async () => {
    await createCustomEmoji(db, bucket, emoji({ shortcode: "shipit" }));
    expect(await createCustomEmoji(db, bucket, emoji({ shortcode: "shipit" }))).toEqual({
      status: "shortcode_taken",
    });
    expect([...bucket.objects.keys()]).toEqual(["custom/app1/_/e1.png"]);
  });

  it("lets a tenant reuse an app-wide shortcode", async () => {
    await createCustomEmoji(db, bucket, emoji({ shortcode: "shipit" }));
    const tenant = await createCustomEmoji(db, bucket, emoji({ shortcode: "shipit", tenantId: "t1" }));
    expect(tenant).toMatchObject({ status: "created", row: { image_key: "custom/app1/t1/e2.png" } });
  });

  it("counts every emoji of every app of the account against the limit, tenants included", async () => {
    await createCustomEmoji(db, bucket, emoji({ limit: 3 }));
    await createCustomEmoji(db, bucket, emoji({ limit: 3, tenantId: "t1" }));
    await createCustomEmoji(db, bucket, emoji({ limit: 3, appId: "app2" }));
    expect(await createCustomEmoji(db, bucket, emoji({ limit: 3, appId: "app2" }))).toEqual({
      status: "limit_reached",
      used: 3,
      limit: 3,
    });
    expect(bucket.objects.size).toBe(3);
    // Another account's emoji do not count.
    const other = await createCustomEmoji(
      db,
      bucket,
      emoji({ limit: 1, appId: "app_other", accountId: "acc_other" }),
    );
    expect(other.status).toBe("created");
    expect(await createCustomEmoji(db, bucket, emoji({ limit: Number.POSITIVE_INFINITY }))).toMatchObject({
      status: "created",
    });
  });

  it("enforces the limit inside the INSERT when a parallel upload got there first", async () => {
    // The pre-check sees 0 rows; another upload of the account lands before the INSERT runs.
    const racing = {
      ...bucket,
      put: async (...args: Parameters<typeof bucket.put>) => {
        db.exec(
          `INSERT INTO custom_emoji (id, app_id, shortcode, image_key, content_type, bytes, created_at)
           VALUES ('other', 'app2', 'other', 'k', 'image/png', 1, 0)`,
        );
        return bucket.put(...args);
      },
    };
    expect(await createCustomEmoji(db, racing, emoji({ limit: 1 }))).toMatchObject({
      status: "limit_reached",
    });
    expect(bucket.objects.size).toBe(0);
    expect(await countAccountCustomEmoji(db, accountId)).toBe(1);
  });

  it("lists all, app-wide only, or one tenant's emoji, newest first or by shortcode", async () => {
    await createCustomEmoji(db, bucket, emoji({ shortcode: "b" }));
    await createCustomEmoji(db, bucket, emoji({ shortcode: "x", tenantId: "t1" }));
    await createCustomEmoji(db, bucket, emoji({ shortcode: "a" }));
    await createCustomEmoji(db, bucket, emoji({ appId: "app2", shortcode: "d" }));
    const codes = (rows: { shortcode: string }[]) => rows.map((row) => row.shortcode);
    expect(codes(await listCustomEmoji(db, "app1"))).toEqual(["a", "x", "b"]);
    expect(codes(await listCustomEmoji(db, "app1", { tenantId: null }))).toEqual(["a", "b"]);
    expect(codes(await listCustomEmoji(db, "app1", { tenantId: null, order: "shortcode" }))).toEqual([
      "a",
      "b",
    ]);
    expect(codes(await listCustomEmoji(db, "app1", { tenantId: "t1" }))).toEqual(["x"]);
  });

  it("lists what a tenant can use: app-wide plus its own, its own winning on a shared shortcode", async () => {
    await createCustomEmoji(db, bucket, emoji({ id: "wide-ship", shortcode: "shipit" }));
    await createCustomEmoji(db, bucket, emoji({ id: "wide-cat", shortcode: "cat" }));
    await createCustomEmoji(db, bucket, emoji({ id: "acme-ship", shortcode: "shipit", tenantId: "t1" }));
    await createCustomEmoji(db, bucket, emoji({ id: "globex-dog", shortcode: "dog", tenantId: "t2" }));
    const idsOf = (rows: { id: string }[]) => rows.map((row) => row.id);
    expect(idsOf(await listUsableCustomEmoji(db, "app1", "acme"))).toEqual(["wide-cat", "acme-ship"]);
    expect(idsOf(await listUsableCustomEmoji(db, "app1"))).toEqual(["wide-cat", "wide-ship"]);
    expect(idsOf(await listUsableCustomEmoji(db, "app1", "unknown"))).toEqual(["wide-cat", "wide-ship"]);
  });

  it("renames and replaces aliases, refusing a taken shortcode", async () => {
    await createCustomEmoji(db, bucket, emoji({ shortcode: "a" }));
    await createCustomEmoji(db, bucket, emoji({ shortcode: "b" }));
    expect(await updateCustomEmoji(db, "app1", "e1", { shortcode: "a2", aliases: ["first"] })).toMatchObject({
      status: "updated",
      row: { shortcode: "a2", aliases: '["first"]' },
    });
    expect(await updateCustomEmoji(db, "app1", "e1", { aliases: [] })).toMatchObject({
      row: { shortcode: "a2", aliases: "[]" },
    });
    expect(await updateCustomEmoji(db, "app1", "e1", { shortcode: "b" })).toEqual({
      status: "shortcode_taken",
    });
    expect(await updateCustomEmoji(db, "app2", "e1", { shortcode: "x" })).toEqual({ status: "not_found" });
  });

  it("deletes a row and its image, scoped to the app", async () => {
    await createCustomEmoji(db, bucket, emoji({ shortcode: "a" }));
    expect(await deleteCustomEmoji(db, bucket, "app2", "e1")).toBeUndefined();
    expect(await deleteCustomEmoji(db, bucket, "app1", "e1")).toMatchObject({ id: "e1" });
    expect(bucket.objects.size).toBe(0);
    expect(await countAccountCustomEmoji(db, accountId)).toBe(0);
  });

  it("deletes by shortcode within one tenant only", async () => {
    await createCustomEmoji(db, bucket, emoji({ shortcode: "a" }));
    await createCustomEmoji(db, bucket, emoji({ shortcode: "a", tenantId: "t1" }));
    expect(await deleteCustomEmojiByShortcode(db, bucket, "app1", "t1", "a")).toMatchObject({ id: "e2" });
    expect(await deleteCustomEmojiByShortcode(db, bucket, "app1", "t1", "a")).toBeUndefined();
    expect([...bucket.objects.keys()]).toEqual(["custom/app1/_/e1.png"]);
  });

  it("logs a failed image delete without the key, and skips a missing bucket", async () => {
    const failing = {
      ...bucket,
      delete: async () => Promise.reject(new Error("R2 down for custom/app1/_/e1.png")),
    };
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      await removeImages(failing, ["custom/app1/_/e1.png"]);
      await removeImages(undefined, ["k"]);
    } finally {
      console.warn = warn;
    }
    expect(JSON.stringify(warnings)).toContain("emoji_image_delete_failed");
    expect(JSON.stringify(warnings)).not.toContain("app1");
  });

  it("purges deleted images from the Cache API at their public URLs, best effort", async () => {
    const deleted: string[] = [];
    const cache = { delete: async (url: string) => deleted.push(url) > 0 };
    await purgeCustomEmojiImages(cache, "https://api.test/", "app1", ["e1", "e2"]);
    expect(deleted).toEqual(["https://api.test/v1/custom/app1/e1", "https://api.test/v1/custom/app1/e2"]);

    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      await purgeCustomEmojiImages(
        { delete: () => Promise.reject(new Error("x")) },
        "https://api.test",
        "a",
        ["e"],
      );
      await purgeCustomEmojiImages(undefined, "https://api.test", "a", ["e"]);
    } finally {
      console.warn = warn;
    }
    expect(JSON.stringify(warnings)).toContain("emoji_image_purge_failed");
  });

  it("gives the edge a one-day lifetime and browsers an immutable one", () => {
    expect(CUSTOM_EMOJI_EDGE_CACHE_CONTROL).toBe("public, max-age=86400");
    expect(CUSTOM_EMOJI_CACHE_CONTROL).toContain("immutable");
  });
});
