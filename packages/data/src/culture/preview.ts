/**
 * What an entry does to search: per targeted locale and trigger, the canonical answer and the
 * answer with the entry (window ignored, so a December entry can be reviewed in October), plus one
 * region inside and one outside its scope. culture:review prints it; the API Worker returns it to
 * the dashboard's Culture page. No file access.
 */
import type { AliasEngine, Culture, SearchResult } from "emojisense";
import { compileCulture } from "./compile.ts";
import { probeRegions } from "./regional.ts";
import type { CultureRecord, Issue } from "./types.ts";
import { targetLocales, type ValidationContext, validateRecord } from "./validate.ts";

export interface PreviewResult {
  emoji: string;
  hexcode: string;
  /** True for an emoji the culture layer added or moved. */
  culture: boolean;
}

export interface RegionPreview {
  region: string;
  /** Whether the entry applies when an app names this region. */
  inScope: boolean;
  results: PreviewResult[];
}

export interface TriggerPreview {
  trigger: string;
  canonical: PreviewResult[];
  /** With the entry active and no region named. */
  boosted: PreviewResult[];
  /** Culture results among `boosted`. */
  added: number;
  /** "no-canonical": the culture emoji become the top answer. "adds-nothing": no new emoji. */
  note?: "no-canonical" | "adds-nothing";
  /** Present when the entry does not apply everywhere, or is a regional sense. */
  regions?: RegionPreview[];
}

export interface LocalePreview {
  locale: string;
  context: string | null;
  triggers: TriggerPreview[];
}

export interface RecordPreview {
  id: string;
  issues: Issue[];
  locales: LocalePreview[];
}

export interface PreviewOptions extends Omit<ValidationContext, "fileName"> {
  /** The canonical engine of a pack locale; undefined skips that locale. */
  engineFor: (locale: string) => AliasEngine | undefined;
  packVersion: string;
  /** Results per row. Default 8. */
  limit?: number;
  /** Only these locales (default: every targeted locale). */
  locales?: readonly string[];
}

const toPreview = (results: readonly SearchResult[]): PreviewResult[] =>
  results.map((r) => ({ emoji: r.emoji, hexcode: r.id, culture: r.source === "culture" }));

/**
 * The entry alone for one locale, active on every day. `scoped` keeps its regions; otherwise it
 * applies everywhere, like the gate.
 */
function previewCulture(
  record: CultureRecord,
  locale: string,
  options: PreviewOptions,
  scoped: boolean,
): Culture {
  const culture = compileCulture([record], locale, {
    packVersion: options.packVersion,
    from: "2000-01-01",
    catalog: options.catalog,
    statuses: [record.status],
    forceActive: true,
  });
  if (!scoped) return culture;
  return {
    ...culture,
    entries: culture.entries.map((entry) => ({
      ...entry,
      regions: record.regions,
      ...(record.exceptRegions ? { exceptRegions: record.exceptRegions } : {}),
    })),
  };
}

export function previewRecord(record: CultureRecord, options: PreviewOptions): RecordPreview {
  const limit = options.limit ?? 8;
  const issues = validateRecord(record, { catalog: options.catalog, exclusions: options.exclusions });
  const everywhere = record.regions.includes("*") && !record.exceptRegions?.length;
  const probes = everywhere && record.kind !== "regional" ? undefined : probeRegions(record);
  const wanted = options.locales ? new Set(options.locales) : undefined;
  const locales: LocalePreview[] = [];
  for (const locale of targetLocales(record)) {
    if (wanted && !wanted.has(locale)) continue;
    const triggers = record.triggers[locale] ?? [];
    const preview: LocalePreview = { locale, context: record.context[locale] ?? null, triggers: [] };
    locales.push(preview);
    const engine = triggers.length > 0 ? options.engineFor(locale) : undefined;
    if (!engine) continue;
    const withEntry = engine.withCulture(previewCulture(record, locale, options, false));
    const scoped = probes ? engine.withCulture(previewCulture(record, locale, options, true)) : undefined;
    for (const trigger of triggers) {
      const search = { locale, limit, prefix: false };
      const canonical = engine.search(trigger, { ...search, culture: false }).results;
      const boosted = withEntry.search(trigger, search).results;
      const added = boosted.filter((r) => r.source === "culture").length;
      const row: TriggerPreview = {
        trigger,
        canonical: toPreview(canonical),
        boosted: toPreview(boosted),
        added,
      };
      if (canonical.length === 0) row.note = "no-canonical";
      else if (added === 0) row.note = "adds-nothing";
      if (probes && scoped) {
        row.regions = [probes.inside, probes.outside].flatMap((region, index) =>
          region
            ? [
                {
                  region,
                  inScope: index === 0,
                  results: toPreview(scoped.search(trigger, { ...search, region }).results),
                },
              ]
            : [],
        );
      }
      preview.triggers.push(row);
    }
  }
  return { id: record.id, issues, locales };
}
