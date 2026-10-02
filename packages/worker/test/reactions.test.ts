import { describe, expect, it, vi } from "vitest";
import { truncateText } from "../src/reactions.ts";
import type { SearchBody } from "../src/search.ts";
import { API, EMBEDDING_MODEL, harness, reactions } from "./fixtures.ts";

describe("POST /v1/suggest-reactions", () => {
  it("ranks alias and semantic results for a whole message", async () => {
    const h = harness();
    const res = await h.call(reactions({ text: "Jurassic Park vibes today!" }));
    const body = (await res.json()) as SearchBody;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ cached: false, degraded: false, overLimit: false, packVersion: "test" });
    const sources = new Set(body.results.map((r) => r.source));
    expect(sources).toEqual(new Set(["alias", "semantic"]));
    expect(body.results.some((r) => r.emoji === "🦖" && r.source === "alias")).toBe(true);
    expect(body.results.length).toBeLessThanOrEqual(8);
    expect(h.ai).toHaveBeenCalledWith(EMBEDDING_MODEL, {
      text: ["Jurassic Park vibes today!"],
    });
  });

  it("cuts the text to 256 characters before it reaches the model", async () => {
    const h = harness();
    await h.call(reactions({ text: `${"🎉".repeat(300)} tail` }));
    const input = h.ai.mock.calls[0]?.[1] as { text: string[] } | undefined;
    const text = input?.text[0] ?? "";
    expect(Array.from(text)).toHaveLength(256);
    expect(text).not.toContain("tail");
    // Whole emoji only: a split surrogate pair would show up as a different element.
    expect(new Set(Array.from(text))).toEqual(new Set(["🎉"]));
  });

  it("never caches or logs the text", async () => {
    const h = harness();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secret = "my salary is 123456";
    const res = await h.call(reactions({ text: secret }));
    h.env.AI = { run: async () => Promise.reject(new Error(`model failed on: ${secret}`)) };
    await h.call(reactions({ text: secret }));
    await h.ctx.settle();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.cache.puts).toEqual([]);
    expect(h.events).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify([h.events.mock.calls, warn.mock.calls]);
    expect(logged).not.toContain("salary");
    expect(h.events.mock.calls[0]?.[0].blobs).toEqual(["", "en", "hybrid", "miss", "reactions"]);
    warn.mockRestore();
  });

  it("validates the request", async () => {
    const h = harness();
    expect((await h.call(reactions("not json"))).status).toBe(400);
    expect((await h.call(reactions({ text: "   " }))).status).toBe(400);
    expect((await h.call(reactions({ text: 42 }))).status).toBe(400);
    expect((await h.call(reactions({ text: "x".repeat(20_000) }))).status).toBe(413);
    expect((await h.call(new Request(`${API}/v1/suggest-reactions`))).status).toBe(405);
  });

  it("honours locale and limit", async () => {
    const body = (await (
      await harness().call(reactions({ text: "rocket launch", locale: "tr", limit: 2 }))
    ).json()) as SearchBody;
    expect(body.results).toHaveLength(2);
  });
});

describe("truncateText", () => {
  it("collapses whitespace and counts code points", () => {
    expect(truncateText("  a \n\t b  ", 10)).toBe("a b");
    expect(truncateText("🎉🎉🎉", 2)).toBe("🎉🎉");
  });
});
