import { beforeEach, describe, expect, it } from "vitest";
import {
  CUSTOM_EMOJI_CACHE_CONTROL,
  countCustomEmoji,
  createCustomEmoji,
  deleteCustomEmoji,
  deleteCustomEmojiByShortcode,
  deleteTenantCustomEmoji,
  findTenantId,
  listCustomEmoji,
  listUsableCustomEmoji,
  type NewCustomEmoji,
  updateCustomEmoji,
} from "../src/custom-emoji-store.js";
import { validateEmojiImage } from "../src/emoji-image.js";
import { IMAGES, memoryBucket, sqliteDatabase } from "./fakes.js";

describe("custom emoji store", () => {
  let db: ReturnType<typeof sqliteDatabase>;
  let bucket: ReturnType<typeof memoryBucket>;
  let ids = 0;

  const emoji = (overrides: Partial<NewCustomEmoji> = {}): NewCustomEmoji => ({
    appId: "app1",
    tenantId: null,
    shortcode: `emoji${ids}`,
    aliases: [],
    image: validateEmojiImage(IMAGES.png),
    source: "upload",
    limit: 10,
    now: 1_000 + ids,
    id: `e${++ids}`,
    ...overrides,
  });

  beforeEach(() => {
    db = sqliteDatabase();
    bucket = memoryBucket();
    ids = 0;
    db.sqlite.exec(`
      INSERT INTO accounts (id, created_at) VALUES ('acc', 0);
      INSERT INTO apps (id, account_id, name, created_at) VALUES ('app1', 'acc', 'One', 0), ('app2', 'acc', 'Two', 0);
      INSERT INTO tenants (id, app_id, external_id, created_at) VALUES ('t1', 'app1', 'acme', 0), ('t2', 'app1', 'globex', 0);`);
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
    expect(bucket.objects.get("custom/app1/_/e1.png")).toMatchObject({
      contentType: "image/png",
      cacheControl: CUSTOM_EMOJI_CACHE_CONTROL,
    });
    expect(await countCustomEmoji(db, "app1")).toBe(1);
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

  it("counts every emoji of the app, tenants included, against the limit", async () => {
    await createCustomEmoji(db, bucket, emoji({ limit: 2 }));
    await createCustomEmoji(db, bucket, emoji({ limit: 2, tenantId: "t1" }));
    expect(await createCustomEmoji(db, bucket, emoji({ limit: 2 }))).toEqual({ status: "limit_reached" });
    expect(bucket.objects.size).toBe(2);
    expect(await createCustomEmoji(db, bucket, emoji({ limit: Number.POSITIVE_INFINITY }))).toMatchObject({
      status: "created",
    });
  });

  it("enforces the limit inside the INSERT when a parallel upload got there first", async () => {
    const racing = { ...db, prepare: db.prepare };
    let first = true;
    // The pre-check sees 0 rows; another upload lands before the INSERT runs.
    racing.prepare = (sql: string) => {
      if (first && sql.startsWith("INSERT")) {
        first = false;
        db.sqlite.exec(
          `INSERT INTO custom_emoji (id, app_id, shortcode, image_key, content_type, bytes, created_at)
           VALUES ('other', 'app1', 'other', 'k', 'image/png', 1, 0)`,
        );
      }
      return db.prepare(sql);
    };
    expect(await createCustomEmoji(racing, bucket, emoji({ limit: 1 }))).toEqual({ status: "limit_reached" });
    expect(bucket.objects.size).toBe(0);
  });

  it("lists all, app-wide only, or one tenant's emoji, newest first", async () => {
    await createCustomEmoji(db, bucket, emoji({ shortcode: "a" }));
    await createCustomEmoji(db, bucket, emoji({ shortcode: "b", tenantId: "t1" }));
    await createCustomEmoji(db, bucket, emoji({ shortcode: "c" }));
    await createCustomEmoji(db, bucket, emoji({ appId: "app2", shortcode: "d" }));
    const codes = (rows: { shortcode: string }[]) => rows.map((row) => row.shortcode);
    expect(codes(await listCustomEmoji(db, "app1"))).toEqual(["c", "b", "a"]);
    expect(codes(await listCustomEmoji(db, "app1", { tenantId: null }))).toEqual(["c", "a"]);
    expect(codes(await listCustomEmoji(db, "app1", { tenantId: "t1" }))).toEqual(["b"]);
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
    expect(await findTenantId(db, "app1", "acme")).toBe("t1");
    expect(await findTenantId(db, "app2", "acme")).toBeUndefined();
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
    expect(await countCustomEmoji(db, "app1")).toBe(0);
  });

  it("deletes by shortcode within one tenant, and all of a tenant's emoji", async () => {
    await createCustomEmoji(db, bucket, emoji({ shortcode: "a" }));
    await createCustomEmoji(db, bucket, emoji({ shortcode: "a", tenantId: "t1" }));
    await createCustomEmoji(db, bucket, emoji({ shortcode: "b", tenantId: "t1" }));
    expect(await deleteCustomEmojiByShortcode(db, bucket, "app1", "t1", "a")).toMatchObject({ id: "e2" });
    expect(await deleteTenantCustomEmoji(db, bucket, "app1", "t1")).toBe(1);
    expect([...bucket.objects.keys()]).toEqual(["custom/app1/_/e1.png"]);
  });
});
