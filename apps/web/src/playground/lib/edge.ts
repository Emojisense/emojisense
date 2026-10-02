/**
 * The playground's calls to the edge API (docs/API.md). Meaning search goes through the SDK's own
 * `createSemanticClient`, with a fetch wrapper that records what really went over the network:
 * the request URL, the status and the `Server-Timing` header.
 */
import { createSemanticClient, type SearchResult, type SemanticProvider } from "emojisense";
import { API_URL, PUBLISHABLE_KEY } from "../../config";

export interface TimingEntry {
  name: string;
  ms: number;
}

/** `embed;dur=134, total;dur=141` → [{ name: "embed", ms: 134 }, { name: "total", ms: 141 }]. */
export function parseServerTiming(header: string | null | undefined): TimingEntry[] {
  if (!header) return [];
  return header.split(",").flatMap((part) => {
    const [name, ...params] = part.split(";").map((piece) => piece.trim());
    const duration = params.find((param) => param.startsWith("dur="));
    const ms = Number(duration?.slice(4));
    return name && duration && Number.isFinite(ms) ? [{ name, ms }] : [];
  });
}

export function serverTotal(entries: readonly TimingEntry[]): number | undefined {
  return entries.find((entry) => entry.name === "total")?.ms;
}

/** What one semantic search did on the network. */
export interface EdgeTrace {
  /** False: the SDK answered from its in-memory cache and sent nothing. */
  requested: boolean;
  url?: string;
  status?: number;
  serverTiming: TimingEntry[];
}

export interface TracedSemantic {
  provider: SemanticProvider;
  /** The trace of the latest search for this query and locale. */
  trace(query: string, locale: string): EdgeTrace | undefined;
}

const MAX_TRACES = 200;

/**
 * The SDK's semantic client, unchanged, plus a trace per search. The client calls `fetch`
 * synchronously inside `search()` (before its first await), which is how a request is tied to
 * the search that sent it.
 */
export function createTracedSemantic(): TracedSemantic {
  const traces = new Map<string, EdgeTrace>();
  let current: EdgeTrace | undefined;

  const tracingFetch: typeof fetch = async (input, init) => {
    const trace = current;
    if (trace) {
      trace.requested = true;
      trace.url = String(input);
    }
    const response = await fetch(input, init);
    if (trace) {
      trace.status = response.status;
      trace.serverTiming = parseServerTiming(response.headers.get("server-timing"));
    }
    return response;
  };

  const client = createSemanticClient({ endpoint: API_URL, key: PUBLISHABLE_KEY, fetch: tracingFetch });
  const keyOf = (query: string, locale = "en") => `${locale}\n${query}`;

  return {
    provider: {
      search(query, options) {
        const trace: EdgeTrace = { requested: false, serverTiming: [] };
        current = trace;
        const pending = client.search(query, options);
        current = undefined;
        const key = keyOf(query, options?.locale);
        traces.delete(key);
        traces.set(key, trace);
        if (traces.size > MAX_TRACES) traces.delete(traces.keys().next().value as string);
        return pending;
      },
    },
    trace: (query, locale) => traces.get(keyOf(query, locale)),
  };
}

export interface Health {
  packVersion: string;
  model: string;
  /** False: Workers AI is not bound, so the edge answers from the dictionary only. */
  semantic: boolean;
}

/** `GET /v1/health`. Undefined when the API cannot be reached. */
export async function fetchHealth(signal: AbortSignal): Promise<Health | undefined> {
  try {
    const response = await fetch(`${API_URL}/v1/health`, { signal });
    if (!response.ok) return undefined;
    const body = (await response.json()) as Partial<Health>;
    if (typeof body.model !== "string") return undefined;
    return {
      packVersion: String(body.packVersion ?? ""),
      model: body.model,
      semantic: body.semantic === true,
    };
  } catch {
    return undefined;
  }
}

export type EdgeOutcome =
  | {
      ok: true;
      results: SearchResult[];
      /** Round trip measured in the browser. */
      ms: number;
      serverTiming: TimingEntry[];
      degraded: boolean;
      overLimit: boolean;
    }
  | { ok: false; message: string };

const REACTIONS_TIMEOUT_MS = 8000;

const STATUS_MESSAGES: Record<number, string> = {
  400: "The API could not read this message. Type at least one word.",
  401: "The API does not know this key.",
  403: "This key is not allowed on this website.",
  413: "This message is too long to send.",
  429: "Too many requests at once. Wait a few seconds, then try again.",
};

/** `POST /v1/suggest-reactions`. Never throws: a failure becomes a message in plain words. */
export async function suggestReactions(
  input: { text: string; locale: string; limit: number },
  signal: AbortSignal,
): Promise<EdgeOutcome> {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(REACTIONS_TIMEOUT_MS)]);
  const started = performance.now();
  try {
    const response = await fetch(
      `${API_URL}/v1/suggest-reactions?key=${encodeURIComponent(PUBLISHABLE_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: timeout,
      },
    );
    if (!response.ok) {
      return {
        ok: false,
        message: STATUS_MESSAGES[response.status] ?? "The edge API is not available right now.",
      };
    }
    const body = (await response.json()) as {
      results?: SearchResult[];
      degraded?: boolean;
      overLimit?: boolean;
    };
    return {
      ok: true,
      results: Array.isArray(body.results) ? body.results : [],
      ms: performance.now() - started,
      serverTiming: parseServerTiming(response.headers.get("server-timing")),
      degraded: body.degraded === true,
      overLimit: body.overLimit === true,
    };
  } catch {
    if (signal.aborted) return { ok: false, message: "Cancelled." };
    return { ok: false, message: "The edge API did not answer. Check the connection, then try again." };
  }
}

/** The SDK client throws `… failed with HTTP <status>`; anything else is a network failure. */
export function describeEdgeError(error: unknown): string {
  const status = Number(/HTTP (\d{3})/.exec(error instanceof Error ? error.message : "")?.[1]);
  if (status === 429) return STATUS_MESSAGES[429] as string;
  if (status === 401 || status === 403) return STATUS_MESSAGES[status] as string;
  if (status >= 500) return "The edge API had a problem.";
  return "The edge API did not answer.";
}
