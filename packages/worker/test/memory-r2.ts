import type { ShardBucket } from "../src/shards/storage.ts";

/**
 * An R2 stand-in with the list semantics the shard store relies on: sorted keys, `delimiter`
 * roll-ups into `delimitedPrefixes`, `limit` and `cursor` pages. Counts every call.
 */
export function memoryR2(now: () => number = Date.now) {
  const objects = new Map<
    string,
    { text: string; uploaded: Date; etag: string; cacheControl: string | undefined }
  >();
  const calls = { get: 0, put: 0, list: 0, delete: 0 };
  let version = 0;
  const bucket: ShardBucket = {
    async get(key) {
      calls.get++;
      const object = objects.get(key);
      return object ? { text: async () => object.text, httpEtag: `"${object.etag}"` } : null;
    },
    async put(key, value, options) {
      calls.put++;
      objects.set(key, {
        text: value,
        uploaded: new Date(now()),
        etag: `v${++version}`,
        cacheControl: options?.httpMetadata?.cacheControl,
      });
      return {};
    },
    async list({ prefix, delimiter, cursor, limit = 1000 }) {
      calls.list++;
      const items = new Map<string, { key: string; uploaded: Date } | undefined>();
      for (const [key, object] of objects) {
        if (!key.startsWith(prefix)) continue;
        const cut = delimiter ? key.indexOf(delimiter, prefix.length) : -1;
        if (cut >= 0) items.set(key.slice(0, cut + 1), undefined);
        else items.set(key, { key, uploaded: object.uploaded });
      }
      const sorted = [...items.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const start = Number(cursor ?? 0);
      const page = sorted.slice(start, start + limit);
      const truncated = start + limit < sorted.length;
      return {
        objects: page.flatMap(([, object]) => (object ? [object] : [])),
        delimitedPrefixes: page.flatMap(([key, object]) => (object ? [] : [key])),
        truncated,
        ...(truncated ? { cursor: String(start + limit) } : {}),
      };
    },
    async delete(keys) {
      calls.delete++;
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
  return {
    bucket,
    objects,
    calls,
    /** The bucket as the Env type wants it. */
    get r2() {
      return bucket as unknown as R2Bucket;
    },
    keys: (prefix = "") => [...objects.keys()].filter((k) => k.startsWith(prefix)).sort(),
    json: <T>(key: string) => JSON.parse(objects.get(key)?.text ?? "null") as T,
  };
}
