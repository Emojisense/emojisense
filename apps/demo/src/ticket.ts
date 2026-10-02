import type { EmojiSearchState } from "@emojisense/react";
import { useEffect, useRef, useState } from "react";

/** Cloudflare list prices (docs/RESEARCH.md). EmbeddingGemma is unpriced: bge-small's rate assumed. */
const REQUEST_USD = 0.3 / 1e6;
const CPU_MS_USD = 0.02 / 1e6;
const CPU_MS_PER_REQUEST = 2;
const TOKEN_USD: Record<string, number> = {
  "bge-small": 0.02 / 1e6,
  "bge-m3": 0.012 / 1e6,
  qwen3: 0.012 / 1e6,
  embeddinggemma: 0.02 / 1e6,
};
const TEMPLATE_CHARS = 30;
/** A query that stays unchanged this long counts as one finished search. */
const SETTLE_MS = 800;
/** Keep the latest latencies only; medians over a long session stay cheap. */
const MAX_SAMPLES = 200;

/** Where an answer came from (docs/ARCHITECTURE.md, layers). */
export type Layer = "device" | "shard" | "worker";

export interface LayerTally {
  answers: number;
  ms: number[];
}

export interface Ticket {
  keystrokes: number;
  searches: number;
  device: LayerTally;
  shard: LayerTally;
  worker: LayerTally & { cached: number };
  costUsd: number;
}

export const EMPTY_TICKET: Ticket = {
  keystrokes: 0,
  searches: 0,
  device: { answers: 0, ms: [] },
  shard: { answers: 0, ms: [] },
  worker: { answers: 0, ms: [], cached: 0 },
  costUsd: 0,
};

/**
 * Which layer gave the semantic part of a fused answer. `useEmojiSearch` gains a `layer` field in
 * a later SDK release, so it is read defensively: without it, the answer came from the API, the
 * only semantic provider older hooks create.
 */
export function semanticLayer(state: EmojiSearchState): Layer {
  const layer = (state as { layer?: string }).layer;
  if (layer === "shard") return "shard";
  if (layer === "device") return "device";
  return "worker";
}

function addSample(tally: LayerTally, ms: number): LayerTally {
  return { answers: tally.answers + 1, ms: [...tally.ms.slice(1 - MAX_SAMPLES), ms] };
}

/** The dictionary answered a keystroke on the device. */
export function recordDeviceAnswer(ticket: Ticket, ms: number): Ticket {
  return { ...ticket, device: addSample(ticket.device, ms) };
}

/** A semantic answer arrived. Only Worker answers cost money; shard and device answers are free. */
export function recordSemanticAnswer(
  ticket: Ticket,
  answer: { layer: Layer; ms: number; cached: boolean; costUsd: number },
): Ticket {
  if (answer.layer === "worker") {
    return {
      ...ticket,
      worker: {
        ...addSample(ticket.worker, answer.ms),
        cached: ticket.worker.cached + (answer.cached ? 1 : 0),
      },
      costUsd: ticket.costUsd + answer.costUsd,
    };
  }
  return { ...ticket, [answer.layer]: addSample(ticket[answer.layer], answer.ms) };
}

/** Estimated cost of one Worker call: request + CPU + embedding tokens (none when cached or offline). */
export function workerCallCost(query: string, cached: boolean, modelKey: string | undefined): number {
  const tokens = (TEMPLATE_CHARS + query.length) / 4;
  const model = cached || modelKey === undefined ? 0 : tokens * (TOKEN_USD[modelKey] ?? 0.02 / 1e6);
  return REQUEST_USD + CPU_MS_PER_REQUEST * CPU_MS_USD + model;
}

/** `modelKey` undefined = the Worker answered without Workers AI (offline), so no model cost. */
export function useTicket(query: string, search: EmojiSearchState, modelKey: string | undefined): Ticket {
  const [ticket, setTicket] = useState<Ticket>(EMPTY_TICKET);
  const lastQuery = useRef(query);
  const lastSemantic = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (query === lastQuery.current) return;
    lastQuery.current = query;
    setTicket((t) => ({ ...t, keystrokes: t.keystrokes + 1 }));
    if (query.trim() === "") return;
    const timer = setTimeout(() => setTicket((t) => ({ ...t, searches: t.searches + 1 })), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const ms = search.aliasMs;
    if (ms !== undefined) setTicket((t) => recordDeviceAnswer(t, ms));
  }, [search.aliasMs]);

  const layer = search.status === "fused" ? semanticLayer(search) : undefined;
  useEffect(() => {
    const ms = search.semanticMs;
    if (layer === undefined || ms === undefined || ms === lastSemantic.current) return;
    lastSemantic.current = ms;
    const cached = search.semanticCached === true;
    setTicket((t) =>
      recordSemanticAnswer(t, {
        layer,
        ms,
        cached,
        costUsd: layer === "worker" ? workerCallCost(query, cached, modelKey) : 0,
      }),
    );
  }, [layer, search.semanticMs, search.semanticCached, query, modelKey]);

  return ticket;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "–";
  return ms < 10 ? `${ms.toFixed(2)} ms` : `${Math.round(ms)} ms`;
}
