import { describe, expect, it } from "vitest";
import { contentHash } from "../scripts/content-hash.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const pack = { name: "pack.en.json", bytes: bytes('{"emoji":[["🚀","1F680"]]}') };
const vectors = { name: "vectors.bin", bytes: bytes("ESVEC1") };

describe("contentHash", () => {
  it("is 16 hex digits and does not depend on the order of the parts", async () => {
    const hash = await contentHash([pack, vectors]);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(await contentHash([vectors, pack])).toBe(hash);
  });

  it("changes when a part's bytes or name change, or a part is added", async () => {
    const hash = await contentHash([pack, vectors]);
    const hotfix = { ...pack, bytes: bytes('{"emoji":[["🚀","1F680","rocket"]]}') };
    expect(await contentHash([hotfix, vectors])).not.toBe(hash);
    expect(await contentHash([{ ...pack, name: "pack.tr.json" }, vectors])).not.toBe(hash);
    expect(await contentHash([pack, vectors, { name: "pack.es.json", bytes: bytes("{}") }])).not.toBe(hash);
  });

  it("does not let bytes move between parts unnoticed", async () => {
    const a = [
      { name: "a", bytes: bytes("xy") },
      { name: "b", bytes: bytes("z") },
    ];
    const b = [
      { name: "a", bytes: bytes("x") },
      { name: "b", bytes: bytes("yz") },
    ];
    expect(await contentHash(a)).not.toBe(await contentHash(b));
  });
});
