/**
 * Day-one queries for layer 2, before any query log exists. All of them are synthetic and come
 * from our own data, so they are biased toward what the aliases already cover (README.md).
 * The first nightly build from real logs replaces them.
 */
import { normalize, tokenize } from "emojisense";
import type { BaseEmoji } from "../types.ts";
import type { Validated } from "../validate.ts";
import type { QueryLogRow } from "./queries.ts";

/** Curated template words. Picker users type moods and "mood + animal" more than full sentences. */
const MOODS = {
  en: [
    "happy",
    "sad",
    "angry",
    "tired",
    "sleepy",
    "excited",
    "scared",
    "nervous",
    "bored",
    "sick",
    "proud",
    "confused",
    "shocked",
    "grateful",
    "lonely",
    "stressed",
    "relieved",
    "cute",
    "crying",
    "laughing",
  ],
  tr: [
    "mutlu",
    "üzgün",
    "kızgın",
    "yorgun",
    "uykulu",
    "heyecanlı",
    "korkmuş",
    "sıkılmış",
    "hasta",
    "sevimli",
  ],
} as const;
const FEELING_TEMPLATES = { en: ["feeling {m}", "so {m}", "im {m}"], tr: ["çok {m}", "{m} hissediyorum"] };
const ANIMAL_TEMPLATE = "{m} {animal}";
const ANIMAL_MOODS = {
  en: ["happy", "sad", "angry", "cute", "sleepy", "crying"],
  tr: ["mutlu", "üzgün", "sevimli"],
};

/** Description fragments of 2–6 words read like conceptual queries ("fast growth", "going live"). */
const MIN_FRAGMENT_TOKENS = 2;
const MAX_FRAGMENT_TOKENS = 6;
const FRAGMENT_BREAKS = /[;,.:!?()"“”‘’]+|\s(?:or|and|ve|veya|ya da)\s/;
const LEADING_FILLER = /^(?:or|and|for|ve|veya|icin) /;
/** Strong aliases come first in the data; give them a slightly higher synthetic count. */
const RANK_BONUS = 10;

const isPhrase = (q: string) => tokenize(q).length >= 2;

export function bootstrapQueries(
  emoji: readonly BaseEmoji[],
  validated: Validated,
  minCount: number,
): QueryLogRow[] {
  const rows: QueryLogRow[] = [];
  const add = (q: string, locale: "en" | "tr", bonus = 0) => {
    rows.push({ q, n: minCount + bonus, locale });
  };

  for (const e of emoji) {
    for (const locale of ["en", "tr"] as const) {
      const v = validated[e.hexcode]?.[locale];
      if (!v) continue;
      [...v.alias, ...v.low].forEach((alias, rank) => {
        if (isPhrase(alias)) add(alias, locale, Math.max(0, RANK_BONUS - rank));
      });
      for (const raw of v.desc.split(FRAGMENT_BREAKS)) {
        const fragment = normalize(raw).replace(LEADING_FILLER, "");
        const tokens = tokenize(fragment).length;
        if (tokens >= MIN_FRAGMENT_TOKENS && tokens <= MAX_FRAGMENT_TOKENS) add(fragment, locale);
      }
    }
  }

  for (const locale of ["en", "tr"] as const) {
    for (const m of MOODS[locale]) {
      for (const template of FEELING_TEMPLATES[locale]) add(template.replace("{m}", m), locale);
    }
    const animals = emoji
      .filter((e) => e.subgroup.startsWith("animal-"))
      .map((e) => (locale === "en" ? e.label : (e.tr.label ?? "")))
      .filter((label) => label !== "" && !label.includes(" "));
    for (const m of ANIMAL_MOODS[locale]) {
      for (const animal of animals) {
        add(ANIMAL_TEMPLATE.replace("{m}", m).replace("{animal}", animal.toLowerCase()), locale);
      }
    }
  }
  return rows;
}
