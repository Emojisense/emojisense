import {
  type AliasEngine,
  createSearchSession,
  type SearchSession,
  type SemanticProvider,
  type SessionState,
} from "emojisense";
import { useCallback, useEffect, useRef, useState } from "react";

export interface EmojiSearchOptions {
  /** Builds (or returns the cached) engine. Called once, after the first render. */
  loadEngine: () => AliasEngine;
  /** Optional semantic layer. Keep the object stable between renders (useMemo). */
  semantic?: SemanticProvider | undefined;
  locale: string;
  limit?: number;
}

export interface EmojiSearch {
  engine?: AliasEngine;
  state?: SessionState;
  error?: unknown;
  isLoading: boolean;
  search: (query: string) => void;
}

/**
 * Alias results on every keystroke, semantic results (when configured) fused in after a short
 * debounce. The core search session handles debouncing, cancellation and stale responses.
 */
export function useEmojiSearch({
  loadEngine,
  semantic,
  locale,
  limit = 50,
}: EmojiSearchOptions): EmojiSearch {
  const [engine, setEngine] = useState<AliasEngine>();
  const [error, setError] = useState<unknown>();
  const [state, setState] = useState<SessionState>();
  const session = useRef<SearchSession | undefined>(undefined);
  const query = useRef("");

  useEffect(() => {
    // Building the index blocks for a moment; let Raycast draw the search bar first.
    const timer = setTimeout(() => {
      try {
        setEngine(loadEngine());
      } catch (cause) {
        setError(cause);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [loadEngine]);

  useEffect(() => {
    if (!engine) return;
    const current = createSearchSession({ engine, semantic, locale, limit, onChange: setState });
    session.current = current;
    // Replay what the user typed while the engine was loading.
    current.update(query.current);
    return () => current.dispose();
  }, [engine, semantic, locale, limit]);

  const search = useCallback((text: string) => {
    query.current = text;
    session.current?.update(text);
  }, []);

  return {
    ...(engine ? { engine } : {}),
    ...(state ? { state } : {}),
    ...(error ? { error } : {}),
    isLoading: (!engine && !error) || state?.status === "loading",
    search,
  };
}
