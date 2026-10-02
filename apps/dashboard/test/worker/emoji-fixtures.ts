import type { EmojiBucket } from "@emojisense/platform";
import { handleRequest } from "../../src/worker/app";
import { BASE, createAppFor, createHarness, type Harness } from "./harness";

export const API_URL = "https://api.test";

const encoder = new TextEncoder();

export const IMAGES = {
  png: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]),
  gif: encoder.encode("GIF89a\u0001\u0000\u0001\u0000"),
  svg: encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle r="4"/></svg>'),
  unsafeSvg: encoder.encode(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="4"/></svg>',
  ),
  text: encoder.encode("just text"),
};

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string | undefined;
}

/** R2 in memory. */
export function memoryBucket(): EmojiBucket & { objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    async put(key, value, options) {
      objects.set(key, { bytes: value, contentType: options?.httpMetadata?.contentType });
      return {};
    },
    async get(key) {
      const object = objects.get(key);
      return object
        ? { body: new Blob([object.bytes.slice()]).stream(), size: object.bytes.byteLength }
        : null;
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
}

export interface EmojiHarness {
  h: Harness;
  bucket: ReturnType<typeof memoryBucket>;
  cookie: string;
  appId: string;
  ownerId: string;
  setPlan(plan: string): void;
  /** Signs in another account and gives it `role` on the owner's apps (team_members). */
  member(login: string, role: "admin" | "developer" | "viewer"): Promise<string>;
  /** Inserts `count` app-wide rows directly, e.g. to reach a plan limit. */
  fill(count: number): void;
  upload(fields: Record<string, string | Blob>, cookie?: string): Promise<Response>;
}

export async function emojiHarness(plan = "solo"): Promise<EmojiHarness> {
  const bucket = memoryBucket();
  const h = createHarness({ EMOJI: bucket, API_URL });
  const cookie = await h.signIn();
  const appId = await createAppFor(h, cookie);
  const [owner] = h.db.rows<{ account_id: string }>("SELECT account_id FROM apps WHERE id = ?", appId);
  const ownerId = owner?.account_id ?? "";
  const setPlan = (next: string) => h.db.exec("UPDATE accounts SET plan = ? WHERE id = ?", next, ownerId);
  setPlan(plan);

  return {
    h,
    bucket,
    cookie,
    appId,
    ownerId,
    setPlan,
    async member(login, role) {
      const memberCookie = await h.signIn(login);
      const [account] = h.db.rows<{ id: string }>(
        "SELECT id FROM accounts WHERE email = ?",
        `${login}@dev.localhost`,
      );
      h.db.exec(
        "INSERT INTO team_members (owner_id, member_id, role, created_at) VALUES (?, ?, ?, 0)",
        ownerId,
        account?.id ?? "",
        role,
      );
      return memberCookie;
    },
    fill(count) {
      h.db.exec(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         INSERT INTO custom_emoji (id, app_id, shortcode, image_key, content_type, bytes, created_at)
         SELECT 'fill' || i, ?, 'fill' || i, 'k' || i, 'image/png', 1, 0 FROM n`,
        count,
        appId,
      );
    },
    async upload(fields, as = cookie) {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
      const request = new Request(`${BASE}/api/apps/${appId}/emoji`, {
        method: "POST",
        headers: { cookie: as, origin: BASE },
        body: form,
      });
      return handleRequest(request, h.env, { fetch: h.fetchMock, now: () => h.clock.now });
    },
  };
}

export const file = (bytes: Uint8Array, name = "emoji.png", type = "image/png") =>
  new File([bytes.slice()], name, { type });
