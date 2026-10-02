import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPackConfig } from "@emojisense/data/config";
import { type CultureRecord, loadCatalog, loadRecords } from "@emojisense/data/culture";
import { DATA_ROOT } from "@emojisense/data/paths";
import type { Pack, PackRow } from "emojisense";
import { afterAll, describe, expect, it } from "vitest";
import { runCultureGate } from "../src/culture-gate.ts";
import { loadHeldout } from "../src/heldout.ts";
import { type EvalQuery, loadQueries } from "../src/queries.ts";

const row = (emoji: string, hexcode: string, label: string, keyword = ""): PackRow => [
  emoji,
  hexcode,
  0,
  1,
  0,
  label,
  "",
  keyword,
  "",
  "",
  "",
];
const pack = (part?: "ext"): Pack => ({
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  ...(part ? { part } : {}),
  emojiVersion: "17.0",
  groups: ["test"],
  emoji: part
    ? []
    : [
        row("🐐", "1F410", "goat", "animal"),
        row("⚽", "26BD", "soccer ball"),
        row("🎃", "1F383", "jack-o-lantern"),
      ],
});

const record = (overrides: Partial<CultureRecord>): CultureRecord => ({
  id: "goat-football",
  status: "approved",
  kind: "lasting",
  context: { en: "Football's greatest-of-all-time debate" },
  when: null,
  regions: ["*"],
  locales: ["en"],
  triggers: { en: ["goat"] },
  emoji: [{ hexcode: "26BD", weight: 0.6 }],
  source: "editorial",
  createdBy: "test",
  reviewedBy: "test",
  createdAt: "2026-10-02",
  ...overrides,
});

const query = (id: string, q: string): EvalQuery => ({ id, q, locale: "en", cat: "test", answers: [] });
const catalog = new Map([
  ["1F410", "🐐"],
  ["26BD", "⚽"],
  ["1F383", "🎃"],
]);

const dir = mkdtempSync(join(tmpdir(), "culture-gate-"));
writeFileSync(join(dir, "pack.en.json"), JSON.stringify(pack()));
writeFileSync(join(dir, "pack.en.ext.json"), JSON.stringify(pack("ext")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("culture gate", () => {
  const gate = (records: CultureRecord[], queries: EvalQuery[]) =>
    runCultureGate({ packDir: dir, packVersion: "test", records, catalog, queries });

  it("passes when culture only adds after the canonical top answer", () => {
    const result = gate([record({})], [query("q1", "goat")]);
    expect(result.topChanges).toEqual([]);
    expect(result.triggerMisses).toEqual([]);
  });

  it("reports a query whose top answer changes because the canonical list was empty", () => {
    const result = gate(
      [record({ triggers: { en: ["the beautiful game"] } })],
      [query("q2", "the beautiful game")],
    );
    expect(result.topChanges).toEqual([
      {
        id: "q2",
        q: "the beautiful game",
        locale: "en",
        before: undefined,
        after: "⚽",
        cultureId: "goat-football",
      },
    ]);
  });

  it("activates seasonal entries outside their window", () => {
    const halloween = record({
      id: "halloween",
      kind: "seasonal",
      when: { from: "10-15", to: "10-31", recurs: "yearly" },
      triggers: { en: ["spooky"] },
      emoji: [{ hexcode: "1F383", weight: 0.9 }],
    });
    expect(gate([halloween], [query("q3", "spooky")]).topChanges[0]?.cultureId).toBe("halloween");
  });

  it("reports a trigger that does not surface the entry's strongest emoji", () => {
    // 🦄 is in the catalog but not in the packs, so the engine cannot show it.
    const unicorn = record({ id: "unicorn", emoji: [{ hexcode: "1F984", weight: 0.9 }] });
    const result = runCultureGate({
      packDir: dir,
      packVersion: "test",
      records: [unicorn],
      catalog: new Map([...catalog, ["1F984", "🦄"]]),
      queries: [],
    });
    expect(result.triggerMisses).toEqual([
      { cultureId: "unicorn", locale: "en", trigger: "goat", emoji: "🦄", rank: 0 },
    ]);
  });

  it("accepts a strongest emoji that is already the canonical top answer", () => {
    const goat = record({ id: "goat", emoji: [{ hexcode: "1F410", weight: 0.9 }] });
    expect(gate([goat], []).triggerMisses).toEqual([]);
  });
});

const { packVersion } = readPackConfig();
const packDir = join(DATA_ROOT, "dist", "packs", packVersion);

// Needs the built packs (pnpm data:build); CI runs the same check as `culture:gate` after the build.
describe.skipIf(!existsSync(join(packDir, "pack.en.json")))("committed culture entries", () => {
  it("never change a top-1 answer of the eval suites and surface their emoji", () => {
    const root = new URL("..", import.meta.url).pathname;
    const queries = [
      ...loadQueries(join(root, "queries", "queries.jsonl")),
      ...loadHeldout(join(root, "queries", "heldout.jsonl")),
    ];
    const records = loadRecords().map((l) => l.record);
    const result = runCultureGate({ packDir, packVersion, records, catalog: loadCatalog(), queries });
    expect(result.topChanges).toEqual([]);
    expect(result.triggerMisses).toEqual([]);
    // Eleven locale engines are built from the full packs: allow a minute.
  }, 60_000);
});
