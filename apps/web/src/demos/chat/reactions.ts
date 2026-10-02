import { type AliasEngine, fuseResults, type SearchResult } from "emojisense";
import { API_URL, PUBLISHABLE_KEY } from "../../config";

export interface ReactionSuggestions {
  results: SearchResult[];
  /** "edge": the API answered (fused with on-device hits). "device": the on-device engine alone. */
  via: "edge" | "device";
  /** Round trip of the API call. */
  ms?: number;
}

const SHOWN = 6;
const API_LIMIT = 8;
const API_TIMEOUT_MS = 3500;
/** Below this, an on-device phrase hit is noise ("smoke tests" → 🚬). */
const MIN_DEVICE_SCORE = 0.5;
/** On-device phrase hits are precise ("thanks team" → ❤️), so they weigh a bit more in fusion. */
const DEVICE_WEIGHT = 1.5;
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
    for (const result of engine.search(clause, { limit: SHOWN, prefix: false, locale: "en" }).results) {
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
        body: JSON.stringify({ text, locale: "en", limit: API_LIMIT }),
        signal: timeout.signal,
      },
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as { results?: SearchResult[] };
    const results = body.results ?? [];
    return results.length > 0 ? { results, ms: performance.now() - started } : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

/**
 * Reactions for a chat message. The edge API ranks by meaning; strong on-device phrase hits
 * ("thanks team" → ❤️) are fused in the same way the SDK fuses search results. Without the API
 * the on-device engine answers alone.
 */
export async function suggestReactions(
  text: string,
  engine: Promise<AliasEngine | undefined>,
  signal: AbortSignal,
): Promise<ReactionSuggestions> {
  const [edge, device] = await Promise.all([
    suggestFromEdge(text, signal),
    engine.then((ready) => (ready ? suggestOnDevice(ready, text) : [])).catch(() => []),
  ]);
  if (!edge) return { results: device.slice(0, SHOWN), via: "device" };
  return {
    results: fuseResults(device, edge.results, { limit: SHOWN, aliasWeight: DEVICE_WEIGHT }),
    via: "edge",
    ms: edge.ms,
  };
}
