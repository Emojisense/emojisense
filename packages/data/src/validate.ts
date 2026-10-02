/**
 * Step 3: enrichment/*.json → build/validated.json + build/review.csv
 *
 * - normalize every alias with the shared normalizer, drop empties and duplicates
 * - drop aliases that repeat an indexed name / shortcode / keyword of the same emoji
 * - moderation: block or demote (blocklist.ts)
 * - collision cap: an alias on more than COLLISION_DEMOTE emoji is demoted to `low`,
 *   on more than COLLISION_DROP emoji it is dropped (it no longer discriminates)
 * - review.csv lists low-confidence, collided and moderated aliases for a human pass
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "emojisense";
import { moderate } from "./blocklist.ts";
import { BASE_FILE, BUILD_DIR, ENRICHMENT_DIR } from "./paths.ts";
import type { AliasCategory, BaseEmoji, EnrichmentRecord, LocaleEnrichment } from "./types.ts";

export const COLLISION_DEMOTE = 8;
export const COLLISION_DROP = 20;
const LOCALES = ["en", "tr"] as const;
type Locale = (typeof LOCALES)[number];

/** Category order = priority when the same alias appears twice for one emoji. */
const ALIAS_ORDER: AliasCategory[] = ["synonym", "slang", "pop_culture", "dev", "intent"];

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
for (const group of new Set(emoji.map((e) => e.group))) {
  const path = join(ENRICHMENT_DIR, `${group}.json`);
  if (!existsSync(path)) continue;
  for (const r of JSON.parse(readFileSync(path, "utf8")) as EnrichmentRecord[]) records.set(r.hexcode, r);
}

function indexedPhrases(e: BaseEmoji, locale: Locale): Set<string> {
  const raw = locale === "en" ? [e.label, ...e.tags, ...e.shortcodes] : [e.tr.label ?? "", ...e.tr.tags];
  return new Set(raw.map((s) => normalize(s)).filter(Boolean));
}

const review: ReviewRow[] = [];
const draft = new Map<string, Record<Locale, ValidatedLocale>>();
let moderated = 0;

for (const e of emoji) {
  const record = records.get(e.hexcode);
  const perLocale = {} as Record<Locale, ValidatedLocale>;
  for (const locale of LOCALES) {
    const block: LocaleEnrichment | undefined = record?.[locale];
    const out: ValidatedLocale = { desc: block?.desc ?? "", alias: [], typo: [], low: [] };
    perLocale[locale] = out;
    if (!block) continue;

    const taken = indexedPhrases(e, locale);
    const lowSet = new Set(block.low.map((s) => normalize(s)));
    const place = (rawAlias: string, field: "alias" | "typo") => {
      const alias = normalize(rawAlias);
      if (!alias || taken.has(alias)) return;
      taken.add(alias);
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
        return;
      }
      if (verdict === "demote" || lowSet.has(alias)) {
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
        return;
      }
      out[field].push(alias);
    };
    for (const category of ALIAS_ORDER) for (const a of block[category]) place(a, "alias");
    for (const a of block.typo) place(a, "typo");
  }
  draft.set(e.hexcode, perLocale);
}

// Collision cap, per locale, over generated aliases only (names/keywords are curated CLDR data).
let demoted = 0;
let dropped = 0;
for (const locale of LOCALES) {
  const owners = new Map<string, string[]>();
  for (const [hexcode, perLocale] of draft) {
    const { alias, typo, low } = perLocale[locale];
    for (const a of [...alias, ...typo, ...low]) {
      const list = owners.get(a);
      if (list) list.push(hexcode);
      else owners.set(a, [hexcode]);
    }
  }
  for (const [alias, hexcodes] of owners) {
    if (hexcodes.length <= COLLISION_DEMOTE) continue;
    const drop = hexcodes.length > COLLISION_DROP;
    for (const hexcode of hexcodes) {
      const v = (draft.get(hexcode) as Record<Locale, ValidatedLocale>)[locale];
      const wasLow = v.low.includes(alias);
      v.alias = v.alias.filter((a) => a !== alias);
      v.typo = v.typo.filter((a) => a !== alias);
      v.low = v.low.filter((a) => a !== alias);
      if (!drop) v.low.push(alias);
      if (drop) dropped++;
      else if (!wasLow) demoted++;
    }
    review.push({
      hexcode: hexcodes.join(" "),
      emoji: hexcodes.map((h) => emoji.find((x) => x.hexcode === h)?.emoji ?? "").join(""),
      locale,
      alias,
      field: "alias",
      reason: drop ? `collision_dropped` : `collision_demoted`,
      emojiCount: hexcodes.length,
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
  [...draft.values()].reduce((sum, v) => sum + v[locale][key].length, 0);
console.log(
  `validate: ${records.size}/${emoji.length} emoji enriched | ` +
    LOCALES.map(
      (l) => `${l}: ${count(l, "alias")} alias, ${count(l, "typo")} typo, ${count(l, "low")} low`,
    ).join(" | ") +
    ` | collisions: ${demoted} demoted, ${dropped} dropped | moderated: ${moderated} | review rows: ${review.length}`,
);
