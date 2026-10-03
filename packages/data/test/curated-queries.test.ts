import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALE_CODES } from "../src/locales.ts";
import { ENRICHMENT_DIR } from "../src/paths.ts";
import { CURATED_COUNT, curatedRows, loadCuratedQueries } from "../src/shards/curated.ts";
import { aggregateQueries } from "../src/shards/queries.ts";

const LOCALES = ["en", "tr"];

const write = (value: unknown) => {
  const path = join(mkdtempSync(join(tmpdir(), "shard-queries-")), "shard-queries.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
};

describe("curated shard queries", () => {
  it("loads entries and treats a missing file as none", () => {
    const path = write([
      { locale: "en", query: "mbappe", why: "landing hero" },
      { locale: "tr", query: "kolay gelsin" },
    ]);
    expect(loadCuratedQueries(path, LOCALES)).toHaveLength(2);
    expect(loadCuratedQueries(join(tmpdir(), "does-not-exist.json"), LOCALES)).toEqual([]);
  });

  it("rejects text a shard can never answer: not normalized, or dropped by the privacy filter", () => {
    expect(() => loadCuratedQueries(write([{ locale: "en", query: "Mbappé" }]), LOCALES)).toThrow(
      /\[0\].*"mbappe"/,
    );
    expect(() => loadCuratedQueries(write([{ locale: "en", query: "jane1987" }]), LOCALES)).toThrow(
      /privacy filter.*code/,
    );
  });

  it("rejects unknown locales, empty queries and duplicates", () => {
    expect(() => loadCuratedQueries(write([{ locale: "xx", query: "mbappe" }]), LOCALES)).toThrow(/locale/);
    expect(() => loadCuratedQueries(write([{ locale: "en", query: " " }]), LOCALES)).toThrow(/query/);
    expect(() =>
      loadCuratedQueries(
        write([
          { locale: "en", query: "mbappe" },
          { locale: "en", query: "mbappe" },
        ]),
        LOCALES,
      ),
    ).toThrow(/\[1\].*twice/);
  });

  it("survives the query cap that cuts synthetic queries", () => {
    const curated = [{ locale: "en", query: "mbappe" }];
    const synthetic = Array.from({ length: 5 }, (_, i) => ({ q: `feeling ${i}`, n: 50, locale: "en" }));
    const kept = aggregateQueries([...synthetic, ...curatedRows(curated, "en")], {
      minCount: 5,
      maxQueries: 3,
    });
    expect(kept[0]).toEqual({ q: "mbappe", n: CURATED_COUNT, locales: ["en"] });
    expect(curatedRows(curated, "tr")).toEqual([]);
  });

  it("keeps enrichment/shard-queries.json loadable", () => {
    const path = join(ENRICHMENT_DIR, "shard-queries.json");
    const entries = JSON.parse(readFileSync(path, "utf8")) as unknown[];
    expect(loadCuratedQueries(path, LOCALE_CODES)).toHaveLength(entries.length);
  });
});
