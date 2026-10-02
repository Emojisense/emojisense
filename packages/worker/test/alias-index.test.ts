import { readFileSync } from "node:fs";
import type { Pack } from "emojisense";
import { buildEngineIndex, readEngineIndex } from "emojisense/engine-index";
import { describe, expect, it } from "vitest";
import packEnExt from "../src/generated/pack.en.ext.json";
import packEn from "../src/generated/pack.en.json";

describe("bundled alias index (src/generated/alias-index.en.bin)", () => {
  it("is the index this engine builds from the bundled packs, in src/index.ts order", () => {
    const packs = [packEn, packEnExt] as unknown as Pack[];
    const bundled = readFileSync(new URL("../src/generated/alias-index.en.bin", import.meta.url));
    expect(readEngineIndex(bundled, packs)).toBeDefined();
    // Same bytes: a core change that alters the index needs `pnpm --filter @emojisense/worker sync`.
    const fresh = buildEngineIndex(packs);
    expect(bundled.length).toBe(fresh.length);
    expect(bundled.every((byte, i) => byte === fresh[i])).toBe(true);
  });
});
