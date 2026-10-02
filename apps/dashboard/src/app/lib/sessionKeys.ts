/**
 * Full keys created in this tab, so the quick start and the live search can use a real key.
 * Memory only: never written to storage, gone on reload. The API keeps only a hash.
 */
const fullKeys = new Map<string, string>();

export function rememberKey(keyId: string, fullKey: string): void {
  fullKeys.set(keyId, fullKey);
}

export function sessionKey(keyId: string): string | undefined {
  return fullKeys.get(keyId);
}
