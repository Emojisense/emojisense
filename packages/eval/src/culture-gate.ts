/**
 * Culture eval gate (PULSE.md): with every approved culture entry active (all windows, all
 * regions), the canonical top-1 answer of every eval query must stay the same, and each entry's
 * triggers must surface its strongest emoji near the top.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CultureRecord, compileCulture, targetLocales } from "@emojisense/data/culture";
import { type AliasEngine, createEngine, type Pack } from "emojisense";
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
}

export interface TriggerMiss {
  cultureId: string;
  locale: string;
  trigger: string;
  emoji: string;
  rank: number;
}

export interface CultureGateResult {
  queries: number;
  triggers: number;
  topChanges: TopChange[];
  triggerMisses: TriggerMiss[];
}

export interface CultureGateInput {
  /** Directory with pack.<locale>.json and pack.<locale>.ext.json. */
  packDir: string;
  packVersion: string;
  records: readonly CultureRecord[];
  catalog: ReadonlyMap<string, string>;
  queries: readonly EvalQuery[];
}

export function runCultureGate(input: CultureGateInput): CultureGateResult {
  const { packDir, packVersion, records, catalog, queries } = input;
  const readPack = (name: string): Pack =>
    JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
  const engines = new Map<string, AliasEngine>();
  const engineFor = (locale: string): AliasEngine => {
    let engine = engines.get(locale);
    if (!engine) {
      const names = locale === "en" ? ["en", "en.ext"] : ["en", locale, "en.ext", `${locale}.ext`];
      const culture = compileCulture(records, locale, {
        packVersion,
        from: "2000-01-01",
        catalog,
        forceActive: true,
      });
      engine = createEngine(names.filter((n) => existsSync(join(packDir, `pack.${n}.json`))).map(readPack), {
        culture,
      });
      engines.set(locale, engine);
    }
    return engine;
  };

  const topChanges: TopChange[] = [];
  for (const q of queries) {
    const engine = engineFor(q.locale);
    const before = engine.search(q.q, { locale: q.locale, limit: 10, culture: false }).results[0];
    const after = engine.search(q.q, { locale: q.locale, limit: 10 }).results[0];
    if (before?.id !== after?.id) {
      topChanges.push({
        id: q.id,
        q: q.q,
        locale: q.locale,
        before: before?.emoji,
        after: after?.emoji,
        cultureId: after?.source === "culture" ? (after as { cultureId?: string }).cultureId : undefined,
      });
    }
  }

  const triggerMisses: TriggerMiss[] = [];
  let triggers = 0;
  for (const record of records.filter((r) => r.status === "approved")) {
    const strongest = [...record.emoji].sort((a, b) => b.weight - a.weight)[0];
    if (!strongest) continue;
    for (const locale of targetLocales(record)) {
      const engine = engineFor(locale);
      for (const trigger of record.triggers[locale] ?? []) {
        triggers++;
        const results = engine.search(trigger, { locale, limit: 10, prefix: false }).results;
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
  return { queries: queries.length, triggers, topChanges, triggerMisses };
}
