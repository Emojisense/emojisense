import type { AliasSearchOutput, RerankInput, SearchResult } from "emojisense";
import { rerank } from "emojisense";
import { describe, expect, it } from "vitest";
import { parseVariant, QWEN3_TASK_INSTRUCTION } from "../src/model-variants.ts";
import { createRerankFit, rerankCandidates, roundWeights } from "../src/rerank-fit.ts";

const production = { key: "bge-m3", dims: 1024 };

describe("parseVariant", () => {
  it("reads a variant and dims, and marks the production configuration", () => {
    const task = parseVariant("qwen3-task@512", production);
    expect(task).toMatchObject({ name: "qwen3-task@512", dims: 512, shipped: false });
    expect(task.query.key).toBe("qwen3-task");
    expect(task.documents.key).toBe("qwen3");
    expect(parseVariant("bge-m3@1024", production).shipped).toBe(true);
    expect(parseVariant("bge-m3@512", production).shipped).toBe(false);
  });

  it("refuses unknown variants, more dims than the model has, and a missing @dims", () => {
    expect(() => parseVariant("e5@1024", production)).toThrow(/unknown variant/);
    expect(() => parseVariant("embeddinggemma@1024", production)).toThrow(/768 dims/);
    expect(() => parseVariant("qwen3", production)).toThrow(/<variant>@<dims>/);
  });

  it("gives Qwen3 queries their instruction and documents none", () => {
    const input = (spec: string, kind: "query" | "document") =>
      parseVariant(spec, production).query.input(["kendrick lamar"], kind);
    expect(input("qwen3-task@1024", "query")).toEqual({
      queries: ["kendrick lamar"],
      instruction: QWEN3_TASK_INSTRUCTION,
    });
    // No instruction field: Workers AI applies its default (web search → passages).
    expect(input("qwen3-default@1024", "query")).toEqual({ queries: ["kendrick lamar"] });
    expect(input("qwen3-task@1024", "document")).toEqual({ documents: ["kendrick lamar"] });
    // Each query variant has its own embedding cache file.
    expect(
      new Set(
        ["qwen3", "qwen3-task", "qwen3-default"].map((k) => parseVariant(`${k}@256`, production).query.key),
      ).size,
    ).toBe(3);
  });

  it("embeds EmbeddingGemma queries with its search task prompt", () => {
    const gemma = parseVariant("embeddinggemma@256", production).query;
    expect(gemma.queryTemplate).toBe("task: search result | query: {q}");
  });
});

const result = (id: string, score: number, source: SearchResult["source"] = "semantic"): SearchResult => ({
  emoji: id,
  id,
  score,
  source,
});
const alias = (results: SearchResult[]): AliasSearchOutput =>
  ({
    query: "q",
    tokens: ["q"],
    results,
    confidence: results[0]?.score ?? 0,
    coverage: 1,
  }) as AliasSearchOutput;

describe("rerank fit", () => {
  it("leaves the pinned alias results out of the candidates", () => {
    const input: RerankInput = {
      alias: alias([result("A", 0.95, "alias"), result("B", 0.7, "alias")]),
      semantic: [result("C", 0.6)],
      semanticConfidence: 1,
    };
    const { candidates } = rerankCandidates(input, ["C"]);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.positive)).toEqual([false, true]);
  });

  it("learns to put the semantic answer above a weak alias hit when that is what the labels say", () => {
    const inputs: { input: RerankInput; answer: string }[] = Array.from({ length: 40 }, (_, i) => ({
      input: {
        alias: alias([result(`alias-${i}`, 0.6, "alias")]),
        semantic: [result(`answer-${i}`, 0.7), result(`other-${i}`, 0.5)],
        semanticConfidence: 1,
      },
      answer: `answer-${i}`,
    }));
    const items = inputs.map(({ input, answer }) => rerankCandidates(input, [answer]));
    const weights = roundWeights(createRerankFit(items)(items));
    const first = inputs.map(({ input }) => rerank(input, 1, weights)[0]?.id);
    expect(first.every((id) => id?.startsWith("answer-"))).toBe(true);
  });
});
