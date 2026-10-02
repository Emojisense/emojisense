import type { EmojiSearchState } from "@emojisense/react";
import type { SearchResult } from "emojisense";
import { useEffect, useRef, useState } from "react";

/** Alias confidence at which an on-device answer counts as sure enough to celebrate. */
const CONFIDENT = 0.6;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The answer worth a celebration: nothing pending, and fused or a confident dictionary hit. */
export function settledAnswer(state: EmojiSearchState): SearchResult | undefined {
  const top = state.results[0];
  if (!top) return undefined;
  if (state.status === "fused") return top;
  const final = state.status === "alias" || state.status === "error";
  return final && (state.alias?.confidence ?? 0) >= CONFIDENT ? top : undefined;
}

/** FNV-1a: a small, stable hash, so the same emoji always gets the same tilt and burst. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Sticker tilt in degrees, −6 to 6. */
export function tiltFor(id: string): number {
  return (hash(id) % 13) - 6;
}

export interface BurstPiece {
  dx: number;
  dy: number;
  rotate: number;
  scale: number;
  delayMs: number;
}

export function burstPieces(count: number, seed: string): BurstPiece[] {
  const base = hash(seed);
  return Array.from({ length: count }, (_, i) => {
    const jitter = ((base >>> (i % 24)) & 0xff) / 255;
    const angle = (i / count) * Math.PI * 2 + jitter * 0.6;
    const distance = 3 + jitter * 2.5;
    return {
      dx: Number((Math.cos(angle) * distance).toFixed(2)),
      dy: Number((Math.sin(angle) * distance - 0.75).toFixed(2)),
      rotate: Math.round((jitter - 0.5) * 80),
      scale: Number((0.55 + jitter * 0.35).toFixed(2)),
      delayMs: Math.round(jitter * 60),
    };
  });
}

export interface Burst {
  key: number;
  emoji: string;
  pieces: BurstPiece[];
}

const SETTLE_MS = 450;
const BURST_MS = 650;

/** One burst of the answer's own emoji when a new answer settles after typing pauses. */
export function useBurst(state: EmojiSearchState): Burst | undefined {
  const [burst, setBurst] = useState<Burst | undefined>();
  const celebrated = useRef<string | undefined>(undefined);
  const settled = settledAnswer(state);
  const id = settled?.id;
  const emoji = settled?.emoji;

  useEffect(() => {
    if (!id || !emoji || id === celebrated.current) return;
    const timer = setTimeout(() => {
      celebrated.current = id;
      if (!prefersReducedMotion()) setBurst({ key: Date.now(), emoji, pieces: burstPieces(8, id) });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [id, emoji]);

  useEffect(() => {
    if (!burst) return;
    const timer = setTimeout(() => setBurst(undefined), BURST_MS);
    return () => clearTimeout(timer);
  }, [burst]);

  return burst;
}

const COUNT_MS = 240;

/** Numbers on the ticket tick up to their new value instead of jumping. */
export function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value || prefersReducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / COUNT_MS);
      const current = start + (value - start) * (1 - (1 - progress) ** 3);
      from.current = current;
      setShown(current);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return shown;
}
