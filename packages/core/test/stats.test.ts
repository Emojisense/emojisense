import { describe, expect, it, vi } from "vitest";
import type { SessionState } from "../src/session.js";
import { createStatsReporter } from "../src/stats.js";

const state = (query: string, status: SessionState["status"], extra: Partial<SessionState> = {}) =>
  ({
    query,
    status,
    results: [],
    unsure: false,
    confidence: 1,
    aliasMs: 0,
    ...extra,
  }) as unknown as SessionState;

const reporter = (send = vi.fn(), sampleRate = 1) =>
  createStatsReporter({ endpoint: "https://stats.test/", key: "pk_test", locale: "tr", sampleRate, send });

describe("stats reporter", () => {
  it("counts how each keystroke's search ended", () => {
    const send = vi.fn();
    const stats = reporter(send);
    // Typed letter by letter: the first two waited and were replaced.
    for (const q of ["v", "vo"]) stats.observe(state(q, "loading"));
    stats.observe(state("vol", "alias"));
    stats.observe(state("volcano", "fused", { semanticMs: 0, layer: "shard" }));
    stats.observe(state("volcano e", "loading"));
    stats.observe(state("volcano e", "fused", { semanticMs: 30, layer: "shard" }));
    stats.observe(state("volcano er", "loading"));
    stats.observe(state("volcano er", "fused", { semanticMs: 300, layer: "api" }));
    stats.observe(state("zzz", "loading"));
    stats.observe(state("zzz", "alias"));
    stats.observe(state("x", "loading"));
    stats.observe(state("x", "error"));
    stats.observe(state("", "idle"));
    stats.flush();

    const [url, body] = send.mock.calls[0] as [string, string];
    expect(url).toBe("https://stats.test/v1/events?key=pk_test");
    expect(JSON.parse(body)).toEqual({
      v: 1,
      sample: 1,
      locale: "tr",
      counts: { device: 1, memory: 1, shard: 1, api: 1, none: 1, error: 1, cancelled: 2 },
      picks: [],
    });
  });

  it("sends picks as normalized text and emoji, at most 50, and nothing when there is nothing", () => {
    const send = vi.fn();
    const stats = reporter(send);
    stats.flush();
    expect(send).not.toHaveBeenCalled();
    for (let i = 0; i < 60; i++) stats.pick(`  Happy  Birthday ${i}`, "1F382");
    stats.pick("   ", "1F382");
    stats.flush();
    const { picks } = JSON.parse(send.mock.calls[0]?.[1] as string);
    expect(picks).toHaveLength(50);
    expect(picks[0]).toEqual(["happy birthday 0", "1F382"]);
    stats.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing in a session outside the sample", () => {
    const send = vi.fn();
    const stats = createStatsReporter({
      endpoint: "https://stats.test",
      sampleRate: 0.1,
      send,
      random: () => 0.5,
    });
    stats.observe(state("v", "alias"));
    stats.pick("v", "1F30B");
    stats.dispose();
    expect(send).not.toHaveBeenCalled();
  });

  it("reports when the page is hidden", () => {
    // A browser window's events; Node has none.
    const window = new EventTarget();
    vi.stubGlobal("addEventListener", window.addEventListener.bind(window));
    vi.stubGlobal("removeEventListener", window.removeEventListener.bind(window));
    try {
      const send = vi.fn();
      const stats = reporter(send);
      stats.observe(state("v", "alias"));
      window.dispatchEvent(new Event("pagehide"));
      expect(send).toHaveBeenCalledTimes(1);
      stats.dispose();
      stats.observe(state("v", "alias"));
      window.dispatchEvent(new Event("pagehide"));
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
