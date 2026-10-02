/**
 * Clerk values both the build (CSP) and the Worker (token issuer) derive from the publishable key.
 * A publishable key is `pk_test_` or `pk_live_` + base64("<frontend api host>$").
 */
const PUBLISHABLE_KEY = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/;
const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** The Frontend API host (e.g. `clerk.emojisense.com`), or `null` when the key is not a Clerk key. */
export function clerkFrontendApi(publishableKey: string | undefined): string | null {
  const match = PUBLISHABLE_KEY.exec(publishableKey?.trim() ?? "");
  if (!match?.[2]) return null;
  let decoded: string;
  try {
    decoded = atob(match[2].replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1).toLowerCase();
  return HOST.test(host) ? host : null;
}
