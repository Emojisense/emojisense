import type { EmojiSearchState } from "@emojisense/react";
import type { SearchResult } from "emojisense";

/** Alias confidence at which an on-device answer counts as sure enough to celebrate. */
export const CONFIDENT = 0.6;

/**
 * The answer worth a celebration: nothing is still on its way (no pending semantic request) and
 * the result is either fused with semantic results or a confident dictionary hit.
 */
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
  /** Offset from the start point, rem. */
  dx: number;
  dy: number;
  rotate: number;
  scale: number;
  delayMs: number;
}

/** Pieces spread evenly around a circle with a stable jitter per emoji. */
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

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
