import type { Rect } from "./target";

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  side: "below" | "above";
}

const GAP = 6;
const MARGIN = 8;

/**
 * Where to put the picker: under the caret or field when it fits, above it when only that fits,
 * otherwise on the side with more room. Always kept inside the viewport. `prefer` keeps an
 * earlier side while it still fits, so the panel does not flip as its height changes.
 */
export function placeOverlay(
  anchor: Rect | null,
  size: Size,
  viewport: Size,
  prefer?: Placement["side"],
): Placement {
  const maxTop = Math.max(MARGIN, viewport.height - size.height - MARGIN);
  const maxLeft = Math.max(MARGIN, viewport.width - size.width - MARGIN);
  if (!anchor) {
    // No caret to follow (e.g. a canvas app): near the top centre, where a command palette sits.
    return {
      top: clamp(Math.round(viewport.height * 0.18), MARGIN, maxTop),
      left: clamp(Math.round((viewport.width - size.width) / 2), MARGIN, maxLeft),
      side: "below",
    };
  }
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.height;
  const fitsBelow = below + size.height <= viewport.height - MARGIN;
  const fitsAbove = above >= MARGIN;
  const roomBelow = viewport.height - anchor.bottom;
  const side =
    prefer === "above" && fitsAbove
      ? "above"
      : fitsBelow
        ? "below"
        : fitsAbove
          ? "above"
          : roomBelow >= anchor.top
            ? "below"
            : "above";
  return {
    top: clamp(side === "below" ? below : above, MARGIN, maxTop),
    left: clamp(anchor.left, MARGIN, maxLeft),
    side,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
