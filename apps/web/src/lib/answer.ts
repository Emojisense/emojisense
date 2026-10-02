import type { EmojiSearchState } from "@emojisense/react";

/**
 * Which layer gave the semantic part of an answer. `useEmojiSearch` gains a `layer` field in a
 * later SDK release, so it is read defensively; a fused answer without it came from the API,
 * the only semantic provider older hooks create.
 */
export type AnswerLayer = "device" | "shard" | "api";

export function semanticLayerOf(state: EmojiSearchState): AnswerLayer | undefined {
  if (state.status !== "fused") return undefined;
  const layer = (state as { layer?: string }).layer;
  return layer === "device" || layer === "shard" ? layer : "api";
}

export function formatMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(2)} ms` : `${Math.round(ms)} ms`;
}

/** One line under the live search that says where the answer came from and what it cost. */
export function describeAnswer(state: EmojiSearchState): string {
  const device = state.aliasMs === undefined ? undefined : formatMs(state.aliasMs);
  const semantic = state.semanticMs === undefined ? undefined : formatMs(state.semanticMs);
  switch (state.status) {
    case "idle":
      return "Type a film, a feeling, a typo or a phrase.";
    case "alias":
      return state.results.length === 0
        ? `No match on this device (${device}).`
        : `Answered on this device in ${device}. Cost: $0.`;
    case "loading":
      return `Answered on this device in ${device}. Asking the edge about the meaning…`;
    case "fused": {
      const layer = semanticLayerOf(state);
      if (layer === "shard") return `On this device, plus precomputed results in ${semantic}. Cost: $0.`;
      if (layer === "device") return `On this device, plus the on-device model in ${semantic}. Cost: $0.`;
      return `On this device, plus the Worker in ${semantic}${state.semanticCached ? " (cached)" : ""}.`;
    }
    case "error":
      return `Answered on this device in ${device}. The Worker did not answer, so these are dictionary results.`;
  }
}
