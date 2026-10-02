import type { EmojiSearchState } from "@emojisense/react";
import { describe, expect, it } from "vitest";
import {
  EMPTY_TICKET,
  formatMs,
  median,
  recordDeviceAnswer,
  recordSemanticAnswer,
  semanticLayer,
  workerCallCost,
} from "../src/ticket";

function state(layer?: string): EmojiSearchState {
  return {
    results: [],
    status: "fused",
    alias: undefined,
    aliasMs: 0.2,
    semanticMs: 40,
    semanticCached: false,
    ...(layer ? { layer } : {}),
  } as EmojiSearchState;
}

describe("semanticLayer", () => {
  it("reads the layer the SDK reports", () => {
    expect(semanticLayer(state("shard"))).toBe("shard");
    expect(semanticLayer(state("device"))).toBe("device");
    expect(semanticLayer(state("api"))).toBe("worker");
  });

  it("falls back to the Worker for hooks that do not report a layer yet", () => {
    expect(semanticLayer(state())).toBe("worker");
  });
});

describe("ticket counters", () => {
  it("counts each layer separately, with its own latencies", () => {
    let ticket = recordDeviceAnswer(EMPTY_TICKET, 0.3);
    ticket = recordDeviceAnswer(ticket, 0.1);
    ticket = recordSemanticAnswer(ticket, { layer: "shard", ms: 12, cached: false, costUsd: 0 });
    ticket = recordSemanticAnswer(ticket, { layer: "worker", ms: 45, cached: false, costUsd: 1e-6 });
    ticket = recordSemanticAnswer(ticket, { layer: "worker", ms: 9, cached: true, costUsd: 5e-7 });

    expect(ticket.device).toEqual({ answers: 2, ms: [0.3, 0.1] });
    expect(ticket.shard).toEqual({ answers: 1, ms: [12] });
    expect(ticket.worker).toEqual({ answers: 2, ms: [45, 9], cached: 1 });
    expect(ticket.costUsd).toBeCloseTo(1.5e-6);
  });

  it("never charges for shard or on-device answers", () => {
    const ticket = recordSemanticAnswer(EMPTY_TICKET, { layer: "shard", ms: 10, cached: false, costUsd: 99 });
    expect(ticket.costUsd).toBe(0);
  });

  it("keeps a bounded number of latency samples", () => {
    let ticket = EMPTY_TICKET;
    for (let i = 0; i < 250; i++) ticket = recordDeviceAnswer(ticket, i);
    expect(ticket.device.answers).toBe(250);
    expect(ticket.device.ms).toHaveLength(200);
    expect(ticket.device.ms.at(-1)).toBe(249);
  });

  it("does not mutate the previous ticket", () => {
    recordDeviceAnswer(EMPTY_TICKET, 1);
    expect(EMPTY_TICKET.device.answers).toBe(0);
  });
});

describe("helpers", () => {
  it("prices a Worker call with and without the model", () => {
    const withModel = workerCallCost("jurassic park", false, "bge-m3");
    const cached = workerCallCost("jurassic park", true, "bge-m3");
    expect(withModel).toBeGreaterThan(cached);
    expect(cached).toBeCloseTo(0.3e-6 + 2 * 0.02e-6);
  });

  it("formats medians", () => {
    expect(median([])).toBeUndefined();
    expect(median([3, 1, 2])).toBe(2);
    expect(formatMs(undefined)).toBe("–");
    expect(formatMs(0.214)).toBe("0.21 ms");
    expect(formatMs(45.6)).toBe("46 ms");
  });
});
