import { type AliasEngine, createSearchSession, type SearchResult, type SessionState } from "emojisense";
import { useEffect, useMemo, useRef, useState } from "react";
import { sharedSemantic } from "../../lib/engine-client";
import { findTrigger, type Trigger } from "./shortcodes";

const LIMIT = 7;

export interface EmojiAutocomplete {
  value: string;
  /** The open ":" query, or undefined when the popup is closed. */
  trigger: Trigger | undefined;
  results: SearchResult[];
  session: SessionState | undefined;
  active: number;
  setActive: (index: number) => void;
  /** Text and caret changed (typing, autoplay). */
  edit: (value: string, caret: number) => void;
  /** Replace the ":" query with the emoji. */
  pick: (emoji: string) => void;
  /** Esc: close until a new ":" starts. */
  dismiss: () => void;
  clear: () => void;
  /** Caret the textarea should move to after the next render. */
  pendingCaret: React.RefObject<number | null>;
}

/** Composer text plus the ":" emoji popup, searched by the shared engine (alias + meaning). */
export function useEmojiAutocomplete(engine: AliasEngine | undefined): EmojiAutocomplete {
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | undefined>();
  const [session, setSession] = useState<SessionState | undefined>();
  const [active, setActive] = useState(0);
  const pendingCaret = useRef<number | null>(null);

  const found = useMemo(() => findTrigger(value, caret), [value, caret]);
  const trigger = found && found.start !== dismissedAt ? found : undefined;
  const query = trigger?.query ?? "";

  const search = useMemo(() => {
    if (!engine) return undefined;
    const semantic = sharedSemantic();
    return createSearchSession({
      engine,
      ...(semantic ? { semantic } : {}),
      limit: LIMIT,
      debounceMs: 180,
      onChange: setSession,
    });
  }, [engine]);
  useEffect(() => () => search?.dispose(), [search]);

  useEffect(() => {
    search?.update(query);
    setActive(0);
  }, [search, query]);

  useEffect(() => {
    if (!found) setDismissedAt(undefined);
  }, [found]);

  const results = query && session?.query ? session.results : [];

  const edit = (next: string, nextCaret: number) => {
    setValue(next);
    setCaret(nextCaret);
  };

  const moveCaret = (next: string, nextCaret: number) => {
    edit(next, nextCaret);
    pendingCaret.current = nextCaret;
  };

  return {
    value,
    trigger,
    results,
    session: query ? session : undefined,
    active: Math.min(active, Math.max(0, results.length - 1)),
    setActive,
    edit,
    pick(emoji) {
      if (!trigger) return;
      const head = value.slice(0, trigger.start);
      const tail = value.slice(trigger.end);
      const spacer = /^\s/.test(tail) ? "" : " ";
      moveCaret(`${head}${emoji}${spacer}${tail}`, head.length + emoji.length + spacer.length);
    },
    dismiss() {
      if (trigger) setDismissedAt(trigger.start);
    },
    clear() {
      moveCaret("", 0);
    },
    pendingCaret,
  };
}
