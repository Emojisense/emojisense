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
  find(appId: string, emojiId: string): Promise<CustomEmojiRow | undefined>;
}

export function createD1CustomEmojiReader(db: SqlReader): CustomEmojiReader {
  return {
    listUsable: (appId, tenant) => listUsableCustomEmoji(db, appId, tenant),
    find: (appId, emojiId) => findCustomEmoji(db, appId, emojiId),
  };
}
