import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_ROOT } from "@emojisense/data/paths";
import { createEngine, type Pack } from "emojisense";
import { afterAll, describe, expect, it } from "vitest";
import { toEmojiItem } from "../src/lib/format";
import { bundledLocales, getEngine, loadPacks } from "../src/lib/packs";
import { en, pt, tr } from "./fixture";

const dir = mkdtempSync(join(tmpdir(), "emojisense-raycast-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, "pack.en.json"), JSON.stringify(en));
writeFileSync(join(dir, "pack.pt.json"), JSON.stringify(pt));
writeFileSync(join(dir, "pack.tr.json"), JSON.stringify(tr));
writeFileSync(join(dir, "pack.tr.ext.json"), JSON.stringify({ ...tr, part: "ext" }));
writeFileSync(
  join(dir, "index.json"),
  JSON.stringify({
    packVersion: "test",
    files: ["pack.en.json", "pack.pt.json", "pack.tr.json", "pack.tr.ext.json"],
  }),
);

describe("bundled packs", () => {
  it("loads the packs in index order", () => {
    expect(loadPacks(dir).map((pack) => pack.locale)).toEqual(["en", "pt", "tr", "tr"]);
  });

  it("lists the bundled locales once each, English first", () => {
    expect(bundledLocales(dir)).toEqual(["en", "pt", "tr"]);
  });

  it("loads only the packs of the given locales, core and ext", () => {
    const packs = loadPacks(dir, ["tr", "en"]);
    expect(packs.map((pack) => [pack.locale, pack.part ?? "core"])).toEqual([
      ["en", "core"],
      ["tr", "core"],
      ["tr", "ext"],
    ]);
  });

  it("explains a missing build", () => {
    expect(() => loadPacks(join(dir, "missing"))).toThrow(/Run "pnpm build"/);
  });

  it("builds the engine once per directory and language set", () => {
    const engine = getEngine(dir, ["en", "tr"]);
    expect(getEngine(dir, ["en", "tr"])).toBe(engine);
    expect(engine.locales).toEqual(["en", "tr"]);
    expect(getEngine(dir, ["en", "pt"]).locales).toEqual(["en", "pt"]);
  });

  it("never matches a phrase of a language the user does not read", () => {
    const ids = (locales: string[]) =>
      getEngine(dir, locales)
        .search("nato")
        .results.map((r) => r.id);
    expect(ids(["en", "tr"])).not.toContain("1F468-200D-1F9B2");
    expect(ids(["en", "pt"])).toContain("1F468-200D-1F9B2");
  });
});

// Smoke test on the real data (built by `pnpm data:build`, a dependency of this app's build).
describe("with the real packs", () => {
  const { packVersion } = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8")) as {
    packVersion: string;
  };
  const source = join(DATA_ROOT, "dist", "packs", packVersion);
  const files = ["pack.en.json", "pack.tr.json", "pack.en.ext.json", "pack.tr.ext.json"];
  const engine = createEngine(
    files.map((file) => JSON.parse(readFileSync(join(source, file), "utf8")) as Pack),
  );

  it("explains why the README examples match", () => {
    const items = engine.search("greatest of all time").results.map((r) => toEmojiItem(engine, r, "en"));
    expect(items[0]).toMatchObject({ emoji: "🐐", subtitle: "“greatest of all time”", kind: "alias" });
  });

  it("answers within a keystroke budget", () => {
    const started = performance.now();
    for (const query of ["s", "sh", "shi", "ship", "ship ", "ship i", "ship it"]) engine.search(query);
    expect((performance.now() - started) / 7).toBeLessThan(16);
  });
});
