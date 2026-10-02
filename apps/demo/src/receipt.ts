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

export interface Receipt {
  keystrokes: number;
  searches: number;
  onDeviceMs: number[];
  edgeRequests: number;
  cacheHits: number;
  edgeMs: number[];
  costUsd: number;
}

const EMPTY: Receipt = {
  keystrokes: 0,
  searches: 0,
  onDeviceMs: [],
  edgeRequests: 0,
  cacheHits: 0,
  edgeMs: [],
  costUsd: 0,
};

/** `modelKey` undefined = the edge answered without Workers AI (offline), so no model cost. */
export function useReceipt(query: string, search: EmojiSearchState, modelKey: string | undefined): Receipt {
  const [receipt, setReceipt] = useState<Receipt>(EMPTY);
  const lastQuery = useRef(query);
  const lastEdge = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (query === lastQuery.current) return;
    lastQuery.current = query;
    setReceipt((r) => ({ ...r, keystrokes: r.keystrokes + 1 }));
    if (query.trim() === "") return;
    const timer = setTimeout(() => setReceipt((r) => ({ ...r, searches: r.searches + 1 })), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const ms = search.aliasMs;
    if (ms === undefined) return;
    setReceipt((r) => ({ ...r, onDeviceMs: [...r.onDeviceMs.slice(-199), ms] }));
  }, [search.aliasMs]);

  useEffect(() => {
    const ms = search.semanticMs;
    if (search.status !== "fused" || ms === undefined || ms === lastEdge.current) return;
    lastEdge.current = ms;
    const cached = search.semanticCached === true;
    const tokens = (TEMPLATE_CHARS + query.length) / 4;
    const cost =
      REQUEST_USD +
      CPU_MS_PER_REQUEST * CPU_MS_USD +
      (cached || modelKey === undefined ? 0 : tokens * (TOKEN_USD[modelKey] ?? 0.02 / 1e6));
    setReceipt((r) => ({
      ...r,
      edgeRequests: r.edgeRequests + 1,
      cacheHits: r.cacheHits + (cached ? 1 : 0),
      edgeMs: [...r.edgeMs.slice(-199), ms],
      costUsd: r.costUsd + cost,
    }));
  }, [search.status, search.semanticMs, search.semanticCached, query, modelKey]);

  return receipt;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
