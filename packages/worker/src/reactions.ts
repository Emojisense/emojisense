import { normalize } from "emojisense";
import { record } from "./analytics.ts";
import { MAX_LIMIT, MAX_REACTION_BODY_BYTES, MAX_REACTION_CHARS, REACTIONS_DEFAULT_LIMIT } from "./config.ts";
import type { Handler } from "./context.ts";
import { errorResponse, json, parseLimit, parseLocale, readBodyCapped } from "./http.ts";
import { rankReactions } from "./reaction-rank.ts";
import type { SearchBody } from "./search.ts";
import { embedQuery, indexTag, modelTag } from "./semantic.ts";

/** Whitespace-collapsed and cut to `max` code points, so a surrogate pair is never split. */
export function truncateText(text: string, max: number): string {
  return Array.from(text.replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
}

/**
 * POST /v1/suggest-reactions `{ text, locale?, limit? }` over the first 256 characters. One
 * embedding call; the ranking (reaction-rank.ts) fuses emoji in the text, intent cues, the
 * reaction vocabulary ranked by the embedding, alias hits per clause and the nearest emoji. The
 * text is chat content: it is never cached, logged, or sent anywhere but the embedding model.
 * Metered as semantic_calls.
 */
export const handleReactions: Handler = async (request, env, _ctx, { catalog }, metering) => {
  const started = Date.now();
  const bytes = await readBodyCapped(request, MAX_REACTION_BODY_BYTES);
  if (!bytes) return errorResponse(413, `request body larger than ${MAX_REACTION_BODY_BYTES} bytes`);
  let input: { text?: unknown; locale?: unknown; limit?: unknown };
  try {
    input = JSON.parse(new TextDecoder().decode(bytes)) ?? {};
  } catch {
    return errorResponse(400, 'body must be JSON: { "text": "…" }');
  }
  const text = typeof input.text === "string" ? truncateText(input.text, MAX_REACTION_CHARS) : "";
  if (!text) return errorResponse(400, "missing or empty text");
  const locale = parseLocale(input.locale);
  const limit = parseLimit(input.limit, REACTIONS_DEFAULT_LIMIT, MAX_LIMIT);

  const overLimit = await metering.overLimit("semantic_calls");
  const embedded = overLimit ? { degraded: false, ms: 0 } : await embedQuery(env, catalog, text, true);
  const ranked = rankReactions(catalog.engine(), {
    text,
    locale,
    limit,
    semantic: embedded.vector ? { index: catalog.index(), vector: embedded.vector } : undefined,
  });
  if (embedded.vector) metering.count("semantic_calls");
  record(env, indexTag(catalog), {
    endpoint: "reactions",
    locale,
    mode: "hybrid",
    outcome: overLimit ? "over_limit" : embedded.degraded ? "degraded" : "miss",
    ms: Date.now() - started,
    aliasConfidence: ranked.aliasConfidence,
    semanticTop: ranked.semanticTop,
  });
  const body: SearchBody = {
    query: normalize(text),
    results: ranked.results,
    packVersion: catalog.config.packVersion,
    model: modelTag(catalog),
    cached: false,
    degraded: embedded.degraded,
    overLimit,
  };
  return json(body, 200, {
    "Cache-Control": "no-store",
    "Server-Timing": `embed;dur=${embedded.ms}, total;dur=${Date.now() - started}`,
  });
};
