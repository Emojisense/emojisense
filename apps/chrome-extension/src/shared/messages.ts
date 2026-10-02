import type { ResultSource } from "emojisense";

/** Port name for search traffic between the picker (content script) and the service worker. */
export const SEARCH_PORT = "emojisense/search";

/** Sent by the service worker to the chosen frame to open or close the picker. */
export const TOGGLE_MESSAGE = "emojisense/toggle";

/** One cell in the picker, ready to display and insert (skin tone already applied). */
export interface PickerItem {
  emoji: string;
  /** Emojibase hexcode of the base emoji, e.g. "1F680". */
  id: string;
  label: string;
  source: ResultSource;
}

/**
 * - `recent`: the query is empty, the items are recently used emoji.
 * - `alias`: on-device results, final.
 * - `loading`: on-device results; semantic results are on the way.
 * - `fused`: on-device and semantic results merged.
 * - `error`: the semantic request failed; the items are the on-device results.
 */
export type ResultStatus = "recent" | "alias" | "loading" | "fused" | "error";

export type ClientMessage = { type: "query"; query: string } | { type: "picked"; id: string };

export type ServerMessage =
  | { type: "results"; query: string; status: ResultStatus; items: PickerItem[] }
  | { type: "unavailable"; reason: string };

const MAX_QUERY_CHARS = 256;
const RESULT_STATUSES: readonly ResultStatus[] = ["recent", "alias", "loading", "fused", "error"];

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value)) return false;
  if (value.type === "query") return typeof value.query === "string" && value.query.length <= MAX_QUERY_CHARS;
  if (value.type === "picked") return typeof value.id === "string" && /^[0-9A-F-]{2,64}$/.test(value.id);
  return false;
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value)) return false;
  if (value.type === "unavailable") return typeof value.reason === "string";
  return (
    value.type === "results" &&
    typeof value.query === "string" &&
    RESULT_STATUSES.includes(value.status as ResultStatus) &&
    Array.isArray(value.items)
  );
}

export function isToggleMessage(value: unknown): boolean {
  return isRecord(value) && value.type === TOGGLE_MESSAGE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
