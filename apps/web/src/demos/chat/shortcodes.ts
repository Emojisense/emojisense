import { type AliasEngine, type AliasResult, normalize, type SearchResult } from "emojisense";

/** The text after an unfinished ":" in the composer. */
export interface Trigger {
  /** Index of the ":". */
  start: number;
  /** Caret index: the query ends here. */
  end: number;
  query: string;
}

const MIN_QUERY = 2;
const MAX_QUERY = 40;
/** A ":" opens the popup only at the start of a word, so "10:30" and "note:" stay plain text. */
const BEFORE_TRIGGER = /[\s([{"'“‘]/;

/**
 * Finds a ":" query that ends at the caret. Single spaces are allowed, so plain language like
 * ":greatest of all time" works; two spaces in a row end it.
 */
export function findTrigger(value: string, caret: number): Trigger | undefined {
  const before = value.slice(0, caret);
  const start = before.lastIndexOf(":");
  if (start < 0) return undefined;
  if (start > 0 && !BEFORE_TRIGGER.test(before[start - 1] ?? "")) return undefined;
  const query = before.slice(start + 1);
  if (query.length < MIN_QUERY || query.length > MAX_QUERY) return undefined;
  if (!/^[\p{L}\p{N}]/u.test(query) || query.includes("  ") || query.includes("\n")) return undefined;
  return { start, end: caret, query };
}

/** `:party_popper:` style code, built from the emoji's English label. */
export function shortcodeFor(engine: AliasEngine | undefined, result: SearchResult): string {
  const label = engine?.get(result.id)?.labels.en;
  if (!label) return result.id.toLowerCase();
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9+]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const isAliasResult = (result: SearchResult): result is AliasResult => "match" in result;

export type MatchHint = { kind: "phrase"; text: string } | { kind: "meaning" };

/** Why a row matched, when the shortcode alone does not say it: an alias, a typo, or meaning. */
export function hintFor(engine: AliasEngine | undefined, result: SearchResult): MatchHint | undefined {
  if (result.source === "semantic") return { kind: "meaning" };
  if (!isAliasResult(result)) return undefined;
  const label = normalize(engine?.get(result.id)?.labels.en ?? "");
  return result.match === label ? undefined : { kind: "phrase", text: result.match };
}

const CLOSED_CODE = /(^|[\s([{])(:([\p{L}\p{N}_+-]{2,40}):)$/u;

/**
 * Slack habit: typing the closing ":" of an exact code (":goat:", ":tada:") swaps it for the emoji.
 * Returns the new value and caret, or undefined when the text before the caret is not a known code.
 */
export function expandClosedCode(
  engine: AliasEngine | undefined,
  value: string,
  caret: number,
): { value: string; caret: number } | undefined {
  if (!engine) return undefined;
  const before = value.slice(0, caret);
  const found = CLOSED_CODE.exec(before);
  const whole = found?.[2];
  const code = found?.[3]?.toLowerCase();
  if (!whole || !code) return undefined;
  const phrase = code.replace(/_/g, " ");
  const hit = engine
    .search(phrase, { limit: 10, prefix: false })
    .results.find(
      (r) => shortcodeFor(engine, r) === code || (r.field === "shortcode" && r.match === normalize(phrase)),
    );
  if (!hit) return undefined;
  const head = before.slice(0, before.length - whole.length);
  return { value: `${head}${hit.emoji}${value.slice(caret)}`, caret: head.length + hit.emoji.length };
}
