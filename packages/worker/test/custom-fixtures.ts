import { createD1CustomEmojiReader } from "../src/custom-store.ts";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1.ts";

/** The pro test key (fixtures.ts KEYS.pro) belongs to this app. */
export const APP = "app_pro";

export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/**
 * The custom emoji tables on SQLite, read through the real platform queries. Rows: app-wide
 * :party_parrot: and :shipit:, and tenant "acme"'s own :shipit:.
 */
export function customEmojiDatabase() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO accounts (id, created_at) VALUES ('acc', 0);
    INSERT INTO apps (id, account_id, name, created_at) VALUES ('${APP}', 'acc', 'Chat', 0);
    INSERT INTO tenants (id, app_id, external_id, created_at) VALUES ('t_acme', '${APP}', 'acme', 0);
    INSERT INTO custom_emoji (id, app_id, tenant_id, shortcode, aliases, image_key, content_type, bytes, created_at)
    VALUES
      ('e_parrot', '${APP}', '', 'party_parrot', '["celebrate","dance"]', 'custom/${APP}/_/e_parrot.png', 'image/png', 11, 1),
      ('e_ship', '${APP}', '', 'shipit', '["ship it"]', 'custom/${APP}/_/e_ship.svg', 'image/svg+xml', 20, 2),
      ('e_acme', '${APP}', 't_acme', 'shipit', '["acme ship"]', 'custom/${APP}/t_acme/e_acme.gif', 'image/gif', 30, 3);`);
  return { db, reader: createD1CustomEmojiReader(sqliteD1(db)) };
}

/** R2 in memory, typed as the binding the Worker gets. */
export function memoryBucket(objects: Record<string, Uint8Array> = {}) {
  const store = new Map(Object.entries(objects));
  const bucket = {
    store,
    gets: [] as string[],
    async get(key: string) {
      bucket.gets.push(key);
      const bytes = store.get(key);
      if (!bytes) return null;
      return { body: new Blob([bytes.slice()]).stream(), size: bytes.byteLength, httpEtag: `"etag-${key}"` };
    },
  };
  return bucket as unknown as typeof bucket & R2Bucket;
}
