import { describe, expect, it } from "vitest";
import type { SearchBody } from "../src/search.ts";
import { harness, keyedSearch } from "./fixtures.ts";
import { memoryR2 } from "./memory-r2.ts";

/** Two data centers: each harness has its own Cache API, both share one R2 bucket. */
function dataCenters(enabled = "true") {
  const r2 = memoryR2();
  const env = { SHARDS: r2.r2, ANSWER_CACHE_ENABLED: enabled };
  return { r2, a: harness({ env }), b: harness({ env }) };
}

describe("global answer cache", () => {
  it("answers a query from R2 in a data center that has not seen it, with no model call", async () => {
    const { r2, a, b } = dataCenters();
    const first = (await (await a.call(keyedSearch("lava eruption"))).json()) as SearchBody;
    await a.ctx.settle();
    expect(first.cached).toBe(false);
    const stored = r2.keys("answers/");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^answers\/[0-9a-f]{64}$/);

    const second = (await (await b.call(keyedSearch("lava eruption"))).json()) as SearchBody;
    expect(second.cached).toBe(true);
    expect(second.results).toEqual(first.results);
    expect(b.ai).not.toHaveBeenCalled();
    // Copied into the second data center's own cache.
    await b.ctx.settle();
    expect(b.cache.puts).toHaveLength(1);
  });

  it("stays off unless ANSWER_CACHE_ENABLED is true", async () => {
    const { r2, a, b } = dataCenters("false");
    await a.call(keyedSearch("lava eruption"));
    await a.ctx.settle();
    expect(r2.objects.size).toBe(0);
    await b.call(keyedSearch("lava eruption"));
    expect(b.ai).toHaveBeenCalled();
  });
});
