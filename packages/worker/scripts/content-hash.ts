export interface HashedPart {
  /** A stable name, e.g. the file name: renaming a part changes the hash. */
  name: string;
  bytes: Uint8Array;
}

/**
 * A short SHA-256 (16 hex digits) over named parts, independent of their order. The sync step
 * writes it to `config.json` as `contentHash`; the search cache key holds it, so new data or a
 * new engine under the same pack version never meets answers cached for the old ones.
 */
export async function contentHash(parts: readonly HashedPart[]): Promise<string> {
  const encoder = new TextEncoder();
  const chunks = [...parts]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap(({ name, bytes }) => [encoder.encode(`${name}\n${bytes.byteLength}\n`), bytes]);
  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
  return Array.from(digest.subarray(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
