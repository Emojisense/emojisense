import { type AliasEngine, createSearchSession, type SearchResult, type SessionState } from "emojisense";
import { useEffect, useMemo, useState } from "react";
import { pageLocale, sharedSemantic, visitorLocales } from "../../lib/engine-client";

export interface QuerySearch {
  results: SearchResult[];
  /** The session for the current query; undefined while the query is empty. */
  session: SessionState | undefined;
}

/** Search for a whole field's text (a picker, a launcher, a tool call), dictionary then meaning. */
export function useQuerySearch(engine: AliasEngine | undefined, query: string, limit = 6): QuerySearch {
  const [session, setSession] = useState<SessionState>();
  const search = useMemo(() => {
    if (!engine) return undefined;
    const semantic = sharedSemantic();
    return createSearchSession({
      engine,
      ...(semantic ? { semantic } : {}),
      locale: pageLocale(),
      locales: visitorLocales(),
      limit,
      debounceMs: 180,
      onChange: setSession,
    });
  }, [engine, limit]);
  useEffect(() => () => search?.dispose(), [search]);

  const trimmed = query.trim();
  useEffect(() => {
    search?.update(trimmed);
  }, [search, trimmed]);

  const current = trimmed && session?.query ? session : undefined;
  return { results: current?.results ?? [], session: current };
}
