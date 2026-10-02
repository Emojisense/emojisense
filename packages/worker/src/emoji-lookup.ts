import type { AliasEngine } from "emojisense";

/** Variation selectors and skin tones: a model may add or drop them; the catalog keeps base emoji. */
const IGNORED = /[︎️\u{1F3FB}-\u{1F3FF}]/gu;
/** ZWJ + ♀ / ♂ / ➡ only changes the gender or direction of a person emoji. */
const VARIANT_SUFFIXES = new Set(["2640", "2642", "27A1"]);
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const tables = new WeakMap<AliasEngine, Map<string, string>>();

function table(engine: AliasEngine): Map<string, string> {
  let byText = tables.get(engine);
  if (!byText) {
    byText = new Map(engine.entries.map((entry) => [entry.emoji.replace(IGNORED, ""), entry.id]));
    tables.set(engine, byText);
  }
  return byText;
}

/**
 * Catalog ids of the emoji in `text`, in order. Text a model wrote may hold several emoji in one
 * string ("🐶🐕"), skin tones or missing variation selectors; anything that is not a catalog
 * emoji (words, shortcodes, invented sequences) is dropped.
 */
export function resolveEmoji(engine: AliasEngine, text: string): string[] {
  const byText = table(engine);
  const ids: string[] = [];
  for (const { segment } of graphemes.segment(text.trim())) {
    const id = byText.get(segment.replace(IGNORED, ""));
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * One key for the gender and direction variants of a person emoji ("1F6B5-200D-2640-FE0F",
 * "1F6B5" → "1F6B5"; 👩‍💻 and 👨‍💻 → 🧑‍💻), so a short list does not show the same thing three times.
 */
export function familyKey(id: string): string {
  const parts = id.split("-").filter((part) => part !== "FE0F");
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "200D" && VARIANT_SUFFIXES.has(parts[i + 1] ?? "")) {
      i++;
      continue;
    }
    kept.push(parts[i] as string);
  }
  if (kept.length > 1 && (kept[0] === "1F468" || kept[0] === "1F469")) kept[0] = "1F9D1";
  return kept.join("-");
}
