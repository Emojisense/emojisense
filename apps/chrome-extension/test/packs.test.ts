import { PACK_LOCALES } from "emojisense";
import { describe, expect, it } from "vitest";
import { BUNDLED_LOCALES, packFiles } from "../src/shared/packs";

describe("bundled packs", () => {
  it("ship every pack language, core and ext, with the pack manifest", () => {
    expect(BUNDLED_LOCALES).toEqual(PACK_LOCALES);
    const files = packFiles();
    expect(files).toHaveLength(1 + 2 * PACK_LOCALES.length);
    expect(files[0]).toBe("manifest.json");
    for (const locale of PACK_LOCALES) {
      expect(files).toContain(`pack.${locale}.json`);
      expect(files).toContain(`pack.${locale}.ext.json`);
    }
  });

  it("list the core parts first, English first", () => {
    expect(packFiles(["en", "tr"])).toEqual([
      "manifest.json",
      "pack.en.json",
      "pack.tr.json",
      "pack.en.ext.json",
      "pack.tr.ext.json",
    ]);
  });
});
