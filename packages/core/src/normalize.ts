/**
 * The one normalization used everywhere: pack builder, client, Worker, eval.
 * Specified in docs/PACK_FORMAT.md §Normalization. Changing it is a pack format change.
 */

export const MAX_QUERY_LENGTH = 64;

const EMOJI_PARTS =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{E0020}-\u{E007F}]/gu;
/** Zero-width joiner, variation selectors and the keycap mark: invisible glue inside emoji. */
const EMOJI_GLUE = /\u200D|\uFE0E|\uFE0F|\u20E3/g;
/**
 * Only accents people skip when typing: Latin/Greek/Cyrillic diacritics (U+0300–036F), Arabic
 * vowel marks and tatweel, Hebrew points. Marks that are part of the spelling (Devanagari and
 * Bengali vowel signs, Japanese dakuten, Thai vowels) must survive.
 */
const OPTIONAL_MARKS = /[\u0300-\u036F\u064B-\u065F\u0670\u0640\u0591-\u05C7]/g;
/** Letters with no decomposition that people still type without the stroke. */
const LETTER_FOLDS: Record<string, string> = { ı: "i", đ: "d", ł: "l", ø: "o", ß: "ss" };
const FOLDABLE = /[ıđłøß]/g;
const APOSTROPHES = /['’`´]/g;
const NON_WORD = /[^\p{L}\p{M}\p{N}+]+/gu;
const LONE_PLUS = /\+(?!\d)/g;
const WHITESPACE = /\s+/g;

/**
 * NFKC → drop emoji → lowercase → NFD → drop optional accents (ç→c, ğ→g, ñ→n, ё→е, Arabic
 * harakat) → fold ı/đ/ł/ø/ß → NFC → drop apostrophes → punctuation to spaces → collapse
 * whitespace → cap at {@link MAX_QUERY_LENGTH} characters.
 *
 * Folding makes accented and plain spellings meet ("doğum günü" ≡ "dogum gunu", "cumpleaños" ≡
 * "cumpleanos") and is locale-independent, so "I"/"İ"/"ı" all end as "i". Scripts whose marks
 * carry meaning (Hindi, Bengali, Japanese, Korean, Thai) keep them; NFC recomposes Hangul.
 */
export function normalize(input: string, maxLength = MAX_QUERY_LENGTH): string {
  const folded = input
    .normalize("NFKC")
    .replace(EMOJI_PARTS, " ")
    .replace(EMOJI_GLUE, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(OPTIONAL_MARKS, "")
    .replace(FOLDABLE, (letter) => LETTER_FOLDS[letter] ?? letter)
    .normalize("NFC")
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
