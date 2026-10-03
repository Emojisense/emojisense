import {
  type CustomEmojiRow,
  findCustomEmoji,
  listUsableCustomEmoji,
  type SqlReader,
} from "@emojisense/platform";

/** The Worker's read-only view of `custom_emoji`. Writes happen in the dashboard (and tenants API). */
export interface CustomEmojiReader {
  /** App-wide emoji plus those of the tenant with this external id; the tenant's win on a shortcode. */
  listUsable(appId: string, tenant?: string): Promise<CustomEmojiRow[]>;
  /** The external ids of the app's tenants that have custom emoji of their own. */
  listTenantsWithEmoji(appId: string): Promise<string[]>;
  find(appId: string, emojiId: string): Promise<CustomEmojiRow | undefined>;
}

const TENANTS_WITH_EMOJI = `
  SELECT t.external_id FROM tenants t
  WHERE t.app_id = ? AND EXISTS (SELECT 1 FROM custom_emoji ce WHERE ce.app_id = t.app_id AND ce.tenant_id = t.id)`;

export function createD1CustomEmojiReader(db: SqlReader): CustomEmojiReader {
  return {
    listUsable: (appId, tenant) => listUsableCustomEmoji(db, appId, tenant),
    listTenantsWithEmoji: async (appId) => {
      const { results } = await db.prepare(TENANTS_WITH_EMOJI).bind(appId).all<{ external_id: string }>();
      return results.map((row) => row.external_id);
    },
    find: (appId, emojiId) => findCustomEmoji(db, appId, emojiId),
  };
}
