/**
 * API keys. Publishable keys (`pk_live_…`) live in browsers and are bound to allowed origins.
 * Secret keys (`sk_live_…`) are for servers (MCP, Slack app, tenant writes) and must never
 * reach a browser. Only a SHA-256 hash is stored.
 */
export type KeyKind = "publishable" | "secret";

const PREFIX: Record<KeyKind, string> = { publishable: "pk_live_", secret: "sk_live_" };
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function randomId(length = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function generateKey(kind: KeyKind): string {
  return `${PREFIX[kind]}${randomId(32)}`;
}

export function keyKind(key: string): KeyKind | undefined {
  if (key.startsWith(PREFIX.publishable)) return "publishable";
  if (key.startsWith(PREFIX.secret)) return "secret";
  return undefined;
}

/** Shown in the dashboard instead of the key: "pk_live_AbCd…". */
export function displayPrefix(key: string): string {
  return key.slice(0, 12);
}

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Origin check for publishable keys. An empty list allows any origin (development keys only).
 * Patterns: exact origins ("https://app.example.com") or one leading wildcard label
 * ("https://*.example.com"). This is a browser control only: servers can forge Origin.
 */
export function originAllowed(origin: string | null, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  if (!origin) return false;
  return allowed.some((pattern) => {
    if (pattern === origin) return true;
    const wildcard = /^(https?:\/\/)\*\.(.+)$/.exec(pattern);
    if (!wildcard) return false;
    const [, scheme, domain] = wildcard as unknown as [string, string, string];
    return (
      origin.startsWith(scheme) && origin.endsWith(`.${domain}`) && !origin.slice(scheme.length).includes("/")
    );
  });
}
