/** chrome.storage.local key for recently picked emoji ids (newest first). Never leaves the device. */
export const RECENTS_KEY = "recent";
export const MAX_RECENTS = 24;
/** Shown when the query is empty, until the user has picked enough emoji of their own. */
export const SHOWN_RECENTS = 16;

/** Common picks, as base hexcodes: 👍 ❤️ 😂 🎉 🙏 🔥 ✅ 👀 🚀 😊 🤔 💯 🙌 😍 😅 👏 */
export const DEFAULT_RECENTS: readonly string[] = [
  "1F44D",
  "2764",
  "1F602",
  "1F389",
  "1F64F",
  "1F525",
  "2705",
  "1F440",
  "1F680",
  "1F60A",
  "1F914",
  "1F4AF",
  "1F64C",
  "1F60D",
  "1F605",
  "1F44F",
];

const ID = /^[0-9A-F]{2,8}(?:-[0-9A-F]{2,8})*$/;

export function parseRecents(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && ID.test(id)).slice(0, MAX_RECENTS)
    : [];
}

export function pushRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((existing) => existing !== id)].slice(0, MAX_RECENTS);
}

/** The user's own picks first, topped up with defaults so the empty state is never empty. */
export function recentsToShow(recent: readonly string[]): string[] {
  const own = new Set(recent);
  const fill = DEFAULT_RECENTS.filter((id) => !own.has(id));
  return [...recent, ...fill].slice(0, Math.max(SHOWN_RECENTS, recent.length));
}
