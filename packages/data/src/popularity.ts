/**
 * The popularity prior: how often people use each emoji, as a percentile 0–100 per pack row
 * (pack.en.json `popularity`, PACK_FORMAT.md §2). Source: priors/popularity.json, imported from
 * Emoji-SP (CC BY 4.0, scripts/import-popularity.ts). An emoji the source does not rate gets 0.
 *
 * A gender, skin-tone or person variant that the source does not rate takes the best rating of its
 * family (🤦‍♂️ → 🤦, 👨‍⚕️ → 🧑‍⚕️), as frequency lists count families as one item.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_ROOT } from "./paths.ts";

export const POPULARITY_FILE = join(DATA_ROOT, "priors", "popularity.json");
/** The attribution CC BY 4.0 asks for; the manifest's `source.popularity` (licenses/emoji-sp.CC-BY-4.0.txt). */
export const POPULARITY_CREDIT = "Emoji-SP (Ferré et al. 2023, doi:10.3758/s13428-022-01893-6), CC BY 4.0";

export interface PopularitySource {
  /** Mean rated frequency of use per emoji, keyed by hexcode without FE0F. */
  ratings: Record<string, number>;
}

const withoutVariation = (hexcode: string) =>
  hexcode
    .split("-")
    .filter((p) => p !== "FE0F")
    .join("-");

/** One key per family: no skin tone, no gender suffix, 👨/👩 + ZWJ read as 🧑 + ZWJ. */
export function familyKey(hexcode: string): string {
  const points = withoutVariation(hexcode)
    .split("-")
    .filter((p) => !/^1F3F[B-F]$/.test(p));
  if (
    points.length >= 3 &&
    points.at(-2) === "200D" &&
    (points.at(-1) === "2640" || points.at(-1) === "2642")
  ) {
    points.splice(-2, 2);
  }
  if (points.length >= 2 && (points[0] === "1F468" || points[0] === "1F469") && points[1] === "200D") {
    points[0] = "1F9D1";
  }
  return points.join("-");
}

export function loadPopularity(path = POPULARITY_FILE): PopularitySource {
  return JSON.parse(readFileSync(path, "utf8")) as PopularitySource;
}

/** Percentile 0–100 of each hexcode's rating among the source's ratings; 0 when unrated. */
export function popularityOf(hexcodes: readonly string[], source: PopularitySource): number[] {
  const values = Object.values(source.ratings).sort((a, b) => a - b);
  const byFamily = new Map<string, number>();
  for (const [hexcode, rating] of Object.entries(source.ratings)) {
    const key = familyKey(hexcode);
    byFamily.set(key, Math.max(byFamily.get(key) ?? 0, rating));
  }
  const percentile = (rating: number) => {
    const below = values.filter((v) => v < rating).length;
    const equal = values.filter((v) => v === rating).length;
    return Math.max(1, Math.round((100 * (below + equal / 2)) / values.length));
  };
  return hexcodes.map((hexcode) => {
    const rating = source.ratings[withoutVariation(hexcode)] ?? byFamily.get(familyKey(hexcode));
    return rating === undefined ? 0 : percentile(rating);
  });
}
