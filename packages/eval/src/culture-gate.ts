/**
 * Culture eval gate (PULSE.md): with every approved culture entry active (all windows, all
 * regions), the canonical top-1 answer of every eval query must stay the same, and each entry's
 * triggers must surface its strongest emoji near the top.
 *
 * Regional senses (`kind: "regional"`) are the one kind that may take rank 1, and only when a
 * search names a region in their scope. They get their own checks: in scope, each trigger leads
 * with the entry's strongest emoji and keeps the canonical answer second; out of scope, nothing
 * changes; and in scope, no eval query other than a trigger changes its top-1 answer.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CultureRecord, compileCulture, probeRegions, targetLocales } from "@emojisense/data/culture";
import { type AliasEngine, createEngine, normalize, type Pack, type SearchResult } from "emojisense";
import type { EvalQuery } from "./queries.ts";

/** The strongest emoji of an entry must be in this many results for each of its triggers. */
export const TRIGGER_TOP_N = 3;

export interface TopChange {
  id: string;
  q: string;
  locale: string;
  before: string | undefined;
  after: string | undefined;
  cultureId: string | undefined;
  /** Set when the change happened with a region (the regional checks). */
  region?: string;
}

export interface TriggerMiss {
  cultureId: string;
  locale: string;
  trigger: string;
  emoji: string;
  rank: number;
}

export interface RegionalIssue {
  cultureId: string;
  locale: string;
  trigger: string;
  region: string;
  problem: string;
  /**
   * False for an entry whose canonical answer is no longer one it `outranks` (it stopped leading
   * and needs an editor). True for anything that breaks the rules: the gate fails.
   */
  blocking: boolean;
}

export interface CultureGateResult {
  queries: number;
  triggers: number;
  topChanges: TopChange[];
  /** Top-1 changes among `hiddenQueries`: a count only, the queries are never reported. */
  hiddenTopChanges: number;
  triggerMisses: TriggerMiss[];
  /** Regional entries checked, and the trigger × region probes run for them. */
  regionalEntries: number;
  regionalProbes: number;
  regionalIssues: RegionalIssue[];
}

export interface CultureGateInput {
  /** Directory with pack.<locale>.json and pack.<locale>.ext.json. */
  packDir: string;
  packVersion: string;
  records: readonly CultureRecord[];
  catalog: ReadonlyMap<string, string>;
  /** Queries whose changes are reported in full (the in-house suite). */
  queries: readonly EvalQuery[];
  /** Queries whose changes are only counted (the held-out suite: its text never leaves the run). */
  hiddenQueries?: readonly EvalQuery[];
}

const LIMIT = 10;

export function runCultureGate(input: CultureGateInput): CultureGateResult {
  const { packDir, packVersion, records, catalog, queries, hiddenQueries = [] } = input;
  const approved = records.filter((r) => r.status === "approved");
  const readPack = (name: string): Pack =>
    JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
  const bases = new Map<string, AliasEngine>();
  const baseFor = (locale: string): AliasEngine => {
    let engine = bases.get(locale);
    if (!engine) {
      const names = locale === "en" ? ["en", "en.ext"] : ["en", locale, "en.ext", `${locale}.ext`];
      engine = createEngine(names.filter((n) => existsSync(join(packDir, `pack.${n}.json`))).map(readPack));
      bases.set(locale, engine);
    }
    return engine;
  };
  const engines = new Map<string, AliasEngine>();
  const engineFor = (locale: string): AliasEngine => {
    let engine = engines.get(locale);
    if (!engine) {
      const culture = compileCulture(records, locale, {
        packVersion,
        from: "2000-01-01",
        catalog,
        forceActive: true,
      });
      engine = baseFor(locale).withCulture(culture);
      engines.set(locale, engine);
    }
    return engine;
  };

  const topChange = (q: EvalQuery, engine: AliasEngine, region?: string): TopChange | undefined => {
    const scope = region ? { region } : {};
    const before = engine.search(q.q, { locale: q.locale, limit: LIMIT, culture: false }).results[0];
    const after = engine.search(q.q, { locale: q.locale, limit: LIMIT, ...scope }).results[0];
    if (before?.id === after?.id) return undefined;
    return {
      id: q.id,
      q: q.q,
      locale: q.locale,
      before: before?.emoji,
      after: after?.emoji,
      cultureId: after?.source === "culture" ? (after as { cultureId?: string }).cultureId : undefined,
      ...scope,
    };
  };

  const topChanges = queries.flatMap((q) => topChange(q, engineFor(q.locale)) ?? []);
  let hiddenTopChanges = hiddenQueries.filter((q) => topChange(q, engineFor(q.locale))).length;

  const triggerMisses: TriggerMiss[] = [];
  let triggers = 0;
  for (const record of approved) {
    const strongest = strongestOf(record);
    if (!strongest) continue;
    for (const locale of targetLocales(record)) {
      const engine = engineFor(locale);
      for (const trigger of record.triggers[locale] ?? []) {
        triggers++;
        const results = engine.search(trigger, { locale, limit: LIMIT, prefix: false }).results;
        const rank = results.findIndex((r) => r.id === strongest.hexcode) + 1;
        if (rank === 0 || rank > TRIGGER_TOP_N) {
          triggerMisses.push({
            cultureId: record.id,
            locale,
            trigger,
            emoji: catalog.get(strongest.hexcode) ?? strongest.hexcode,
            rank,
          });
        }
      }
    }
  }

  const regional = approved.filter((r) => r.kind === "regional");
  const regionalIssues: RegionalIssue[] = [];
  let regionalProbes = 0;
  const glyph = (result: SearchResult | undefined) => result?.emoji ?? "—";
  for (const record of regional) {
    const strongest = strongestOf(record);
    if (!strongest) continue;
    const probes = probeRegions(record);
    const outranks = new Set(record.outranks ?? []);
    for (const locale of targetLocales(record)) {
      // This entry alone, in its real scope: the lead depends on the region.
      const culture = compileCulture([record], locale, { packVersion, from: "2000-01-01", catalog });
      const engine = baseFor(locale).withCulture(culture);
      const triggerSet = new Set(record.triggers[locale] ?? []);
      for (const trigger of triggerSet) {
        regionalProbes++;
        const issue = (region: string, problem: string, blocking = true) =>
          regionalIssues.push({ cultureId: record.id, locale, trigger, region, problem, blocking });
        const options = { locale, limit: LIMIT, prefix: false };
        const top = engine.search(trigger, { ...options, culture: false }).results[0];
        const inside = engine.search(trigger, { ...options, region: probes.inside }).results;
        if (top === undefined || !outranks.has(top.id)) {
          issue(
            probes.inside,
            `canonical top is ${glyph(top)}, not one it outranks: the entry no longer leads`,
            false,
          );
        } else if (inside[0]?.id !== strongest.hexcode || inside[1]?.id !== top.id) {
          issue(
            probes.inside,
            `expected ${catalog.get(strongest.hexcode)} then ${top.emoji}, got ${glyph(inside[0])} ${glyph(inside[1])}`,
          );
        }
        if (probes.outside) {
          const outside = engine.search(trigger, { ...options, region: probes.outside }).results[0];
          if (outside?.id !== top?.id) {
            issue(probes.outside, `top changed out of scope: ${glyph(top)} → ${glyph(outside)}`);
          }
        }
      }
      // In scope, only the entry's own triggers may change a top-1 answer.
      const ownTrigger = (q: EvalQuery) => triggerSet.has(normalize(q.q));
      for (const q of queries) {
        if (q.locale !== locale || ownTrigger(q)) continue;
        const change = topChange(q, engine, probes.inside);
        if (change) topChanges.push(change);
      }
      hiddenTopChanges += hiddenQueries.filter(
        (q) => q.locale === locale && !ownTrigger(q) && topChange(q, engine, probes.inside),
      ).length;
    }
  }

  return {
    queries: queries.length + hiddenQueries.length,
    triggers,
    topChanges,
    hiddenTopChanges,
    triggerMisses,
    regionalEntries: regional.length,
    regionalProbes,
    regionalIssues,
  };
}

function strongestOf(record: CultureRecord) {
  return [...record.emoji].sort((a, b) => b.weight - a.weight)[0];
}
