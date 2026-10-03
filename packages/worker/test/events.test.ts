import { createStatsReporter } from "emojisense/stats";
import { describe, expect, it, vi } from "vitest";
import { API, harness, KEYS, seededStore } from "./fixtures.ts";

async function setup() {
  const stats = vi.fn();
  const h = harness({ store: await seededStore(), env: { STATS: { writeDataPoint: stats } } });
  const post = (body: unknown, query = `?key=${KEYS.wildcard}`, host = API) =>
    h.call(
      new Request(`${host}/v1/events${query}`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers: { "content-type": "text/plain;charset=UTF-8" },
      }),
    );
  return { h, stats, post };
}

const report = (extra: object = {}) => ({
  v: 1,
  sample: 0.1,
  locale: "pt-BR",
  counts: { device: 5, memory: 2, shard: 1, api: 1, none: 0, error: 0, cancelled: 3 },
  picks: [["Bom  Dia", "2600"]],
  ...extra,
});

describe("POST /v1/events", () => {
  it("writes the counts and each pick under the key's app, weighted by the sample", async () => {
    const { stats, post } = await setup();
    const res = await post(report());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(stats.mock.calls.map(([point]) => point)).toEqual([
      { blobs: ["counts", "pt", ""], doubles: [10, 5, 2, 1, 1, 0, 0, 3], indexes: ["app_free"] },
      { blobs: ["pick", "pt", "bom dia", "2600"], doubles: [10], indexes: ["app_free"] },
    ]);
  });

  it("counts reports without a key as anonymous", async () => {
    const { stats, post } = await setup();
    expect((await post(report({ picks: [] }), "")).status).toBe(204);
    expect(stats.mock.calls[0]?.[0].indexes).toEqual(["anon"]);
  });

  it("drops pick text that may be personal, and keeps the emoji", async () => {
    const { stats, post } = await setup();
    await post(report({ picks: [["jane doe gmail com", "1F600"]] }));
    expect(stats.mock.calls[1]?.[0].blobs).toEqual(["pick", "pt", "", "1F600"]);
  });

  it("refuses what is not a report, and reports that are too large", async () => {
    const { stats, post } = await setup();
    for (const bad of [
      "not json",
      report({ v: 2 }),
      report({ sample: 0 }),
      report({ counts: { device: -1 } }),
      report({ picks: [["x", "<script>"]] }),
      report({ picks: Array.from({ length: 51 }, () => ["x", "2600"]) }),
      report({ locale: "../../etc" }),
    ]) {
      expect((await post(bad)).status).toBe(400);
    }
    expect((await post(report({ pad: "x".repeat(20_000) }))).status).toBe(413);
    expect(stats).not.toHaveBeenCalled();
  });

  it("answers only /v1/events on a stats host", async () => {
    const { post, h } = await setup();
    expect((await post(report(), "", "https://stats.test")).status).toBe(204);
    expect((await h.call(new Request("https://stats.test/v1/search?q=lava"))).status).toBe(404);
    expect((await h.call(new Request("https://stats.test/p/test/index.json"))).status).toBe(404);
  });

  it("takes what the SDK's reporter sends", async () => {
    const { stats, h } = await setup();
    let sent: Promise<Response> | undefined;
    const reporter = createStatsReporter({
      endpoint: API,
      key: KEYS.wildcard,
      sampleRate: 1,
      send: (url, body) => {
        sent = h.call(new Request(url, { method: "POST", body }));
      },
    });
    reporter.pick("lava", "1F30B");
    reporter.flush();
    expect((await sent)?.status).toBe(204);
    expect(stats).toHaveBeenCalledTimes(2);
  });
});
