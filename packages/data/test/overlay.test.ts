import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { orderedAliases } from "../src/alias-order.ts";
import { loadOverlay, mergeOverlay, type OverlayRecord } from "../src/overlay.ts";
import type { LocaleEnrichment } from "../src/types.ts";

const base = (): LocaleEnrichment => ({
  desc: "Şaşkınlık.",
  synonym: ["şaşkın", "hayret"],
  slang: ["oha"],
  pop_culture: [],
  dev: [],
  typo: ["şaşkn"],
  intent: ["inanamıyorum", "Ağzım Açık Kaldı"],
  low: ["oha", "inanamıyorum"],
});

describe("mergeOverlay", () => {
  it("puts overlay phrases first in each list, top included, and keeps the base desc", () => {
    const merged = mergeOverlay(base(), {
      hexcode: "1F62E",
      emoji: "😮",
      top: ["şok oldum"],
      slang: ["vay be"],
      typo: ["şasırdım"],
    });
    expect(merged.desc).toBe("Şaşkınlık.");
    expect(merged.slang).toEqual(["vay be", "oha"]);
    expect(merged.typo).toEqual(["şasırdım", "şaşkn"]);
    expect(orderedAliases(merged, "1F62E tr")).toEqual([
      "şok oldum",
      "şaşkın",
      "hayret",
      "vay be",
      "oha",
      "inanamıyorum",
      "Ağzım Açık Kaldı",
    ]);
  });

  it("moves a base phrase to the overlay's place instead of repeating it (normalized)", () => {
    const merged = mergeOverlay(base(), { hexcode: "1F62E", emoji: "😮", top: ["ağzım açık kaldı"] });
    const aliases = orderedAliases(merged, "1F62E tr");
    expect(aliases[0]).toBe("ağzım açık kaldı");
    expect(aliases.filter((a) => a.toLocaleLowerCase("tr") === "ağzım açık kaldı")).toHaveLength(1);
  });

  it("lifts a phrase the overlay lists as an alias out of low, and demotes one it lists as low", () => {
    const merged = mergeOverlay(base(), {
      hexcode: "1F62E",
      emoji: "😮",
      intent: ["inanamıyorum"],
      low: ["hayret"],
    });
    expect(merged.low).toEqual(["hayret", "oha"]);
    expect(merged.synonym).toEqual(["şaşkın", "hayret"]);
  });

  it("adds no top list when neither side has one", () => {
    expect(mergeOverlay(base(), { hexcode: "1F62E", emoji: "😮", slang: ["vay"] }).top).toBeUndefined();
  });
});

describe("loadOverlay", () => {
  const dir = (files: Record<string, unknown>) => {
    const path = mkdtempSync(join(tmpdir(), "overlay-"));
    for (const [group, records] of Object.entries(files)) {
      writeFileSync(join(path, `${group}.json`), JSON.stringify(records));
    }
    return path;
  };
  const known = new Set(["1F62E", "1F602"]);
  const record = (hexcode: string, extra: Partial<OverlayRecord> = {}) => ({ hexcode, emoji: "x", ...extra });

  it("reads every group file of the locale", () => {
    const path = dir({ "smileys-emotion": [record("1F62E", { top: ["şok"] })], symbols: [record("1F602")] });
    const overlay = loadOverlay(path, ["smileys-emotion", "symbols", "flags"], known);
    expect([...overlay.keys()]).toEqual(["1F62E", "1F602"]);
  });

  it("fails on an unknown hexcode, naming the file", () => {
    const path = dir({ "smileys-emotion": [record("FFFFF")] });
    expect(() => loadOverlay(path, ["smileys-emotion"], known)).toThrow(
      /smileys-emotion\.json: FFFFF: unknown hexcode/,
    );
  });

  it("fails on a hexcode listed twice and on a malformed list", () => {
    const twice = dir({ a: [record("1F62E")], b: [record("1F62E")] });
    expect(() => loadOverlay(twice, ["a", "b"], known)).toThrow(/1F62E: listed twice/);
    const malformed = dir({ a: [record("1F62E", { slang: "vay" as unknown as string[] })] });
    expect(() => loadOverlay(malformed, ["a"], known)).toThrow(/"slang" must be an array of phrases/);
  });
});
