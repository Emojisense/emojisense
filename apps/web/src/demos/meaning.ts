/**
 * The moment the demos are about: the on-device list for a query, then meaning search reordering it.
 * Shared by the chat popup, the docs menu and the workspace picker.
 */
import type { SessionState } from "emojisense";
import { useState } from "react";
import "./meaning.css";

/** Which tier the list on screen comes from. */
export type MeaningStage = "device" | "pending" | "meaning";

export function meaningStage(status: SessionState["status"] | undefined): MeaningStage | undefined {
  switch (status) {
    case "loading":
      return "pending";
    case "fused":
      return "meaning";
    case "alias":
    case "error":
      return "device";
    default:
      return undefined;
  }
}

const NONE: ReadonlySet<string> = new Set();

/** Rows of the new list that the old list of the same query did not have, or had lower. */
export function promotedIds(before: readonly string[], after: readonly string[]): ReadonlySet<string> {
  const promoted = new Set<string>();
  after.forEach((id, index) => {
    const was = before.indexOf(id);
    if (was === -1 || index < was) promoted.add(id);
  });
  return promoted.size > 0 ? promoted : NONE;
}

/**
 * The rows that the latest answer for `query` moved up: what meaning search changed. A new query
 * starts over, so the rows do not flash on every keystroke.
 */
export function usePromoted(query: string, ids: readonly string[]): ReadonlySet<string> {
  const key = ids.join(" ");
  const [seen, setSeen] = useState({ query, key, ids, promoted: NONE });
  if (seen.query !== query || seen.key !== key) {
    const promoted = seen.query === query ? promotedIds(seen.ids, ids) : NONE;
    setSeen({ query, key, ids, promoted });
    return promoted;
  }
  return seen.promoted;
}
