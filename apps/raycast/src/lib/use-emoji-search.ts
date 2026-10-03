import {
  type AliasEngine,
  createSearchSession,
  type SearchSession,
  type SemanticProvider,
  type SessionState,
} from "emojisense";
import { useCallback, useEffect, useRef, useState } from "react";

export interface LoadedEngine {
  engine: AliasEngine;
  /** Preferred locale: labels and ranking. */
  locale: string;
}

export interface EmojiSearchOptions {
  /** Builds (or returns the cached) engine for the user's languages. Called once, after the first render. */
  loadEngine: () => LoadedEngine;
  /** Optional semantic layer. Keep the object stable between renders (useMemo). */
  semantic?: SemanticProvider | undefined;
  limit?: number;
}

export interface EmojiSearch {
  loaded?: LoadedEngine;
  state?: SessionState;
  error?: unknown;
  isLoading: boolean;
  search: (query: string) => void;
}

/**
 * Alias results on every keystroke, semantic results (when configured) fused in after a short
 * debounce. The core search session handles debouncing, cancellation and stale responses.
 */
export function useEmojiSearch({ loadEngine, semantic, limit = 50 }: EmojiSearchOptions): EmojiSearch {
  const [loaded, setLoaded] = useState<LoadedEngine>();
  const [error, setError] = useState<unknown>();
  const [state, setState] = useState<SessionState>();
  const session = useRef<SearchSession | undefined>(undefined);
  const query = useRef("");

  useEffect(() => {
    // Building the index blocks for a moment; let Raycast draw the search bar first.
    const timer = setTimeout(() => {
      try {
        setLoaded(loadEngine());
      } catch (cause) {
        setError(cause);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [loadEngine]);

  useEffect(() => {
    if (!loaded) return;
    const { engine, locale } = loaded;
    const current = createSearchSession({ engine, semantic, locale, limit, onChange: setState });
    session.current = current;
    // Replay what the user typed while the engine was loading.
    current.update(query.current);
    return () => current.dispose();
  }, [loaded, semantic, limit]);

  const search = useCallback((text: string) => {
    query.current = text;
    session.current?.update(text);
  }, []);

  return {
    ...(loaded ? { loaded } : {}),
    ...(state ? { state } : {}),
    ...(error ? { error } : {}),
    isLoading: (!loaded && !error) || state?.status === "loading",
    search,
  };
}
