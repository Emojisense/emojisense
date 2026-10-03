import { createLayeredSemantic, createSemanticClient, type SemanticProvider } from "emojisense";

export interface ApiSettings {
  apiUrl?: string | undefined;
  apiKey?: string | undefined;
  /** Sent as `pack=` so the API can tell which data the client has. */
  packVersion?: string | undefined;
}

export interface ApiSetup {
  /** Undefined = offline: alias results only. */
  provider?: SemanticProvider;
  /** Why the configured API is not used. Shown once to the user. */
  warning?: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The Emojisense API as a semantic provider, from the extension preferences. The core client adds
 * caching and the over-limit pause; this wrapper adds the key and a timeout. A publishable key
 * (`pk_…`) goes in the query string like in a browser. Any other key is treated as secret and
 * goes in the Authorization header, never in a URL.
 */
export function createApiProvider(
  settings: ApiSettings,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): ApiSetup {
  const { timeoutMs = 4000 } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const apiUrl = settings.apiUrl?.trim();
  const apiKey = settings.apiKey?.trim();
  if (!apiUrl) return apiKey ? { warning: "An API key is set but the API URL is empty." } : {};

  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return { warning: `"${apiUrl}" is not a valid URL.` };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    return { warning: "The API URL must use https (http is allowed for localhost only)." };
  }

  const publishable = apiKey?.startsWith("pk_") ?? false;
  const bearer = apiKey && !publishable ? `Bearer ${apiKey}` : undefined;
  const timedFetch: typeof fetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    if (bearer) headers.set("Authorization", bearer);
    const signals = init.signal
      ? [init.signal, AbortSignal.timeout(timeoutMs)]
      : [AbortSignal.timeout(timeoutMs)];
    return doFetch(input, { ...init, headers, signal: AbortSignal.any(signals) });
  };

  const endpoint = (url.origin + url.pathname).replace(/\/+$/, "");
  const api = {
    endpoint,
    fetch: timedFetch,
    ...(publishable && apiKey ? { key: apiKey } : {}),
    ...(settings.packVersion ? { packVersion: settings.packVersion } : {}),
  };
  // With a pack version, the API host's shards (/p/<packVersion>) are asked first: free files.
  const provider = settings.packVersion
    ? createLayeredSemantic({ ...api, shardsUrl: `${endpoint}/p/${settings.packVersion}` })
    : createSemanticClient(api);
  return provider ? { provider } : {};
}
