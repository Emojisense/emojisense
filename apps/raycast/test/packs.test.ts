import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_ROOT } from "@emojisense/data/paths";
import { createEngine, type Pack } from "emojisense";
import { afterAll, describe, expect, it } from "vitest";
import { toEmojiItem } from "../src/lib/format";
import { getEngine, loadPacks } from "../src/lib/packs";
import { en, tr } from "./fixture";

const dir = mkdtempSync(join(tmpdir(), "emojisense-raycast-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, "pack.en.json"), JSON.stringify(en));
writeFileSync(join(dir, "pack.tr.json"), JSON.stringify(tr));
writeFileSync(
  join(dir, "index.json"),
  JSON.stringify({ packVersion: "test", files: ["pack.en.json", "pack.tr.json"] }),
);

describe("bundled packs", () => {
  it("loads the packs in index order", () => {
    expect(loadPacks(dir).map((pack) => pack.locale)).toEqual(["en", "tr"]);
  });

  it("explains a missing build", () => {
    expect(() => loadPacks(join(dir, "missing"))).toThrow(/Run "pnpm build"/);
  });

  it("builds the engine once per directory", () => {
    const engine = getEngine(dir);
    expect(getEngine(dir)).toBe(engine);
    expect(engine.locales).toEqual(["en", "tr"]);
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
