/**
 * The site's own searches are pinned in the CDN shards (packages/data/enrichment/shard-queries.json),
 * so no visitor waits for Workers AI on a hero example or a demo. A shard answers normalized text
 * only; a query typed with accents or punctuation is left to the device and the API.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "emojisense";
import { describe, expect, it } from "vitest";
import { MEANING_QUERIES } from "../src/demos/meaning-queries";
import { heroExamples } from "../src/i18n/examples";
import { LOCALES } from "../src/i18n/locales";

interface SiteSearch {
  locale: string;
  query: string;
  where: string;
}

const curated = JSON.parse(
  readFileSync(join(process.cwd(), "../../packages/data/enrichment/shard-queries.json"), "utf8"),
) as { locale: string; query: string }[];
const pinned = new Set(curated.map(({ locale, query }) => `${locale}|${query}`));

const searches: SiteSearch[] = [
  ...LOCALES.flatMap((page) =>
    heroExamples(page).map((e) => ({ locale: e.lang ?? page, query: e.query, where: `${page} hero` })),
  ),
  ...MEANING_QUERIES.map((d) => ({ locale: "en", query: d.query, where: `${d.demo} demo` })),
];
const shardable = new Map<string, SiteSearch>();
for (const s of searches) {
  const key = `${s.locale}|${s.query}`;
  if (normalize(s.query) === s.query && !shardable.has(key)) shardable.set(key, s);
}

describe("CDN shard queries", () => {
  it.each([...shardable.values()])("pins “$query” ($locale, $where)", ({ locale, query }) => {
    expect(pinned.has(`${locale}|${query}`), "add it to packages/data/enrichment/shard-queries.json").toBe(
      true,
    );
  });
});
