/**
 * The one normalization used everywhere: pack builder, client, Worker, eval.
 * Specified in docs/PACK_FORMAT.md §Normalization. Changing it is a pack format change.
 */

export const MAX_QUERY_LENGTH = 64;

const EMOJI_PARTS =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{E0020}-\u{E007F}]/gu;
/** Zero-width joiner, variation selectors and the keycap mark: invisible glue inside emoji. */
const EMOJI_GLUE = /\u200D|\uFE0E|\uFE0F|\u20E3/g;
const COMBINING_MARKS = /\p{M}/gu;
const APOSTROPHES = /['’`´]/g;
const NON_WORD = /[^\p{L}\p{N}+]+/gu;
const LONE_PLUS = /\+(?!\d)/g;
const WHITESPACE = /\s+/g;

/**
 * NFKC → lowercase → drop emoji → fold diacritics (ç→c, ğ→g, ı→i, é→e…) → drop apostrophes →
 * punctuation to spaces → collapse whitespace → cap at {@link MAX_QUERY_LENGTH} characters.
 *
 * Folding makes Turkish and ASCII spellings meet ("doğum günü" ≡ "dogum gunu") and is
 * locale-independent, so "I"/"İ"/"ı" all end as "i".
 */
export function normalize(input: string, maxLength = MAX_QUERY_LENGTH): string {
  const folded = input
    .normalize("NFKC")
    .replace(EMOJI_PARTS, " ")
    .replace(EMOJI_GLUE, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/ı/g, "i")
    .replace(APOSTROPHES, "")
    .replace(NON_WORD, " ")
    .replace(LONE_PLUS, " ")
    .replace(WHITESPACE, " ")
    .trim();
  return folded.length <= maxLength ? folded : folded.slice(0, maxLength).trimEnd();
}

export function tokenize(normalized: string): string[] {
  return normalized === "" ? [] : normalized.split(" ");
}
