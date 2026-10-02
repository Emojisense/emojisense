/**
 * Workers AI embeddings for batch jobs, with a content-addressed disk cache so reruns are free.
 *
 * Auth, in order:
 *   1. CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID → REST API
 *   2. otherwise wrangler's login, via getPlatformProxy() with a remote AI binding
 * Cache: .cache/embeddings/<model-key>.json  { sha256(text): base64(float32[]) }
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EmbeddingModel } from "./models.ts";
import { CACHE_DIR, DATA_ROOT } from "./paths.ts";

type Run = (model: string, input: Record<string, unknown>) => Promise<unknown>;

type Runner = { run: Run; dispose: () => Promise<void> };

// A promise, not the runner: concurrent first calls must share one wrangler proxy, or the extra
// proxies are never disposed and keep the process alive.
let runner: Promise<Runner> | undefined;

function getRunner(): Promise<Runner> {
  runner ??= createRunner();
  return runner;
}

async function createRunner(): Promise<Runner> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (token && account) {
    return {
      run: async (model, input) => {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        const body = (await response.json()) as { success: boolean; result: unknown; errors: unknown };
        if (!body.success) throw new Error(`Workers AI ${model}: ${JSON.stringify(body.errors)}`);
        return body.result;
      },
      dispose: async () => {},
    };
  }
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ AI: { run: Run } }>({
    configPath: join(DATA_ROOT, "wrangler.embed.jsonc"),
  });
  return { run: (m, i) => proxy.env.AI.run(m, i), dispose: () => proxy.dispose() };
}

export async function disposeEmbeddings() {
  const current = runner;
  runner = undefined;
  // A runner that failed to start has nothing to dispose; its error already reached the caller.
  const started = await current?.catch(() => undefined);
  await started?.dispose();
}

const hash = (model: EmbeddingModel, kind: string, text: string) =>
  createHash("sha256").update(`${model.id}\n${kind}\n${text}`).digest("hex").slice(0, 32);

function cachePath(model: EmbeddingModel) {
  return join(CACHE_DIR, "embeddings", `${model.key}.json`);
}

function loadCache(model: EmbeddingModel): Record<string, string> {
  const path = cachePath(model);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

function saveCache(model: EmbeddingModel, cache: Record<string, string>) {
  mkdirSync(join(CACHE_DIR, "embeddings"), { recursive: true });
  writeFileSync(cachePath(model), JSON.stringify(cache));
}

const toBase64 = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
const fromBase64 = (s: string) => {
  const bytes = Buffer.from(s, "base64");
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
};

function extractVectors(result: unknown): number[][] {
  const r = result as { data?: number[][]; response?: number[][] };
  const data = r.data ?? r.response;
  if (!Array.isArray(data))
    throw new Error(`unexpected Workers AI response: ${JSON.stringify(result).slice(0, 200)}`);
  return data;
}

export interface EmbedStats {
  cached: number;
  fetched: number;
  /** Wall time of each uncached API call, ms. */
  callMs: number[];
}

/**
 * Embed already-formatted texts (apply the model's query/document template first).
 * Returns full native-dimension vectors in input order.
 *
 * `persist: false` skips the disk cache. The shard builder embeds up to ~1M queries a night;
 * the single-file JSON cache would grow to gigabytes and be rewritten after every batch.
 */
export async function embedTexts(
  model: EmbeddingModel,
  texts: string[],
  kind: "query" | "document",
  options: {
    batchSize?: number;
    offline?: boolean;
    persist?: boolean;
    onProgress?: (done: number) => void;
  } = {},
): Promise<{ vectors: Float32Array[]; stats: EmbedStats }> {
  const persist = options.persist ?? true;
  const cache = persist ? loadCache(model) : {};
  const keys = texts.map((t) => hash(model, kind, t));
  const missing = [...new Set(keys.map((k, i) => (cache[k] ? -1 : i)).filter((i) => i >= 0))];
  const stats: EmbedStats = { cached: texts.length - missing.length, fetched: 0, callMs: [] };

  if (missing.length > 0) {
    if (options.offline) {
      throw new Error(`${model.key}: ${missing.length} ${kind} embeddings not cached and --offline is set`);
    }
    const { run } = await getRunner();
    const batchSize = Math.min(options.batchSize ?? model.maxBatch, model.maxBatch);
    for (let start = 0; start < missing.length; start += batchSize) {
      const batch = missing.slice(start, start + batchSize);
      const started = performance.now();
      const vectors = extractVectors(
        await run(
          model.id,
          model.input(
            batch.map((i) => texts[i] as string),
            kind,
          ),
        ),
      );
      stats.callMs.push(performance.now() - started);
      if (vectors.length !== batch.length) {
        throw new Error(`${model.key}: asked for ${batch.length} vectors, got ${vectors.length}`);
      }
      batch.forEach((i, j) => {
        cache[keys[i] as string] = toBase64(Float32Array.from(vectors[j] as number[]));
      });
      stats.fetched += batch.length;
      if (persist) saveCache(model, cache);
      options.onProgress?.(stats.cached + stats.fetched);
    }
  }
  return { vectors: keys.map((k) => fromBase64(cache[k] as string)), stats };
}

/** Vectors already in the disk cache, in input order; `undefined` where a text was never embedded. */
export function readCachedEmbeddings(
  model: EmbeddingModel,
  texts: readonly string[],
  kind: "query" | "document",
): (Float32Array | undefined)[] {
  const cache = loadCache(model);
  return texts.map((text) => {
    const hit = cache[hash(model, kind, text)];
    return hit ? fromBase64(hit) : undefined;
  });
}

/** Time single-text calls that bypass the cache (round trip from this machine to Workers AI). */
export async function measureLatency(model: EmbeddingModel, texts: string[]): Promise<number[]> {
  const { run } = await getRunner();
  const timings: number[] = [];
  for (const text of texts) {
    const started = performance.now();
    extractVectors(await run(model.id, model.input([text], "query")));
    timings.push(performance.now() - started);
  }
  return timings;
}

/** Run any Workers AI model (e.g. an LLM for alias mining) with the same auth as embeddings. */
export async function runWorkersAI(model: string, input: Record<string, unknown>): Promise<unknown> {
  const { run } = await getRunner();
  return run(model, input);
}
