import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pack, PackRow } from "emojisense";
import { afterAll, describe, expect, it } from "vitest";
import {
  type HeldoutQuery,
  heldoutRegressions,
  localesOf,
  parseHeldout,
  scoreByLocale,
  toBaseline,
  worstMisses,
} from "../src/heldout.ts";
import { renderHeldoutReport } from "../src/heldout-report.ts";
import { runHeldoutSuite } from "../src/heldout-run.ts";
import { judge, macroAverage, type QueryOutcome, type Summary, summarize } from "../src/metrics.ts";

const valid = {
  id: "held-en-000",
  q: "dead",
  locale: "en",
  cat: "heldout-en",
  answers: ["💀"],
  persona: "a teenager in a group chat",
  labelled_by: "@cf/google/gemma-4-26b-a4b-it",
};
const line = (fields: Record<string, unknown>) => JSON.stringify({ ...valid, ...fields });
const query = (id: string, locale: string, answers = ["🙂"]): HeldoutQuery => ({
  ...valid,
  id,
  q: id,
  locale,
  cat: `heldout-${locale}`,
  answers,
});
const outcome = (id: string, rank: number, top: string[] = []): QueryOutcome => ({
  id,
  cat: "",
  rank,
  forbidHit: false,
  top,
});

describe("held-out loader", () => {
  it("parses the generator's format, skips blank lines and keeps extra fields", () => {
    const queries = parseHeldout(
      `${line({})}\n\n${line({ id: "held-tr-001", q: "gül", locale: "tr", cat: undefined, topic: "flowers" })}\n`,
    );
    expect(queries.map((q) => q.id)).toEqual(["held-en-000", "held-tr-001"]);
    expect(queries[1]?.cat).toBe("heldout-tr");
    expect(queries[1]?.topic).toBe("flowers");
  });

  it("names the line and the reason of an invalid query", () => {
    expect(() => parseHeldout(`${line({})}\n{oops`)).toThrow("heldout.jsonl line 2: not valid JSON");
    expect(() => parseHeldout(line({ locale: "de" }))).toThrow('line 1: held-en-000: locale "de"');
    expect(() => parseHeldout(line({ answers: [] }))).toThrow("answers must be a non-empty list");
    expect(() => parseHeldout(line({ answers: ["😀", ""] }))).toThrow("answers must be");
    expect(() => parseHeldout(line({ q: "  ?! " }))).toThrow("missing or empty q");
    expect(() => parseHeldout(line({ persona: "" }))).toThrow("missing persona");
    expect(() => parseHeldout(line({ labelled_by: undefined }))).toThrow("missing labelled_by");
    expect(() => parseHeldout(line({ cat: "exact" }))).toThrow('cat must be "heldout-en"');
    expect(() => parseHeldout(line({ id: "" }), "x.jsonl")).toThrow("x.jsonl line 1: missing id");
  });

  it("rejects a repeated id or a repeated query in one locale, and allows it across locales", () => {
    expect(() => parseHeldout(`${line({})}\n${line({ q: "other" })}`)).toThrow(
      "line 2: duplicate id held-en-000 (first on line 1)",
    );
    expect(() => parseHeldout(`${line({})}\n${line({ id: "b", q: " Dead " })}`)).toThrow("repeats line 1");
    expect(
      parseHeldout(
        `${line({ q: "café" })}\n${line({ id: "b", q: "café", locale: "fr", cat: "heldout-fr" })}`,
      ),
    ).toHaveLength(2);
  });

  it("lists locales in pack order, not file order", () => {
    expect(localesOf([query("a", "tr"), query("b", "en"), query("c", "zh")])).toEqual(["en", "zh", "tr"]);
  });
});

describe("held-out metrics", () => {
  it("counts a label with or without U+FE0F as a hit (the generator keeps the catalog form)", () => {
    expect(judge(query("a", "en", ["✨️"]), ["🙂", "✨"]).rank).toBe(2);
    expect(judge(query("a", "en", ["👍"]), ["👍️"]).rank).toBe(1);
  });

  it("scores each locale, all queries (micro) and the mean of locales (macro)", () => {
    const ranks: [string, number][] = [
      ["e1", 1],
      ["e2", 2],
      ["e3", 0],
      ["e4", 7],
      ["t1", 1],
      ["t2", 2],
    ];
    const queries = ranks.map(([id]) => query(id, id.startsWith("e") ? "en" : "tr"));
    const scores = scoreByLocale(
      queries,
      ranks.map(([id, rank]) => outcome(id, rank)),
    );
    expect(scores.byLocale.en).toMatchObject({ n: 4, r1: 25, r5: 50, r10: 75, mrr: 0.411 });
    expect(scores.byLocale.tr).toMatchObject({ n: 2, r1: 50, r5: 100, r10: 100, mrr: 0.75 });
    expect(scores.overall).toMatchObject({ n: 6, r1: 33.3, r5: 66.7, r10: 83.3, mrr: 0.524 });
    expect(scores.macro).toMatchObject({ n: 6, r1: 37.5, r5: 75, r10: 87.5 });
  });

  it("averages nothing to zero", () => {
    expect(macroAverage([])).toEqual({ n: 0, r1: 0, r5: 0, r10: 0, mrr: 0, forbidRate: 0 });
  });

  it("orders misses worst first: not found, then low rank, then missed by the other mode too", () => {
    const fused = [
      outcome("hit", 2),
      outcome("rank-7", 7),
      outcome("rank-9", 9),
      outcome("gone-a", 0),
      outcome("gone-b", 0),
      outcome("gone-c", 0),
    ];
    const alias = [outcome("gone-a", 4), outcome("gone-b", 0), outcome("gone-c", 6)];
    const misses = worstMisses(fused, { compareWith: alias });
    expect(misses.map((m) => m.id)).toEqual(["gone-b", "gone-c", "gone-a", "rank-9", "rank-7"]);
    expect(misses[0]).toMatchObject({ rank: 0, otherRank: 0 });
    expect(misses.at(-1)).not.toHaveProperty("otherRank");
    expect(worstMisses(fused, { limit: 2 })).toHaveLength(2);
    expect(worstMisses(fused, { k: 8 }).map((m) => m.id)).toEqual(["gone-a", "gone-b", "gone-c", "rank-9"]);
  });
});

describe("held-out soft gate", () => {
  const summary = (n: number, r5: number): Summary => ({ n, r1: 0, r5, r10: 0, mrr: 0.5, forbidRate: 0 });
  const scores = (all: number, en: number) => ({
    overall: summary(120, all),
    macro: summary(120, all),
    byLocale: { en: summary(60, en), tr: summary(60, 80) },
  });

  it("stores n, recall@5 and MRR per mode, overall and per locale", () => {
    expect(toBaseline([{ name: "alias", scores: scores(70, 60) }])).toEqual({
      alias: {
        all: { n: 120, r5: 70, mrr: 0.5 },
        en: { n: 60, r5: 60, mrr: 0.5 },
        tr: { n: 60, r5: 80, mrr: 0.5 },
      },
    });
  });

  it("warns beyond 2 points overall and 5 per locale, and skips what the baseline lacks", () => {
    const baseline = toBaseline([{ name: "alias", scores: scores(70, 60) }]);
    expect(heldoutRegressions(toBaseline([{ name: "alias", scores: scores(68, 55) }]), baseline)).toEqual([]);
    const warnings = heldoutRegressions(
      toBaseline([
        { name: "alias", scores: scores(67.9, 54.9) },
        { name: "fused", scores: scores(0, 0) },
      ]),
      baseline,
    );
    expect(warnings).toEqual([
      "held-out alias [all]: recall@5 67.9 < baseline 70 − 2 (n=120)",
      "held-out alias [en]: recall@5 54.9 < baseline 60 − 5 (n=60)",
    ]);
  });
});

describe("held-out suite on packs", () => {
  const dir = mkdtempSync(join(tmpdir(), "emojisense-heldout-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const row = (emoji: string, hexcode: string, label: string, alias: string): PackRow => [
    emoji,
    hexcode,
    0,
    1,
    0,
    label,
    "",
    "",
    alias,
    "",
    "",
  ];
  const pack = (locale: string, rows: PackRow[], part?: "ext"): Pack => ({
    format: "emojisense-pack",
    formatVersion: 1,
    packVersion: "test",
    locale,
    ...(part ? { part } : {}),
    emojiVersion: "17.0",
    groups: ["test"],
    emoji: rows,
  });
  const write = (name: string, value: Pack) =>
    writeFileSync(join(dir, `pack.${name}.json`), JSON.stringify(value));
  write(
    "en",
    pack("en", [row("😂", "1F602", "face with tears of joy", "lol"), row("🌹", "1F339", "rose", "")]),
  );
  write("en.ext", pack("en", [row("😂", "1F602", "", ""), row("🌹", "1F339", "", "")], "ext"));
  write(
    "tr",
    pack("tr", [row("😂", "1F602", "sevinç gözyaşları", "kahkaha"), row("🌹", "1F339", "gül", "")]),
  );
  write("tr.ext", pack("tr", [row("😂", "1F602", "", ""), row("🌹", "1F339", "", "")], "ext"));

  it("searches each locale with en + that locale, and skips fused when the vectors are missing", async () => {
    const queries = [query("held-en-1", "en", ["😂"]), query("held-tr-1", "tr", ["🌹"])];
    queries[0] = { ...(queries[0] as HeldoutQuery), q: "lol" };
    queries[1] = { ...(queries[1] as HeldoutQuery), q: "gül" };
    const run = await runHeldoutSuite({
      packDir: dir,
      queries,
      model: { key: "bge-m3", dims: 1024 },
      offline: true,
    });
    expect(run.locales).toEqual(["en", "tr"]);
    expect(run.modes.map((m) => m.name)).toEqual(["alias (core + ext)"]);
    expect(run.modes[0]?.outcomes.map((o) => o.rank)).toEqual([1, 1]);
    expect(run.skipped[0]).toMatch(/^fused bge-m3@1024: no vectors\.bge-m3\.1024\.bin/);

    const report = renderHeldoutReport(run, {
      date: "2026-10-02",
      packVersion: "test",
      inHouse: { source: "test", alias: summarize([outcome("x", 1)]) },
      gate: { baseline: false, warnings: [] },
    });
    expect(report).toContain("| tr Türkçe | 1 | 100 | 100 | 1 |");
    expect(report).toContain("| **All (micro)** | 2 | 100 | 100 | 1 |");
    expect(report).toContain("| Held-out, en + tr | 2 | 100 | 1 | – | – |");
    expect(report).toContain("### tr — Turkish (0 misses of 1)");
    expect(report).toContain("No `reports/heldout-baseline.json` yet.");

    const warned = renderHeldoutReport(run, {
      date: "2026-10-02",
      packVersion: "test",
      gate: { baseline: true, warnings: ["held-out alias [en]: recall@5 50 < baseline 60 − 5 (n=1)"] },
    });
    expect(warned).toContain("the held-out gate does not fail the build");
    expect(warned).toContain("- held-out alias [en]: recall@5 50 < baseline 60 − 5 (n=1)");
    expect(warned).not.toContain("Next to the in-house suite");
  });
});
