import type { ResultStore } from "./store.ts";

/** The JSON text of one shard file; equal to `JSON.stringify(shard)` for the same entries. */
export function shardJson(key: string, queries: readonly string[], store: ResultStore): string {
  return `{"key":${JSON.stringify(key)},"entries":{${queries.map((q) => store.entryJson(q)).join(",")}}}`;
}

export const SHARD_INDEX_FILE = "index.json";

export const shardFileName = (key: string) => `${encodeURIComponent(key)}.json`;

/** UTF-8 length without Buffer or TextEncoder, so the build runs in Node and in the Worker. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
