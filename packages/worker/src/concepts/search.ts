import {
  type AliasSearchOutput,
  assessConfidence,
  mergeConcept,
  SEMANTIC_SURE,
  type SearchResult,
  semanticStrength,
} from "emojisense";
import { type Principal, rateLimitFor } from "../auth.ts";
import type { CacheLike } from "../context.ts";
import type { Env } from "../env.ts";
import type { Catalog, Ranked } from "../semantic.ts";
import { createConceptStore } from "./store.ts";
import { type ConceptInfo, conceptsEnabled, resolveConcept } from "./tier.ts";

/** What the concept step adds to a search answer (docs/API.md, "Unsure queries and concepts"). */
export interface ConceptFields {
  /** 0–1: how well the best tier understood the query. */
  confidence: number;
  /** No tier understood the query: show the results as guesses. */
  unsure: boolean;
  /** The concept tier's answer for an unsure query; null when it was not asked. */
  concept: ConceptInfo | null;
}

export interface ConceptStep extends ConceptFields {
  results: SearchResult[];
  /** False while the concept answer is not final (pending, unavailable): do not cache the search. */
  cacheable: boolean;
  /** A model call was started for this request (metered). */
  modelCall: boolean;
  ms: number;
}

/** `concept=0` (or `false`) keeps a search out of the concept tier. Default on. */
export function wantsConcepts(url: URL): boolean {
  const raw = url.searchParams.get("concept");
  return raw !== "0" && raw !== "false";
}

/** The caller's own limiter and key (auth.ts), reused for model calls under a `concept:` prefix. */
function limiterFor(env: Env, caller: Principal, request: Request) {
  // The IP is a rate-limit key only. It is never logged or stored.
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const [binding, key] = rateLimitFor(env, caller, request.headers.get("origin"), ip);
  return { binding, key };
}

/**
 * Judge the ranked answer (assessConfidence: whole-token alias coverage, semantic strength) and,
 * for an unsure query, merge the concept tier's results: after the confident alias hits in hybrid
 * mode, first in semantic mode (the SDK fuses its own alias results and merges them the same way).
 * Semantic mode ran no alias search: `aliasFor` searches the locale's aliases, and only when the
 * semantic list is weak (a strong list is never unsure), so most calls load no locale pack.
 */
export async function withConcepts(
  options: {
    env: Env;
    catalog: Catalog;
    cache: CacheLike;
    waitUntil(promise: Promise<unknown>): void;
    request: Request;
    caller: Principal;
    now: number;
    enabled: boolean;
  },
  ranked: Ranked,
  query: { text: string; locale: string; limit: number; mode: "hybrid" | "semantic" },
  aliasFor: () => Promise<AliasSearchOutput | undefined>,
): Promise<ConceptStep> {
  const { env } = options;
  const semantic = ranked.semanticList;
  let alias = ranked.alias;
  if (!alias && semantic && semanticStrength(semantic) < SEMANTIC_SURE) alias = await aliasFor();
  const verdict = assessConfidence(alias, semantic);
  const base = {
    ...verdict,
    results: ranked.results,
    concept: null,
    cacheable: true,
    modelCall: false,
    ms: 0,
  };
  // Only a real semantic list can make a query unsure enough to ask a model, and anonymous
  // callers never cause a model call.
  const asks =
    verdict.unsure &&
    semantic !== undefined &&
    options.enabled &&
    options.caller.kind === "key" &&
    conceptsEnabled(env);
  if (!asks) return base;

  const outcome = await resolveConcept(
    {
      env,
      catalog: options.catalog,
      cache: options.cache,
      waitUntil: (promise) => options.waitUntil(promise),
      origin: new URL(options.request.url).origin,
      now: options.now,
      store: env.DB ? createConceptStore(env.DB) : undefined,
      limiter: limiterFor(env, options.caller, options.request),
    },
    query.text,
    query.locale,
  );
  const results = mergeConcept(
    ranked.results,
    outcome.results,
    query.mode === "hybrid" ? alias : undefined,
    query.limit,
  );
  return {
    ...verdict,
    results,
    concept: outcome.info,
    cacheable: outcome.cacheable,
    modelCall: outcome.modelCall,
    ms: outcome.ms,
  };
}
