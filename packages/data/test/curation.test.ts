import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Curation,
  curatedAdditions,
  curateKeywords,
  curationAction,
  loadCurations,
} from "../src/curation.ts";

const curations: Curation[] = [
  { hexcode: "1F9B5", locale: "*", alias: "break a leg", action: "remove" },
  { hexcode: "1F6A2", locale: "en", alias: "Ship it!", action: "low" },
  { hexcode: "1F602", locale: "pt", phrase: "kkkk", action: "add" },
  { hexcode: "1F602", locale: "pt", phrase: "kkkkk", action: "add", field: "typo" },
];

const write = (value: unknown) => {
  const path = join(mkdtempSync(join(tmpdir(), "curation-")), "curation.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
};

describe("curation", () => {
  it("finds remove/low decisions by normalized alias, for one locale or every locale", () => {
    expect(curationAction(curations, "1F9B5", "fr", "break a leg")).toBe("remove");
    expect(curationAction(curations, "1F6A2", "en", "ship it")).toBe("low");
    expect(curationAction(curations, "1F6A2", "tr", "ship it")).toBeUndefined();
  });

  it("lists additions for one emoji and locale, as aliases unless a field is given", () => {
    expect(curatedAdditions(curations, "1F602", "pt")).toEqual([
      { phrase: "kkkk", field: "alias" },
      { phrase: "kkkkk", field: "typo" },
    ]);
    expect(curatedAdditions(curations, "1F602", "es")).toEqual([]);
  });

  it("splits CLDR keywords into kept and demoted ones and leaves removed ones out", () => {
    expect(curateKeywords(curations, "1F6A2", "en", ["boat", "SHIP IT", "ship"])).toEqual({
      keyword: ["boat", "ship"],
      low: ["SHIP IT"],
    });
    expect(curateKeywords(curations, "1F9B5", "es", ["pierna", "break a leg"])).toEqual({
      keyword: ["pierna"],
      low: [],
    });
  });

  it("never treats an addition as a remove/low decision", () => {
    expect(curationAction(curations, "1F602", "pt", "kkkk")).toBeUndefined();
  });

  it("loads the file and rejects malformed entries with their index", () => {
    expect(loadCurations(write(curations))).toHaveLength(4);
    expect(loadCurations(join(tmpdir(), "does-not-exist.json"))).toEqual([]);
    expect(() => loadCurations(write([{ hexcode: "1F602", locale: "pt", action: "add" }]))).toThrow(
      /\[0\]: "add" needs a "phrase"/,
    );
    expect(() =>
      loadCurations(write([{ hexcode: "1F602", locale: "pt", phrase: "x", action: "add", field: "low" }])),
    ).toThrow(/"field" must be "alias" or "typo"/);
    expect(() =>
      loadCurations(write([{ hexcode: "1F602", locale: "pt", alias: "x", action: "hide" }])),
    ).toThrow(/"action" must be/);
  });
});
