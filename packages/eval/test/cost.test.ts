import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyMeasuredRate,
  type CostAssumptions,
  computeLayeredCost,
  loadAssumptions,
  modelPrice,
  parseAssumptions,
  readMeasuredRate,
  sensitivity,
  shareGrid,
  withValue,
} from "../src/cost.ts";
import { ASSUMPTIONS_PATH } from "../src/cost-inputs.ts";
import { renderCostReport } from "../src/cost-report.ts";

/** Round numbers so every expected value below can be checked by hand. */
const base: CostAssumptions = {
  monthlySearches: 1e6,
  deviceShare: 0.5,
  useMeasuredDeviceShare: true,
  requestsPerSemanticSearch: 2,
  shardHitShare: 0.5,
  cacheHitRate: 0.2,
  cpuMsPerRequest: 2,
  model: { id: "@cf/baai/bge-m3", tokensPerQuery: 10, pricePerMTokens: null, assumedPricePerMTokens: 0.02 },
  reactions: { perSearch: 0, tokensPerRequest: 64, cpuMsPerRequest: 2 },
  images: {
    perSearch: 0,
    cacheHitRate: 0.5,
    pricePerImage: 0.001,
    tokensPerImage: 20,
    cpuMsPerRequest: 5,
    billedAsWorkersAi: true,
  },
  workers: {
    basePerMonth: 5,
    includedRequests: 1e7,
    requestPricePerM: 0.3,
    includedCpuMs: 3e7,
    cpuPricePerMMs: 0.02,
  },
  workersAi: { freeNeuronsPerDay: 10000, pricePer1kNeurons: 0.011 },
  analyticsEngine: {
    writesPerWorkerRequest: 1,
    includedWrites: 1e7,
    pricePerMWrites: 0.25,
    billingStarted: false,
  },
  sensitivity: { deviceShare: [0.2, 0.9], cacheHitRate: [0, 0.6] },
};

const dir = mkdtempSync(join(tmpdir(), "emojisense-cost-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("layered cost", () => {
  it("passes each layer only the traffic the layer before could not answer", () => {
    const { volumes } = computeLayeredCost(base);
    expect(volumes).toMatchObject({
      onDevice: 500_000,
      semanticRequests: 1_000_000,
      shardHits: 500_000,
      workerSearchRequests: 500_000,
      cacheHits: 100_000,
      embeddedSearches: 400_000,
    });
  });

  it("prices requests, CPU and embeddings; device and shards are free", () => {
    const cost = computeLayeredCost(base);
    expect(cost.lines.requests).toBeCloseTo(0.15); // 0.5M requests × $0.30
    expect(cost.lines.cpu).toBeCloseTo(0.02); // 1M CPU-ms × $0.02
    expect(cost.lines.embeddings).toBeCloseTo(0.048); // 4M tokens × $0.012
    expect(cost.marginalPerMillion).toBeCloseTo(0.218);
    expect(cost.searchPerMillion).toBeCloseTo(0.218);
    const usd = Object.fromEntries(cost.layers.map((l) => [l.layer, l.usd]));
    expect(usd["L0 on device"]).toBe(0);
    expect(usd["L2 static shards"]).toBe(0);
    expect(usd["L3 Worker, Cache API hit"]).toBeCloseTo(0.034);
    expect(usd["L3 Worker, embed + search"]).toBeCloseTo(0.184);
  });

  it("counts the plan fee and included quotas only in the all-in figure", () => {
    expect(computeLayeredCost(base).allInMonthly).toBeCloseTo(5);
    // 1B searches: 490M billable requests, 970M billable CPU-ms, $48 AI − $3.30 free neurons.
    const large = computeLayeredCost(withValue(base, "monthlySearches", 1e9));
    expect(large.allInMonthly).toBeCloseTo(5 + 147 + 19.4 + 44.7);
    expect(large.marginalPerMillion).toBeCloseTo(0.218);
  });

  it("adds reaction suggestions and images on top of search", () => {
    const withImages = computeLayeredCost(
      withValue(withValue(base, "images.perSearch", 0.01), "reactions.perSearch", 0.01),
    );
    const images = withImages.layers.find((l) => l.layer === "Image classification");
    // 10k requests, 5k model calls × $0.001, 100k caption tokens, 10k requests, 50k CPU-ms.
    expect(images?.usd).toBeCloseTo(5 + 0.0012 + 0.003 + 0.001);
    const reactions = withImages.layers.find((l) => l.layer === "Reaction suggestions");
    expect(reactions?.usd).toBeCloseTo(0.003 + 0.0004 + 0.00768);
    expect(withImages.searchPerMillion).toBeCloseTo(0.218);
  });

  it("bills Analytics Engine writes only once billing has started", () => {
    expect(computeLayeredCost(base).lines.analyticsEngine).toBe(0);
    expect(computeLayeredCost(base).analyticsEngineIfBilled).toBeCloseTo(0.125);
    const billed = structuredClone(base);
    billed.analyticsEngine.billingStarted = true;
    expect(computeLayeredCost(billed).lines.analyticsEngine).toBeCloseTo(0.125);
  });

  it("uses the listed price, an explicit override, or a flagged assumption", () => {
    expect(modelPrice(base)).toMatchObject({ pricePerMTokens: 0.012, source: "listed" });
    expect(modelPrice(withValue(base, "model.pricePerMTokens", 0.05)).source).toBe("override");
    const gemma = structuredClone(base);
    gemma.model.id = "@cf/google/embeddinggemma-300m";
    expect(modelPrice(gemma)).toMatchObject({ pricePerMTokens: 0.02, source: "assumed" });
  });
});

describe("sensitivity", () => {
  it("varies one input at a time around the base value", () => {
    const rows = sensitivity(base);
    expect(rows.map((r) => r.path)).toEqual(["deviceShare", "cacheHitRate"]);
    const device = rows[0];
    expect(device?.values).toEqual([0.2, 0.5, 0.9]);
    expect(device?.marginal[1]).toBeCloseTo(0.218);
    expect(device?.marginal[0]).toBeGreaterThan(device?.marginal[2] ?? 0);
  });

  it("grids L0 share against L2 share", () => {
    const grid = shareGrid(base, [0.5, 0.9], [0.5, 0.9]);
    expect(grid[0]?.[0]).toBeCloseTo(0.218);
    expect(grid[1]?.[1]).toBeLessThan(grid[0]?.[0] ?? 0);
  });
});

describe("assumptions", () => {
  it("parses the committed assumptions file", () => {
    const a = loadAssumptions(ASSUMPTIONS_PATH);
    expect(a.monthlySearches).toBeGreaterThan(0);
    expect(Object.keys(a).some((k) => k.startsWith("//"))).toBe(false);
    expect(sensitivity({ ...a, model: { ...a.model, id: "@cf/baai/bge-m3" } }).length).toBeGreaterThan(0);
  });

  it("rejects shares outside 0–1 and unknown sensitivity keys", () => {
    expect(() => parseAssumptions(JSON.stringify({ ...base, cacheHitRate: 1.2 }))).toThrow("cacheHitRate");
    expect(() => parseAssumptions(JSON.stringify({ ...base, sensitivity: { nope: [0, 1] } }))).toThrow(
      "nope",
    );
  });

  it("reads the measured rate from the eval report and applies it", () => {
    const report = join(dir, "latest.json");
    writeFileSync(
      report,
      JSON.stringify({ date: "2026-10-02T00:00:00Z", gate: { semanticRate: 0.37, n: 214 } }),
    );
    const measured = readMeasuredRate(report);
    expect(measured?.semanticRate).toBe(0.37);
    expect(applyMeasuredRate(base, measured).deviceShare).toBeCloseTo(0.63);
    expect(applyMeasuredRate({ ...base, useMeasuredDeviceShare: false }, measured).deviceShare).toBe(0.5);
  });

  it("falls back to a fused-gated engine, then to nothing", () => {
    const report = join(dir, "engines.json");
    writeFileSync(
      report,
      JSON.stringify({
        engines: [
          { name: "alias", kind: "alias" },
          { name: "fg", kind: "fused-gated", semanticRate: 0.4 },
        ],
      }),
    );
    expect(readMeasuredRate(report)?.semanticRate).toBe(0.4);
    expect(readMeasuredRate(join(dir, "missing.json"))).toBeUndefined();
  });
});

describe("cost report", () => {
  it("renders the headline, the per-layer table and the sensitivity table", () => {
    const text = renderCostReport(base, { level: 2 }).join("\n");
    expect(text).toContain("## Layered cost per 1M searches");
    expect(text).toContain("**Effective: $0.218 per 1M searches**");
    expect(text).toContain("| L3 Worker, embed + search |");
    expect(text).toContain("### Sensitivity");
  });
});
