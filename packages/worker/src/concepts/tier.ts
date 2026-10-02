import { privacyReason } from "@emojisense/data/shards";
import { type ConceptInfo as CoreConceptInfo, embeddingText, type SearchResult } from "emojisense";
import type { CacheLike } from "../context.ts";
import type { Env, RateLimiter } from "../env.ts";
import { json } from "../http.ts";
import { type Catalog, embedTexts, semanticResults } from "../semantic.ts";
import {
  CONCEPT_DEFAULT_DAILY_CAP,
  CONCEPT_EDGE_CACHE_SECONDS,
  CONCEPT_MAX_IN_FLIGHT,
  CONCEPT_TAG,
  CONCEPT_TIMEOUT_MS,
  MAX_CONCEPT_RESULTS,
} from "./config.ts";
import { askModel, type ConceptAnswer, type ConceptKind, isBlocked } from "./model.ts";
import { neighbourText, type RankedConcept, rankConcept } from "./rank.ts";
import { type ConceptStore, conceptKey, type StoredConcept } from "./store.ts";

/**
 * The `concept` field of a search answer (core's `ConceptInfo`, docs/API.md). `ok`: concept
 * results are in the answer. `none`: the model did not know the query (or it was blocked); cached
 * like an answer. `pending`: the model is still working; ask again in a moment (not cached).
 * `unavailable`: no model call now (budget, rate limit, Workers AI error). Never model text:
 * `terms` are catalog phrases.
 */
export type ConceptInfo = CoreConceptInfo & { kind?: ConceptKind };

export interface ConceptOutcome {
  info: ConceptInfo;
  /** `source: "concept"`, best first. */
  results: SearchResult[];
  /** This request started a model call (metered as CONCEPT_METERED_CALLS). */
  modelCall: boolean;
  /** The search answer may enter the shared cache: the status is final. */
  cacheable: boolean;
  ms: number;
}

export interface ConceptContext {
  env: Env;
  catalog: Catalog;
  cache: CacheLike;
  waitUntil(promise: Promise<unknown>): void;
  origin: string;
  /** Request time, ms: the UTC day of the daily cap. */
  now: number;
  /** Without a database: no durable cache and no daily cap (local development). */
  store?: ConceptStore | undefined;
  /** The caller's rate limiter and key, reused with a `concept:` prefix. */
  limiter?: { binding: RateLimiter | undefined; key: string } | undefined;
  /** Tests shorten the wait. */
  timeoutMs?: number;
}

/** Off with CONCEPTS_ENABLED=false, or without Workers AI. */
export function conceptsEnabled(env: Env): boolean {
  return env.CONCEPTS_ENABLED !== "false" && env.AI !== undefined;
}

/** Part of the search cache key: answers of another model, prompt or setting are never reused. */
export function conceptCacheTag(env: Env): string {
  return conceptsEnabled(env) ? CONCEPT_TAG : "off";
}

export function dailyCap(env: Env): number {
  const parsed = Number.parseInt(env.CONCEPT_DAILY_CAP ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : CONCEPT_DEFAULT_DAILY_CAP;
}

/** Same rules as the search cache key: no key, user or origin; model, prompt and data in it. */
export function conceptEdgeKey(origin: string, query: string, locale: string, contentHash: string): Request {
  const params = new URLSearchParams({ q: query, locale, v: CONCEPT_TAG, c: contentHash });
  return new Request(`${origin}/v1/concept?${params}`);
}

interface Resolved {
  answer: ConceptAnswer | undefined;
  ranked: RankedConcept | undefined;
}

// Per isolate: model calls in flight, shared by concurrent searches of the same query.
const inflight = new Map<string, Promise<Resolved>>();
let running = 0;

const results = (catalog: Catalog, ranked: StoredConcept["ranked"]): SearchResult[] => {
  if (!ranked) return [];
  const engine = catalog.engine();
  return ranked.results.flatMap(([id, score]): SearchResult[] => {
    const emoji = engine.get(id)?.emoji;
    return emoji ? [{ emoji, id, score, source: "concept" }] : [];
  });
};

const info = (answer: ConceptAnswer | undefined, display: string[] | undefined): ConceptInfo =>
  answer
    ? { status: "ok", kind: answer.kind, ...(display && display.length > 0 ? { terms: display } : {}) }
    : { status: "none" };

/** The semantic neighbours of an answer's terms (shared English vectors), then the ranking. */
async function rank(env: Env, catalog: Catalog, answer: ConceptAnswer): Promise<RankedConcept> {
  let neighbours: SearchResult[] | undefined;
  const text = neighbourText(answer);
  if (text) {
    try {
      const [vector] = await embedTexts(env, catalog, [embeddingText(text, 128)]);
      if (vector) neighbours = semanticResults(catalog.engine(), [catalog.index()], vector, MAX_CONCEPT_RESULTS);
    } catch (error) {
      console.warn(JSON.stringify({ event: "concept_embed_failed", error: (error as Error).name }));
    }
  }
  return rankConcept(catalog.engine(), answer, neighbours);
}

const toStored = (resolved: Resolved, contentHash: string, now: number): StoredConcept => ({
  answer: resolved.answer,
  ranked: resolved.ranked
    ? {
        contentHash,
        results: resolved.ranked.results.map((r): [string, number] => [r.id, r.score]),
        display: resolved.ranked.display,
      }
    : undefined,
  createdAt: now,
});

async function readEdge(cache: CacheLike, key: Request): Promise<StoredConcept | undefined> {
  try {
    const hit = await cache.match(key);
    if (!hit) return undefined;
    const stored = (await hit.json()) as { answer?: ConceptAnswer | null; ranked?: StoredConcept["ranked"] };
    return { answer: stored.answer ?? undefined, ranked: stored.ranked ?? undefined, createdAt: 0 };
  } catch {
    return undefined;
  }
}

function writeEdge(cache: CacheLike, key: Request, stored: StoredConcept): Promise<void> {
  const body = json({ answer: stored.answer ?? null, ranked: stored.ranked ?? null }, 200, {
    "Cache-Control": `public, max-age=${CONCEPT_EDGE_CACHE_SECONDS}`,
  });
  return cache.put(key, body).catch(() => {});
}

/**
 * The concept tier for one unsure query (normalized text): edge cache → D1 → a model call within
 * the budget (per-isolate concurrency, the caller's rate limiter, the global daily cap). Never
 * throws. The query must already be unsure: the caller decides (assessConfidence).
 */
export async function resolveConcept(ctx: ConceptContext, query: string, locale: string): Promise<ConceptOutcome> {
  const started = Date.now();
  const { env, catalog, cache, store } = ctx;
  const { contentHash } = catalog.config;
  const outcome = (
    resolved: { info: ConceptInfo; results: SearchResult[] },
    flags: { modelCall?: boolean; cacheable?: boolean } = {},
  ): ConceptOutcome => ({
    ...resolved,
    modelCall: flags.modelCall ?? false,
    cacheable: flags.cacheable ?? true,
    ms: Date.now() - started,
  });
  // Personal-looking or blocked text never goes to the model.
  if (privacyReason(query) || isBlocked(query, locale)) return outcome({ info: { status: "none" }, results: [] });

  const edgeKey = conceptEdgeKey(ctx.origin, query, locale, contentHash);
  const edge = await readEdge(cache, edgeKey);
  if (edge) return outcome({ info: info(edge.answer, edge.ranked?.display), results: results(catalog, edge.ranked) });

  const key = await conceptKey(query, locale);
  let stored: StoredConcept | undefined;
  try {
    stored = await store?.get(key, CONCEPT_TAG);
  } catch (error) {
    console.warn(JSON.stringify({ event: "concept_store_unavailable", error: (error as Error).name }));
  }
  if (stored) {
    let ranked = stored.ranked;
    if (stored.answer && ranked?.contentHash !== contentHash) {
      // New data since the answer was ranked: rank again, no model call.
      const fresh = toStored({ answer: stored.answer, ranked: await rank(env, catalog, stored.answer) }, contentHash, stored.createdAt);
      ranked = fresh.ranked;
      if (store) ctx.waitUntil(store.put(key, CONCEPT_TAG, fresh).catch(() => {}));
    }
    const current = { ...stored, ranked };
    ctx.waitUntil(writeEdge(cache, edgeKey, current));
    return outcome({ info: info(current.answer, ranked?.display), results: results(catalog, ranked) });
  }

  let call = inflight.get(key);
  let modelCall = false;
  if (!call) {
    const unavailable = () => outcome({ info: { status: "unavailable" }, results: [] }, { cacheable: false });
    if (running >= CONCEPT_MAX_IN_FLIGHT) return unavailable();
    const { limiter } = ctx;
    if (limiter?.binding && !(await limiter.binding.limit({ key: `concept:${limiter.key}` })).success) {
      return unavailable();
    }
    if (store) {
      const day = new Date(ctx.now).toISOString().slice(0, 10);
      const allowed = await store.takeDailyCall(day, dailyCap(env)).catch(() => false);
      if (!allowed) return unavailable();
    }
    running++;
    modelCall = true;
    call = (async (): Promise<Resolved> => {
      try {
        const answer = await askModel(env.AI, catalog.engine(), query, locale);
        const resolved = { answer, ranked: answer ? await rank(env, catalog, answer) : undefined };
        const fresh = toStored(resolved, contentHash, Date.now());
        await Promise.all([
          store?.put(key, CONCEPT_TAG, fresh).catch((error: Error) => {
            console.warn(JSON.stringify({ event: "concept_store_failed", error: error.name }));
          }),
          writeEdge(cache, edgeKey, fresh),
        ]);
        return resolved;
      } finally {
        running--;
        inflight.delete(key);
      }
    })();
    inflight.set(key, call);
  }

  const TIMEOUT = Symbol("timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    call.then(
      (value) => ({ value }),
      (error: Error) => ({ error }),
    ),
    new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), ctx.timeoutMs ?? CONCEPT_TIMEOUT_MS);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (settled === TIMEOUT) {
    // The call goes on after the answer and fills the caches for the next request.
    ctx.waitUntil(call.catch(() => {}));
    return outcome({ info: { status: "pending" }, results: [] }, { modelCall, cacheable: false });
  }
  if ("error" in settled) {
    // The error type only: a message could quote the query.
    console.warn(JSON.stringify({ event: "concept_unavailable", error: settled.error.name }));
    return outcome({ info: { status: "unavailable" }, results: [] }, { modelCall, cacheable: false });
  }
  const { answer, ranked } = toStored(settled.value, contentHash, 0);
  return outcome({ info: info(answer, ranked?.display), results: results(catalog, ranked) }, { modelCall });
}

/** Tests: forget the calls in flight of this isolate. */
export function resetConceptTier(): void {
  inflight.clear();
  running = 0;
}
