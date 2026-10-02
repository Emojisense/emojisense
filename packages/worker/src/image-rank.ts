import { type AliasEngine, normalize, type SearchResult, tokenize } from "emojisense";
import { resolveEmoji } from "./emoji-lookup.ts";
import { fuseLists, type WeightedList } from "./fusion.ts";
import type { ImageLabel } from "./vision.ts";

/**
 * Evidence weights for photo → emoji (DECISIONS.md, "Photo → emoji ranking"). The vision model
 * sees the image, so its own proposals count most. An alias hit for one of its keywords is
 * precise but narrow, and counts in proportion to how well the phrase matched. The caption
 * embedding has the best recall and the weakest neighbours (🐼 for a cat).
 */
export const IMAGE_WEIGHTS = { proposed: 1, keyword: 0.5, caption: 0.5 } as const;
/** RRF constant: rank 8 of a list still adds 56 % of its weight. */
const RRF_K = 8;
/**
 * Evidence an emoji needs to be shown. Any model proposal passes (≥ 0.56). On its own, only the
 * top caption neighbour (0.5) or an exact keyword hit at rank 1 passes; rank 2+ of one weak list
 * (0.45 and less) needs a second source.
 */
export const IMAGE_FLOOR = 0.46;
const KEYWORD_CANDIDATES = 6;
/** Fuzzy alias matches below this are noise for a keyword ("corgi" → 🥐 via a typo, 0.45). */
const MIN_KEYWORD_SCORE = 0.5;
const FILLER = new Set("a an the of on in at to and with is are its this that some".split(" "));

/** Caption words, when the model gave no keywords (a sloppy answer). */
export function captionKeywords(caption: string): string[] {
  const words = tokenize(normalize(caption)).filter((w) => w.length >= 3 && !FILLER.has(w));
  return [...new Set(words)].slice(0, 6);
}

/**
 * Photo → emoji: fuse the model's proposed emoji, an alias search per keyword (whole words, no
 * prefixes) and the semantic neighbours of the caption; drop what has too little evidence.
 */
export function rankImage(
  engine: AliasEngine,
  label: ImageLabel,
  captionNeighbours: readonly SearchResult[] | undefined,
  limit: number,
): SearchResult[] {
  const proposed = label.emoji
    .flatMap((emoji) => resolveEmoji(engine, emoji))
    .map(
      (id, i): SearchResult => ({
        emoji: engine.get(id)?.emoji ?? "",
        id,
        score: 1 / (i + 1),
        source: "semantic",
      }),
    );
  const keywords = label.keywords.length > 0 ? label.keywords : captionKeywords(label.caption);
  const lists: WeightedList[] = [
    { results: proposed, weight: IMAGE_WEIGHTS.proposed },
    ...keywords.map(
      (keyword): WeightedList => ({
        results: engine
          .search(keyword, { locale: "en", limit: KEYWORD_CANDIDATES, prefix: false })
          .results.filter((r) => r.score >= MIN_KEYWORD_SCORE),
        weight: IMAGE_WEIGHTS.keyword,
        byScore: true,
      }),
    ),
    { results: captionNeighbours ?? [], weight: IMAGE_WEIGHTS.caption },
  ];
  return fuseLists(lists, {
    k: RRF_K,
    limit,
    floor: IMAGE_FLOOR,
    scale: IMAGE_WEIGHTS.proposed + IMAGE_WEIGHTS.keyword + IMAGE_WEIGHTS.caption,
  });
}
