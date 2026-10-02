import {
  type CultureGateResult,
  type CultureRecord,
  type DatedSource,
  type Exclusion,
  type GateQuery,
  previewRecord,
  type RecordPreview,
  runCultureGateWith,
  targetLocales,
  validateRecord,
} from "@emojisense/data/culture-core";
import type { CultureIssue, CulturePreview } from "@emojisense/platform";
import type { AliasEngine } from "emojisense";
import type { Env } from "../env.ts";

/**
 * What culture Phase 2 needs besides the bindings: the catalog and the policy files bundled with
 * the Worker (index.ts imports them; tests pass fixtures).
 */
export interface CultureRuntime {
  packVersion: string;
  /** hexcode → emoji. The bundled English pack has every base emoji of the catalog. */
  catalog: ReadonlyMap<string, string>;
  /** culture/exclusions.txt, parsed. */
  exclusions: readonly Exclusion[];
  /** The in-house eval suite: the canonical answers the culture gate protects. */
  gateQueries: readonly GateQuery[];
  /** culture/prompts/propose.<CULTURE_PROMPT_VERSION>.md, split. */
  prompt: { system: string; user: string };
  /** Holidays and events (culture/sources/calendar.json and events.json). */
  sources: readonly DatedSource[];
  /** The canonical alias engine of a pack locale (no culture); undefined when it cannot load. */
  engine(locale: string, env: Env): Promise<AliasEngine | undefined>;
}

/** Validation errors and warnings of a record with the bundled catalog and exclusions. */
export function validate(runtime: CultureRuntime, record: CultureRecord): CultureIssue[] {
  return validateRecord(record, { catalog: runtime.catalog, exclusions: runtime.exclusions }).map((i) => ({
    level: i.level,
    message: i.message,
  }));
}

/** The record with only one locale's triggers and context, for a per-locale gate run. */
function forLocale(record: CultureRecord, locale: string): CultureRecord {
  return {
    ...record,
    locales: [locale],
    triggers: record.triggers[locale] ? { [locale]: record.triggers[locale] } : {},
  };
}

const emptyGate = (): CultureGateResult => ({
  queries: 0,
  triggers: 0,
  topChanges: [],
  hiddenTopChanges: 0,
  triggerMisses: [],
  regionalEntries: 0,
  regionalProbes: 0,
  regionalIssues: [],
});

/** Adds one locale's gate result to a running total. */
function addGate(total: CultureGateResult, result: CultureGateResult): void {
  total.queries += result.queries;
  total.triggers += result.triggers;
  total.topChanges.push(...result.topChanges);
  total.hiddenTopChanges += result.hiddenTopChanges;
  total.triggerMisses.push(...result.triggerMisses);
  total.regionalEntries = Math.max(total.regionalEntries, result.regionalEntries);
  total.regionalProbes += result.regionalProbes;
  total.regionalIssues.push(...result.regionalIssues);
}

/**
 * The culture gate (packages/data/src/culture/gate.ts) on each record alone, as if approved. One
 * locale at a time, outermost: a full locale engine is 13–18 MB, an isolate has 128 MB, and each
 * engine loads once however many records target it. Throws when a needed locale engine cannot
 * load, so nothing is stored or published unchecked.
 */
export async function runGateEach(
  runtime: CultureRuntime,
  env: Env,
  records: readonly CultureRecord[],
): Promise<Map<string, CultureGateResult>> {
  const approved = records.map((r) => ({ ...r, status: "approved" as const }));
  const results = new Map(approved.map((r) => [r.id, emptyGate()]));
  const locales = [...new Set(approved.flatMap((r) => targetLocales(r)))].sort();
  for (const locale of locales) {
    const targeting = approved.filter((r) => targetLocales(r).includes(locale));
    const engine = await runtime.engine(locale, env);
    if (!engine) throw new Error(`culture gate: no alias engine for "${locale}"`);
    const queries = runtime.gateQueries.filter((q) => q.locale === locale);
    for (const record of targeting) {
      const result = runCultureGateWith({
        baseFor: () => engine,
        packVersion: runtime.packVersion,
        records: [forLocale(record, locale)],
        catalog: runtime.catalog,
        queries,
      });
      addGate(results.get(record.id) as CultureGateResult, result);
    }
  }
  return results;
}

/** The gate on one record. */
export async function runGate(
  runtime: CultureRuntime,
  env: Env,
  record: CultureRecord,
): Promise<CultureGateResult> {
  return (await runGateEach(runtime, env, [record])).get(record.id) ?? emptyGate();
}

/** Gate findings as blocking issues, in the words of `culture:gate`. */
export function gateIssues(result: CultureGateResult): CultureIssue[] {
  return [
    ...result.topChanges.map((c) => ({
      level: "error" as const,
      message: `changes the top answer of "${c.q}" (${c.locale}${c.region ? `, region ${c.region}` : ""}): ${c.before ?? "—"} → ${c.after ?? "—"}`,
    })),
    ...result.triggerMisses.map((m) => ({
      level: "error" as const,
      message: `trigger "${m.trigger}" (${m.locale}) puts ${m.emoji} at ${m.rank === 0 ? "no rank" : `rank ${m.rank}`} (needs the top 3)`,
    })),
    ...result.regionalIssues.map((i) => ({
      level: i.blocking ? ("error" as const) : ("warning" as const),
      message: `regional "${i.trigger}" (${i.locale}, region ${i.region}): ${i.problem}`,
    })),
  ];
}

/**
 * Validation, the gate on this record alone, and the search preview of every targeted locale,
 * one locale engine at a time.
 */
export async function previewWithGate(
  runtime: CultureRuntime,
  env: Env,
  record: CultureRecord,
): Promise<CulturePreview> {
  const issues = validate(runtime, record);
  const valid = !issues.some((i) => i.level === "error");
  const locales: RecordPreview["locales"] = [];
  for (const locale of targetLocales(record)) {
    const engine = (record.triggers[locale]?.length ?? 0) > 0 ? await runtime.engine(locale, env) : undefined;
    const preview = previewRecord(record, {
      catalog: runtime.catalog,
      exclusions: runtime.exclusions,
      packVersion: runtime.packVersion,
      locales: [locale],
      engineFor: () => engine,
    });
    locales.push(...preview.locales);
  }
  // The gate needs a valid record: compile skips what validation rejects.
  let gate = { queries: 0, triggers: 0, failed: false };
  if (valid) {
    const result = await runGate(runtime, env, record);
    const found = gateIssues(result);
    issues.push(...found);
    gate = {
      queries: result.queries,
      triggers: result.triggers,
      failed: found.some((i) => i.level === "error"),
    };
  }
  return { id: record.id, issues, locales, gate };
}
