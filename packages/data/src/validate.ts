/**
 * Step 3: enrichment/*.json → build/validated.json + build/review.csv
 *
 * - merge the tr overlay (enrichment/i18n/tr, overlay.ts) into the combined tr blocks
 * - normalize every alias with the shared normalizer, drop empties and duplicates
 * - drop aliases that repeat an indexed name / shortcode / keyword of the same emoji
 * - curation.json (curation.ts): remove an alias, demote it to `low`, or add a missed phrase;
 *   warn about remove/low entries that match no alias or CLDR keyword (build-pack.ts curates the
 *   keywords)
 * - moderation: block or demote, per locale (blocklist.ts)
 * - collision cap (collisions.ts): an alias on more than 8 emoji stays at full weight on its 8
 *   strongest owners; the others get it as `low` (up to 20 owners) or lose it (more)
 * - review.csv lists low-confidence, collided and moderated aliases for a human pass
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "emojisense";
import { orderedAliases } from "./alias-order.ts";
import { moderate } from "./blocklist.ts";
import { capCollisions } from "./collisions.ts";
import { curatedAdditions, curationAction, loadCurations, unmatchedEdits } from "./curation.ts";
import { COMBINED_LOCALES, LOCALE_CODES } from "./locales.ts";
import { loadOverlay, mergeOverlay, OVERLAY_LOCALES } from "./overlay.ts";
import { cldrKeywords } from "./pack-fields.ts";
import { BASE_FILE, BUILD_DIR, ENRICHMENT_DIR } from "./paths.ts";
import type { BaseEmoji, EnrichmentRecord, LocaleEnrichment, LocaleRecord, MinedAlias } from "./types.ts";

const LOCALES = LOCALE_CODES;
type Locale = string;

export interface ValidatedLocale {
  desc: string;
  alias: string[];
  typo: string[];
  low: string[];
}
export type Validated = Record<string, Record<Locale, ValidatedLocale>>;

interface ReviewRow {
  hexcode: string;
  emoji: string;
  locale: Locale;
  alias: string;
  field: string;
  reason: string;
  emojiCount: number;
}

const { emoji }: { emoji: BaseEmoji[] } = JSON.parse(readFileSync(BASE_FILE, "utf8"));
const records = new Map<string, EnrichmentRecord>();
const groups = [...new Set(emoji.map((e) => e.group))];
for (const group of groups) {
  const path = join(ENRICHMENT_DIR, `${group}.json`);
  if (!existsSync(path)) continue;
  for (const r of JSON.parse(readFileSync(path, "utf8")) as EnrichmentRecord[]) records.set(r.hexcode, r);
}

// Overlay files of combined locales (overlay.ts) join their block before anything else runs.
const knownHexcodes = new Set(emoji.map((e) => e.hexcode));
for (const locale of OVERLAY_LOCALES) {
  const overlay = loadOverlay(join(ENRICHMENT_DIR, "i18n", locale), groups, knownHexcodes);
  for (const [hexcode, extra] of overlay) {
    const record = records.get(hexcode);
    if (!record) throw new Error(`i18n/${locale} overlay: ${hexcode} has no record in the combined files`);
    record[locale] = mergeOverlay(record[locale], extra);
  }
}

/** Locales beyond the combined en + tr files: enrichment/i18n/<locale>/<group>.json. */
const localeRecords = new Map<string, Map<string, LocaleEnrichment>>();
for (const locale of LOCALES.filter((l) => !(COMBINED_LOCALES as readonly string[]).includes(l))) {
  const byHexcode = new Map<string, LocaleEnrichment>();
  for (const group of groups) {
    const path = join(ENRICHMENT_DIR, "i18n", locale, `${group}.json`);
    if (!existsSync(path)) continue;
    for (const r of JSON.parse(readFileSync(path, "utf8")) as LocaleRecord[]) byHexcode.set(r.hexcode, r);
  }
  localeRecords.set(locale, byHexcode);
}

function enrichmentFor(hexcode: string, locale: Locale): LocaleEnrichment | undefined {
  if ((COMBINED_LOCALES as readonly string[]).includes(locale)) {
    return records.get(hexcode)?.[locale as (typeof COMBINED_LOCALES)[number]];
  }
  return localeRecords.get(locale)?.get(hexcode);
}

const curations = loadCurations(join(ENRICHMENT_DIR, "curation.json"));
let curatedAdded = 0;

const minedPath = join(ENRICHMENT_DIR, "mined.json");
const mined: MinedAlias[] = existsSync(minedPath) ? JSON.parse(readFileSync(minedPath, "utf8")) : [];

function indexedPhrases(e: BaseEmoji, locale: Locale): Set<string> {
  const cldr = e.i18n[locale];
  const raw =
    locale === "en" ? [e.label, ...e.tags, ...e.shortcodes] : [cldr?.label ?? "", ...(cldr?.tags ?? [])];
  return new Set(raw.map((s) => normalize(s)).filter(Boolean));
}

const review: ReviewRow[] = [];
const draft = new Map<string, Record<Locale, ValidatedLocale>>();
let moderated = 0;

for (const e of emoji) {
  const perLocale = {} as Record<Locale, ValidatedLocale>;
  for (const locale of LOCALES) {
    const block = enrichmentFor(e.hexcode, locale);
    const additions = curatedAdditions(curations, e.hexcode, locale);
    const out: ValidatedLocale = { desc: block?.desc ?? "", alias: [], typo: [], low: [] };
    perLocale[locale] = out;
    if (!block && additions.length === 0) continue;

    const taken = indexedPhrases(e, locale);
    const lowSet = new Set((block?.low ?? []).map((s) => normalize(s)));
    /** `manual`: a curator's addition, never treated as low-confidence. */
    const place = (rawAlias: string, field: "alias" | "typo", manual = false): boolean => {
      const alias = normalize(rawAlias);
      if (!alias || taken.has(alias)) return false;
      taken.add(alias);
      const curated = curationAction(curations, e.hexcode, locale, alias);
      if (curated === "remove") return false;
      if (curated === "low") {
        out.low.push(alias);
        return true;
      }
      const verdict = moderate(alias, locale);
      if (verdict === "block") {
        moderated++;
        review.push({
          hexcode: e.hexcode,
          emoji: e.emoji,
          locale,
          alias,
          field,
          reason: "blocked",
          emojiCount: 1,
        });
        return false;
      }
      if (verdict === "demote" || (!manual && lowSet.has(alias))) {
        out.low.push(alias);
        review.push({
          hexcode: e.hexcode,
          emoji: e.emoji,
          locale,
          alias,
          field,
          reason: verdict === "demote" ? "demoted:profanity" : "low_confidence",
          emojiCount: 1,
        });
        return true;
      }
      out[field].push(alias);
      return true;
    };
    // Curated additions first: they are reviewed fixes, so they belong in the core pack.
    for (const { phrase, field } of additions) if (place(phrase, field, true)) curatedAdded++;
    if (!block) continue;
    // `top` first, then category order: the first placement of a phrase wins (alias-order.ts).
    for (const a of orderedAliases(block, `${e.hexcode} ${locale}`)) place(a, "alias");
    for (const m of mined) if (m.hexcode === e.hexcode && m.locale === locale) place(m.alias, "alias");
    for (const a of block.typo) place(a, "typo");
  }
  draft.set(e.hexcode, perLocale);
}

// A remove/low entry that names no alias or CLDR keyword of its emoji does nothing: say so.
const emojiByHexcode = new Map(emoji.map((e) => [e.hexcode, e]));
const phrasesOf = (hexcode: string, locale: Locale): string[] => {
  const e = emojiByHexcode.get(hexcode);
  const block = enrichmentFor(hexcode, locale);
  return [
    ...(e ? cldrKeywords(e, locale) : []),
    ...(block ? [...orderedAliases(block, `${hexcode} ${locale}`), ...block.typo] : []),
    ...mined.filter((m) => m.hexcode === hexcode && m.locale === locale).map((m) => m.alias),
  ];
};
for (const c of unmatchedEdits(curations, LOCALES, phrasesOf)) {
  console.warn(
    `⚠ curation: ${c.hexcode} ${c.locale} "${c.alias}" (${c.action}) matches no alias or CLDR keyword`,
  );
}

// Collision cap, per locale, over generated aliases only (collisions.ts).
let demoted = 0;
let dropped = 0;
for (const locale of LOCALES) {
  const lists = new Map<string, ValidatedLocale>();
  for (const [hexcode, perLocale] of draft) if (perLocale[locale]) lists.set(hexcode, perLocale[locale]);
  const capped = capCollisions(lists);
  demoted += capped.demoted;
  dropped += capped.dropped;
  for (const c of capped.collisions) {
    // The row names the owners that lost the alias; emoji_count is every owner.
    review.push({
      hexcode: c.losers.join(" "),
      emoji: c.losers.map((h) => emoji.find((x) => x.hexcode === h)?.emoji ?? "").join(""),
      locale,
      alias: c.alias,
      field: "alias",
      reason: c.dropped ? "collision_dropped" : "collision_demoted",
      emojiCount: c.owners.length,
    });
  }
}

const validated: Validated = Object.fromEntries(draft);
writeFileSync(join(BUILD_DIR, "validated.json"), `${JSON.stringify(validated)}\n`);

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const header = "reason,locale,emoji,hexcode,alias,field,emoji_count";
const rows = review
  .sort((a, b) => a.reason.localeCompare(b.reason) || b.emojiCount - a.emojiCount)
  .map((r) =>
    [r.reason, r.locale, r.emoji, r.hexcode, r.alias, r.field, r.emojiCount].map(csvCell).join(","),
  );
writeFileSync(join(BUILD_DIR, "review.csv"), `${[header, ...rows].join("\n")}\n`);

const count = (locale: Locale, key: keyof Omit<ValidatedLocale, "desc">) =>
  [...draft.values()].reduce((sum, v) => sum + (v[locale]?.[key].length ?? 0), 0);
console.log(
  `validate: ${records.size}/${emoji.length} emoji enriched | ` +
    LOCALES.map(
      (l) => `${l}: ${count(l, "alias")} alias, ${count(l, "typo")} typo, ${count(l, "low")} low`,
    ).join(" | ") +
    ` | collisions: ${demoted} demoted, ${dropped} dropped | moderated: ${moderated}` +
    ` | curated additions: ${curatedAdded} | review rows: ${review.length}`,
);
