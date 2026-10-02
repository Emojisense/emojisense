import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_ROOT } from "@emojisense/data/paths";
import { createEngine, type Pack } from "emojisense";
import { afterAll, describe, expect, it } from "vitest";
import { loadBundledPacks } from "../src/packs.js";
import { emojiForText, searchEmoji, suggestReactions } from "../src/tools.js";
import { en, tr } from "./fixture.js";

const dir = mkdtempSync(join(tmpdir(), "emojisense-mcp-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("loadBundledPacks", () => {
  it("loads the packs in index order", () => {
    writeFileSync(join(dir, "pack.en.json"), JSON.stringify(en));
    writeFileSync(join(dir, "pack.tr.json"), JSON.stringify(tr));
    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify({ packVersion: "test", files: ["pack.en.json", "pack.tr.json"] }),
    );
    expect(loadBundledPacks(dir).map((p) => p.locale)).toEqual(["en", "tr"]);
  });

  it("rejects a file that is not a pack", () => {
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ format: "other" }));
    writeFileSync(join(dir, "index.json"), JSON.stringify({ packVersion: "test", files: ["bad.json"] }));
    expect(() => loadBundledPacks(dir)).toThrow(/not an emojisense pack/);
  });

  it("explains a missing build", () => {
    expect(() => loadBundledPacks(join(dir, "missing"))).toThrow(/Run the package build first/);
  });
});

// Smoke test on the real data (built by `pnpm data:build`, a dependency of this package's build).
describe("with the real packs", () => {
  const { packVersion } = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8")) as {
    packVersion: string;
  };
  const source = join(DATA_ROOT, "dist", "packs", packVersion);
  const files = ["pack.en.json", "pack.tr.json", "pack.en.ext.json", "pack.tr.ext.json"];
  const engine = createEngine(
    files.map((file) => JSON.parse(readFileSync(join(source, file), "utf8")) as Pack),
  );
  const top = (results: { emoji: string }[], n: number) => results.slice(0, n).map((r) => r.emoji);

  it("finds the README examples", async () => {
    expect(top((await searchEmoji({ engine }, { query: "jurassic park" })).structured.results, 3)).toContain(
      "🦖",
    );
    const lgtm = (await searchEmoji({ engine }, { query: "lgtm" })).structured.results;
    expect(lgtm.slice(0, 3).map((r) => r.id)).toContain("1F44D");
  });

  it("decorates a sentence and suggests reactions offline", async () => {
    const forText = await emojiForText({ engine }, { text: "Happy birthday, Sarah!" });
    expect(top(forText.structured.results, 3)).toEqual(expect.arrayContaining(["🎂"]));
    const reactions = await suggestReactions({ engine }, { text: "thanks for the help!" });
    expect(top(reactions.structured.results, 2)).toContain("🙏");
  });
});
