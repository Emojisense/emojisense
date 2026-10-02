import { describe, expect, it } from "vitest";
import { moderate } from "../src/blocklist.ts";
import { formatDocument, formatQuery, getModel, MODELS } from "../src/models.ts";

describe("moderate", () => {
  it("blocks slurs and explicit terms on whole tokens", () => {
    expect(moderate("nsfw content", "en")).toBe("block");
    expect(moderate("sextant", "en")).toBe("ok");
  });

  it("demotes mild profanity instead of dropping it", () => {
    expect(moderate("holy shit", "en")).toBe("demote");
  });

  it("is locale-aware: a folded Turkish swear word can be an innocent English word", () => {
    expect(moderate("you got this", "en")).toBe("ok");
    expect(moderate("take a pic", "en")).toBe("ok");
    expect(moderate("got", "tr")).toBe("block");
  });
});

describe("model templates", () => {
  it("formats EmbeddingGemma prompts per the model card", () => {
    const gemma = getModel("embeddinggemma");
    expect(formatQuery(gemma, "ship it")).toBe("task: search result | query: ship it");
    expect(formatDocument(gemma, "rocket", "launch")).toBe("title: rocket | text: launch");
  });

  it("sends Qwen3 queries with an instruction and documents without one", () => {
    const qwen = getModel("qwen3");
    expect(qwen.input(["q"], "query")).toHaveProperty("instruction");
    expect(qwen.input(["d"], "document")).toEqual({ documents: ["d"] });
  });

  it("keeps every batch within the Workers AI limits", () => {
    for (const m of MODELS) expect(m.maxBatch).toBeLessThanOrEqual(100);
    expect(() => getModel("nope")).toThrow("unknown model");
  });
});
