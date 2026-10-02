/** Longest query the engine and the hosted API accept (docs/API.md). */
export const MAX_QUERY_LENGTH = 64;

/** Searched when the address has no usable words, e.g. "/123/". */
export const FALLBACK_QUERY = "nothing here";

const FILE_EXTENSION = /\.(html?|php|aspx?|jsp|md|txt|json)$/i;
/**
 * Everything that is not a letter, digit, mark, emoji or apostrophe separates words. The zero
 * width joiner is kept too, so emoji sequences such as 🧑‍🚀 stay whole.
 */
const SEPARATORS = /(?:(?!\u200d)[^\p{L}\p{N}\p{M}\p{Extended_Pictographic}'])+/gu;
const HAS_WORD = /[\p{L}\p{Extended_Pictographic}]/u;

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/\+/g, " "));
  } catch {
    return segment;
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Turns the address of a missing page into an emoji search: "/blog/jurassic-park.html" →
 * "jurassic park". Uses the last path segment that has words in it. Returns "" when none has.
 */
export function queryFromPath(pathname: string, maxLength = MAX_QUERY_LENGTH): string {
  const segments = pathname
    .split("/")
    .map((segment) => decode(segment).replace(FILE_EXTENSION, "").replace(SEPARATORS, " ").trim())
    .filter((segment) => HAS_WORD.test(segment) && !/^index$/i.test(segment));
  const last = segments.at(-1);
  return last ? clip(last.replace(/\s+/g, " ").toLowerCase(), maxLength) : "";
}
