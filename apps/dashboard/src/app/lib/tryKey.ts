/**
 * A publishable key pasted into the Overview's live search. It stays in this tab's
 * sessionStorage and goes only to the search API, never to the dashboard's own server.
 */
const storageKey = (appId: string) => `emojisense:try-key:${appId}`;

export function readTryKey(appId: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(appId));
  } catch {
    return null;
  }
}

export function saveTryKey(appId: string, key: string): void {
  try {
    sessionStorage.setItem(storageKey(appId), key);
  } catch {
    // Storage blocked: the key works until the page reloads.
  }
}

export function forgetTryKey(appId: string): void {
  try {
    sessionStorage.removeItem(storageKey(appId));
  } catch {
    // Nothing stored.
  }
}

/** Only publishable keys belong in a browser. */
export function tryKeyProblem(key: string): string | null {
  if (key.startsWith("sk_")) {
    return "That is a secret key. Secret keys never go in a browser: paste a publishable key (pk_live_…).";
  }
  if (!/^pk_[a-z]+_[A-Za-z0-9]{8,}$/.test(key)) return "Paste a whole publishable key, like pk_live_…";
  return null;
}
