import type { AliasEngine, SearchResult } from "emojisense";
import { API_URL, PUBLISHABLE_KEY } from "../../config";
import { pageLocale } from "../../lib/engine-client";

export interface ReactionSuggestions {
  results: SearchResult[];
  /** "edge": the API ranked them. "device": the API failed, so the on-device engine answered. */
  via: "edge" | "device";
  /** Round trip of the API call. */
  ms?: number;
}

const SHOWN = 6;
const API_TIMEOUT_MS = 3500;
/** Below this, an on-device phrase hit is noise ("smoke tests" → 🚬). */
const MIN_DEVICE_SCORE = 0.5;
/**
 * Chat messages hold several phrases, so each clause is searched on its own. A "." inside
 * "2.14.0" is not a break. One-word clauses are skipped: alone, "US" or "14" mean a flag or a date.
 */
const CLAUSE_BREAK =
  /[.!?,;:]+(?=\s|$)|[\n()"“”`]+|(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u{FE0F}|\u{200D})+|\s(?:and|but|so)\s/gu;

/** On-device reactions: the engine searches the whole text and each clause, best score per emoji. */
export function suggestOnDevice(engine: AliasEngine, text: string): SearchResult[] {
  const clauses = text
    .split(CLAUSE_BREAK)
    .map((clause) => clause.trim())
    .filter((clause) => clause.split(/\s+/).length >= 2);
  const best = new Map<string, SearchResult>();
  for (const clause of new Set([text, ...clauses])) {
    for (const result of engine.search(clause, { limit: SHOWN, prefix: false, locale: pageLocale() })
      .results) {
      if (result.score < MIN_DEVICE_SCORE) continue;
      const previous = best.get(result.id);
      if (!previous || result.score > previous.score) best.set(result.id, result);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** `POST /v1/suggest-reactions` (docs/API.md). Resolves undefined on any failure. */
async function suggestFromEdge(
  text: string,
  signal: AbortSignal,
): Promise<{ results: SearchResult[]; ms: number } | undefined> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), API_TIMEOUT_MS);
  const abort = () => timeout.abort();
  signal.addEventListener("abort", abort, { once: true });
  const started = performance.now();
  try {
    const response = await fetch(
      `${API_URL}/v1/suggest-reactions?key=${encodeURIComponent(PUBLISHABLE_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, locale: pageLocale(), limit: SHOWN }),
        signal: timeout.signal,
      },
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as { results?: SearchResult[] };
    if (!Array.isArray(body.results)) return undefined;
    return { results: body.results, ms: performance.now() - started };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

/**
 * Reactions for a chat message, ranked by the API. Only when the API fails or times out does the
 * on-device engine load and answer alone.
 */
export async function suggestReactions(
  text: string,
  loadEngine: () => Promise<AliasEngine | undefined>,
  signal: AbortSignal,
): Promise<ReactionSuggestions> {
  const edge = await suggestFromEdge(text, signal);
  if (edge) return { results: edge.results.slice(0, SHOWN), via: "edge", ms: edge.ms };
  const engine = await loadEngine().catch(() => undefined);
  return { results: engine ? suggestOnDevice(engine, text).slice(0, SHOWN) : [], via: "device" };
}
