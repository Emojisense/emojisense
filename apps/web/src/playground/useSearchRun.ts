import {
  type AliasEngine,
  type AliasSearchOutput,
  type CanonicalSearchOutput,
  createSearchSession,
  type SearchResult,
  type SessionState,
  shouldUseSemantic,
} from "emojisense";
import { useEffect, useMemo, useState } from "react";
import { describeEdgeError, type EdgeTrace, type TracedSemantic } from "./lib/edge";
import type { SearchSettings } from "./lib/settings";

/** Same pause as the SDK default: one edge request per pause in typing, not per key. */
export const DEBOUNCE_MS = 200;

/** What the edge did for the current query. */
export type EdgeStatus =
  | { kind: "off" }
  | { kind: "offline" }
  /** The SDK did not ask: the dictionary was sure enough. */
  | { kind: "skipped"; confidence: number }
  | { kind: "waiting" }
  | { kind: "answered"; ms: number; cached: boolean; degraded: boolean; trace: EdgeTrace | undefined }
  /** Asked, but no answer came back (for example over the monthly limit). */
  | { kind: "empty"; trace: EdgeTrace | undefined }
  | { kind: "failed"; message: string };

export interface SearchRun {
  query: string;
  results: SearchResult[];
  /** The on-device dictionary's own answer (on-device and hybrid modes). */
  alias?: CanonicalSearchOutput;
  deviceMs?: number;
  edge: EdgeStatus;
  /** No tier understood the query (the session's verdict, or the API's in meaning-only mode). */
  unsure?: boolean;
}

/** Hybrid "always ask": every query with words in it goes to the edge. */
const askAlways = (alias: AliasSearchOutput) => alias.tokens.length > 0;

interface Inputs {
  engine: AliasEngine | undefined;
  online: boolean;
  traced: TracedSemantic;
  settings: SearchSettings;
}

/** Runs the current settings through the real engine and API, in the way the chosen mode does. */
export function useSearchRun({ engine, online, traced, settings }: Inputs): SearchRun | undefined {
  const { query, locale, mode, limit, alwaysEdge } = settings;
  const [run, setRun] = useState<SearchRun | undefined>();

  // Hybrid: the SDK's own search session, as an app would use it.
  const session = useMemo(() => {
    if (!engine || mode !== "hybrid") return undefined;
    const fromSession = (state: SessionState): SearchRun => {
      const base = {
        query: state.query,
        results: state.results,
        alias: state.alias,
        deviceMs: state.aliasMs,
        unsure: state.unsure,
      };
      switch (state.status) {
        case "idle":
          return { ...base, edge: { kind: "off" } };
        case "loading":
          return { ...base, edge: { kind: "waiting" } };
        case "fused":
          return {
            ...base,
            edge: {
              kind: "answered",
              ms: state.semanticMs ?? 0,
              cached: state.semanticCached === true,
              degraded: false,
              trace: traced.trace(state.query, locale),
            },
          };
        case "error":
          return { ...base, edge: { kind: "failed", message: describeEdgeError(state.error) } };
        default: {
          if (!online) return { ...base, edge: { kind: "offline" } };
          const asked = alwaysEdge ? askAlways(state.alias) : shouldUseSemantic(state.alias);
          return asked
            ? { ...base, edge: { kind: "empty", trace: traced.trace(state.query, locale) } }
            : { ...base, edge: { kind: "skipped", confidence: state.alias.confidence } };
        }
      }
    };
    return createSearchSession({
      engine,
      ...(online ? { semantic: traced.provider } : {}),
      locale,
      locales: [locale],
      limit,
      debounceMs: DEBOUNCE_MS,
      ...(alwaysEdge ? { shouldUseSemantic: askAlways } : {}),
      onChange: (state) => setRun(fromSession(state)),
    });
  }, [engine, mode, online, locale, limit, alwaysEdge, traced]);

  useEffect(() => () => session?.dispose(), [session]);
  useEffect(() => session?.update(query), [session, query]);

  // On device: one synchronous call, timed. No network at all.
  useEffect(() => {
    if (!engine || mode !== "alias") return;
    const started = performance.now();
    const alias = engine.search(query, { limit, locale, locales: [locale], culture: false });
    const deviceMs = performance.now() - started;
    setRun({ query, results: alias.results, alias, deviceMs, edge: { kind: "off" } });
  }, [engine, mode, query, limit, locale]);

  // Meaning only: the SDK's semantic client alone, after a pause in typing.
  useEffect(() => {
    if (mode !== "semantic") return;
    if (!query.trim()) {
      setRun({ query, results: [], edge: { kind: "off" } });
      return;
    }
    if (!online) {
      setRun({ query, results: [], edge: { kind: "offline" } });
      return;
    }
    setRun((previous) => ({ query, results: previous?.results ?? [], edge: { kind: "waiting" } }));
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const started = performance.now();
      try {
        const response = await traced.provider.search(query, { locale, limit, signal: controller.signal });
        if (controller.signal.aborted) return;
        const trace = traced.trace(query, locale);
        setRun(
          response
            ? {
                query,
                results: response.results,
                ...(response.unsure !== undefined ? { unsure: response.unsure } : {}),
                edge: {
                  kind: "answered",
                  ms: performance.now() - started,
                  cached: response.cached,
                  degraded: response.degraded === true,
                  trace,
                },
              }
            : { query, results: [], edge: { kind: "empty", trace } },
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setRun({ query, results: [], edge: { kind: "failed", message: describeEdgeError(error) } });
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mode, query, locale, limit, online, traced]);

  return run;
}
