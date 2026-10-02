/**
 * Layered cost model (docs/ARCHITECTURE.md): L0 device → L2 static shards → L3 Worker with the
 * Cache API and a Workers AI embedding. Each layer only sees the traffic the layer before it
 * could not answer, so the L3 cache hit rate applies to the long tail, never to all searches.
 * Inputs: cost.assumptions.json. Prices: docs/RESEARCH.md.
 */
import { existsSync, readFileSync } from "node:fs";

/** Listed Workers AI prices, $ per 1M input tokens (RESEARCH.md). EmbeddingGemma has none. */
export const LISTED_PRICE_PER_M_TOKENS: Record<string, number> = {
  "@cf/baai/bge-small-en-v1.5": 0.02,
  "@cf/baai/bge-base-en-v1.5": 0.067,
  "@cf/baai/bge-large-en-v1.5": 0.204,
  "@cf/baai/bge-m3": 0.012,
  "@cf/qwen/qwen3-embedding-0.6b": 0.012,
};

export interface CostAssumptions {
  monthlySearches: number;
  deviceShare: number;
  useMeasuredDeviceShare: boolean;
  requestsPerSemanticSearch: number;
  shardHitShare: number;
  cacheHitRate: number;
  cpuMsPerRequest: number;
  model: {
    /** Workers AI model id; null until resolved from pack.config.json. */
    id: string | null;
    tokensPerQuery: number;
    pricePerMTokens: number | null;
    assumedPricePerMTokens: number;
  };
  reactions: { perSearch: number; tokensPerRequest: number; cpuMsPerRequest: number };
  images: {
    perSearch: number;
    cacheHitRate: number;
    pricePerImage: number;
    tokensPerImage: number;
    cpuMsPerRequest: number;
    billedAsWorkersAi: boolean;
  };
  workers: {
    basePerMonth: number;
    includedRequests: number;
    requestPricePerM: number;
    includedCpuMs: number;
    cpuPricePerMMs: number;
  };
  workersAi: { freeNeuronsPerDay: number; pricePer1kNeurons: number };
  analyticsEngine: {
    writesPerWorkerRequest: number;
    includedWrites: number;
    pricePerMWrites: number;
    billingStarted: boolean;
  };
  sensitivity: Partial<Record<SensitivityPath, [number, number]>>;
}

export const SENSITIVITY_PATHS = [
  "monthlySearches",
  "deviceShare",
  "shardHitShare",
  "cacheHitRate",
  "requestsPerSemanticSearch",
  "cpuMsPerRequest",
  "model.tokensPerQuery",
  "model.pricePerMTokens",
  "reactions.perSearch",
  "images.perSearch",
  "images.cacheHitRate",
  "images.pricePerImage",
] as const;
export type SensitivityPath = (typeof SENSITIVITY_PATHS)[number];

/** Drop `//` comment keys at any depth. */
function stripComments(value: unknown): unknown {
  if (Array.isArray(value) || value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith("//"))
      .map(([key, v]) => [key, stripComments(v)]),
  );
}

const SHARES: SensitivityPath[] = ["deviceShare", "shardHitShare", "cacheHitRate", "images.cacheHitRate"];
const SECTIONS = ["model", "reactions", "images", "workers", "workersAi", "analyticsEngine"] as const;

export function parseAssumptions(text: string): CostAssumptions {
  const a = stripComments(JSON.parse(text)) as CostAssumptions;
  for (const section of SECTIONS) {
    if (typeof a[section] !== "object" || a[section] === null) {
      throw new Error(`cost assumptions: section "${section}" is missing`);
    }
  }
  for (const path of SHARES) {
    const v = getPath(a, path);
    if (!(v >= 0 && v <= 1)) throw new Error(`cost assumptions: ${path} must be between 0 and 1, got ${v}`);
  }
  if (!(a.monthlySearches > 0)) throw new Error("cost assumptions: monthlySearches must be > 0");
  if (!(a.requestsPerSemanticSearch >= 0)) {
    throw new Error("cost assumptions: requestsPerSemanticSearch must be ≥ 0");
  }
  for (const key of Object.keys(a.sensitivity ?? {})) {
    if (!(SENSITIVITY_PATHS as readonly string[]).includes(key)) {
      throw new Error(
        `cost assumptions: unknown sensitivity key "${key}" (known: ${SENSITIVITY_PATHS.join(", ")})`,
      );
    }
  }
  return a;
}

export function loadAssumptions(path: string): CostAssumptions {
  return parseAssumptions(readFileSync(path, "utf8"));
}

function getPath(a: CostAssumptions, path: SensitivityPath): number {
  const [head, tail] = path.split(".") as [string, string | undefined];
  const node = (a as unknown as Record<string, unknown>)[head];
  return (tail ? (node as Record<string, number>)[tail] : node) as number;
}

/** A copy of `a` with one value replaced. */
export function withValue(a: CostAssumptions, path: SensitivityPath, value: number): CostAssumptions {
  const copy = structuredClone(a);
  const [head, tail] = path.split(".") as [string, string | undefined];
  const root = copy as unknown as Record<string, unknown>;
  if (tail) (root[head] as Record<string, number>)[tail] = value;
  else root[head] = value;
  return copy;
}

export interface MeasuredRate {
  /** Share of eval queries for which the client asks the semantic layers. */
  semanticRate: number;
  source: string;
}

/**
 * The semantic-call rate measured by `pnpm eval` (reports/latest.json): the alias gate over the
 * eval set, or else the first fused-gated engine. Undefined when the report has neither.
 */
export function readMeasuredRate(reportPath: string): MeasuredRate | undefined {
  if (!existsSync(reportPath)) return undefined;
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    date?: string;
    gate?: { semanticRate?: number; n?: number };
    engines?: { name: string; kind: string; semanticRate?: number }[];
  };
  const date = report.date?.slice(0, 10) ?? "unknown date";
  if (typeof report.gate?.semanticRate === "number") {
    return {
      semanticRate: report.gate.semanticRate,
      source: `eval gate, ${report.gate.n ?? "?"} queries, ${date}`,
    };
  }
  const gated = report.engines?.find((e) => e.kind === "fused-gated" && typeof e.semanticRate === "number");
  return gated ? { semanticRate: gated.semanticRate as number, source: `${gated.name}, ${date}` } : undefined;
}

/** Apply the measured rate when the assumptions ask for it. */
export function applyMeasuredRate(a: CostAssumptions, measured: MeasuredRate | undefined): CostAssumptions {
  if (!a.useMeasuredDeviceShare || !measured) return a;
  return withValue(a, "deviceShare", 1 - measured.semanticRate);
}

export interface ModelPrice {
  id: string;
  pricePerMTokens: number;
  source: "override" | "listed" | "assumed";
}

export function modelPrice(a: CostAssumptions): ModelPrice {
  const id = a.model.id ?? "unknown";
  if (a.model.pricePerMTokens !== null)
    return { id, pricePerMTokens: a.model.pricePerMTokens, source: "override" };
  const listed = LISTED_PRICE_PER_M_TOKENS[id];
  if (listed !== undefined) return { id, pricePerMTokens: listed, source: "listed" };
  return { id, pricePerMTokens: a.model.assumedPricePerMTokens, source: "assumed" };
}

/** Volumes per month. */
export interface Volumes {
  searches: number;
  onDevice: number;
  semanticRequests: number;
  shardHits: number;
  workerSearchRequests: number;
  cacheHits: number;
  embeddedSearches: number;
  reactionRequests: number;
  imageRequests: number;
  imageModelCalls: number;
  workerRequests: number;
  cpuMs: number;
  tokens: number;
  analyticsWrites: number;
}

export interface LayerCost {
  layer: string;
  /** Requests (or searches for L0) per month. */
  volume: number;
  /** Marginal $ per month: usage beyond included quotas, no base fee. */
  usd: number;
}

export interface LayeredCost {
  price: ModelPrice;
  volumes: Volumes;
  layers: LayerCost[];
  /** Marginal $ per month by cost line. */
  lines: { requests: number; cpu: number; embeddings: number; images: number; analyticsEngine: number };
  /** What Analytics Engine would add per month once its billing starts. */
  analyticsEngineIfBilled: number;
  /** Headline: marginal $ per 1M searches, all layers. Independent of volume. */
  marginalPerMillion: number;
  /** The same for search alone (L0–L3), without reaction suggestions and images. */
  searchPerMillion: number;
  /** $ per month at `monthlySearches`, with the base fee and the included quotas. */
  allInMonthly: number;
  allInPerMillion: number;
}

const perM = (count: number, price: number) => (count / 1e6) * price;

export function computeLayeredCost(a: CostAssumptions): LayeredCost {
  const price = modelPrice(a);
  const searches = a.monthlySearches;
  const onDevice = searches * a.deviceShare;
  const semanticRequests = (searches - onDevice) * a.requestsPerSemanticSearch;
  const shardHits = semanticRequests * a.shardHitShare;
  const workerSearchRequests = semanticRequests - shardHits;
  const cacheHits = workerSearchRequests * a.cacheHitRate;
  const embeddedSearches = workerSearchRequests - cacheHits;
  const reactionRequests = searches * a.reactions.perSearch;
  const imageRequests = searches * a.images.perSearch;
  const imageModelCalls = imageRequests * (1 - a.images.cacheHitRate);

  const ae = a.analyticsEngine;
  const w = a.workers;
  /** Marginal cost of `count` Worker requests that each use `cpuMs` and `tokens`. */
  const workerUsd = (count: number, cpuMs: number, tokens: number) => ({
    requests: perM(count, w.requestPricePerM),
    cpu: perM(count * cpuMs, w.cpuPricePerMMs),
    embeddings: perM(count * tokens, price.pricePerMTokens),
    analyticsEngine: ae.billingStarted ? perM(count * ae.writesPerWorkerRequest, ae.pricePerMWrites) : 0,
  });
  const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

  const hits = workerUsd(cacheHits, a.cpuMsPerRequest, 0);
  const misses = workerUsd(embeddedSearches, a.cpuMsPerRequest, a.model.tokensPerQuery);
  const reactions = workerUsd(reactionRequests, a.reactions.cpuMsPerRequest, a.reactions.tokensPerRequest);
  const imageWorker = workerUsd(imageRequests, a.images.cpuMsPerRequest, 0);
  const imageCaptions = perM(imageModelCalls * a.images.tokensPerImage, price.pricePerMTokens);
  const imageModel = imageModelCalls * a.images.pricePerImage;

  const layers: LayerCost[] = [
    { layer: "L0 on device", volume: onDevice, usd: 0 },
    { layer: "L2 static shards", volume: shardHits, usd: 0 },
    { layer: "L3 Worker, Cache API hit", volume: cacheHits, usd: sum(hits) },
    { layer: "L3 Worker, embed + search", volume: embeddedSearches, usd: sum(misses) },
    { layer: "Reaction suggestions", volume: reactionRequests, usd: sum(reactions) },
    {
      layer: "Image classification",
      volume: imageRequests,
      usd: sum(imageWorker) + imageCaptions + imageModel,
    },
  ];
  const parts = [hits, misses, reactions, imageWorker];
  const lines = {
    requests: parts.reduce((s, p) => s + p.requests, 0),
    cpu: parts.reduce((s, p) => s + p.cpu, 0),
    embeddings: parts.reduce((s, p) => s + p.embeddings, 0) + imageCaptions,
    images: imageModel,
    analyticsEngine: parts.reduce((s, p) => s + p.analyticsEngine, 0),
  };
  const marginalMonthly = sum(lines);

  const workerRequests = workerSearchRequests + reactionRequests + imageRequests;
  const cpuMs =
    workerSearchRequests * a.cpuMsPerRequest +
    reactionRequests * a.reactions.cpuMsPerRequest +
    imageRequests * a.images.cpuMsPerRequest;
  const tokens =
    embeddedSearches * a.model.tokensPerQuery +
    reactionRequests * a.reactions.tokensPerRequest +
    imageModelCalls * a.images.tokensPerImage;
  const analyticsWrites = workerRequests * ae.writesPerWorkerRequest;

  // All-in: the plan fee, then only usage above each included quota. The daily free neurons
  // are a monthly credit against everything billed by Workers AI.
  const freeAiCredit = ((a.workersAi.freeNeuronsPerDay * 30) / 1000) * a.workersAi.pricePer1kNeurons;
  const workersAiUsd = lines.embeddings + (a.images.billedAsWorkersAi ? lines.images : 0);
  const allInMonthly =
    w.basePerMonth +
    perM(Math.max(0, workerRequests - w.includedRequests), w.requestPricePerM) +
    perM(Math.max(0, cpuMs - w.includedCpuMs), w.cpuPricePerMMs) +
    Math.max(0, workersAiUsd - freeAiCredit) +
    (a.images.billedAsWorkersAi ? 0 : lines.images) +
    (ae.billingStarted ? perM(Math.max(0, analyticsWrites - ae.includedWrites), ae.pricePerMWrites) : 0);

  return {
    price,
    volumes: {
      searches,
      onDevice,
      semanticRequests,
      shardHits,
      workerSearchRequests,
      cacheHits,
      embeddedSearches,
      reactionRequests,
      imageRequests,
      imageModelCalls,
      workerRequests,
      cpuMs,
      tokens,
      analyticsWrites,
    },
    layers,
    lines,
    analyticsEngineIfBilled: perM(analyticsWrites, ae.pricePerMWrites),
    marginalPerMillion: marginalMonthly / (searches / 1e6),
    searchPerMillion: (sum(hits) + sum(misses)) / (searches / 1e6),
    allInMonthly,
    allInPerMillion: allInMonthly / (searches / 1e6),
  };
}

export interface SensitivityRow {
  path: SensitivityPath;
  values: [number, number, number];
  /** Marginal $ per 1M searches at low, base, high. */
  marginal: [number, number, number];
  /** All-in $ per 1M searches at low, base, high. */
  allIn: [number, number, number];
}

/** One-at-a-time sensitivity over the ranges in `a.sensitivity`. */
export function sensitivity(a: CostAssumptions): SensitivityRow[] {
  return (Object.entries(a.sensitivity ?? {}) as [SensitivityPath, [number, number]][]).map(
    ([path, [low, high]]) => {
      const base = path === "model.pricePerMTokens" ? modelPrice(a).pricePerMTokens : getPath(a, path);
      const values: [number, number, number] = [low, base, high];
      const results = values.map((v) => computeLayeredCost(withValue(a, path, v)));
      return {
        path,
        values,
        marginal: results.map((r) => r.marginalPerMillion) as [number, number, number],
        allIn: results.map((r) => r.allInPerMillion) as [number, number, number],
      };
    },
  );
}

/** Marginal $ per 1M searches for each L0 share (rows) × L2 share (columns). */
export function shareGrid(
  a: CostAssumptions,
  deviceShares: readonly number[],
  shardShares: readonly number[],
): number[][] {
  return deviceShares.map((device) =>
    shardShares.map(
      (shard) =>
        computeLayeredCost(withValue(withValue(a, "deviceShare", device), "shardHitShare", shard))
          .marginalPerMillion,
    ),
  );
}
