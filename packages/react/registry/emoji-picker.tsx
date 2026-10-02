"use client";

import { type Emojisense, useEmojiSearch } from "@emojisense/react";
import { useEmojisenseResolver } from "@emojisense/react/frimousse";
import { applySkinTone, type SearchResult } from "emojisense";
import {
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
  EmojiPicker as EmojiPickerPrimitive,
  useSkinTone,
} from "frimousse";
import * as React from "react";

import { cn } from "@/lib/utils";

type SelectedEmoji = { emoji: string; label: string };

type EmojiPickerContextValue = {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  columns: number;
  listboxId: string;
  labelOf: (result: SearchResult) => string;
  onEmojiSelect: (emoji: SelectedEmoji) => void;
};

const EmojiPickerContext = React.createContext<EmojiPickerContextValue | null>(null);

function useEmojiPicker() {
  const context = React.useContext(EmojiPickerContext);
  if (!context) throw new Error("EmojiPicker parts must be rendered inside <EmojiPicker>.");
  return context;
}

function EmojiPicker({
  emojisense,
  onEmojiSelect,
  columns = 9,
  limit = 36,
  className,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof EmojiPickerPrimitive.Root>,
  "onEmojiSelect" | "locale" | "resolveEmojiData" | "columns"
> & {
  emojisense: Emojisense;
  onEmojiSelect?: (emoji: SelectedEmoji) => void;
  columns?: number;
  limit?: number;
}) {
  const [query, setQueryState] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listboxId = React.useId();
  const { results } = useEmojiSearch(query, emojisense, { limit });
  const { key, resolveEmojiData } = useEmojisenseResolver(emojisense.packs);
  const { engine, locale } = emojisense;

  const setQuery = React.useCallback((next: string) => {
    setQueryState(next);
    setActiveIndex(0);
  }, []);
  const labelOf = React.useCallback(
    (result: SearchResult) => {
      const labels = engine?.get(result.id)?.labels;
      return labels?.[locale] ?? labels?.en ?? result.emoji;
    },
    [engine, locale],
  );
  const select = React.useCallback((emoji: SelectedEmoji) => onEmojiSelect?.(emoji), [onEmojiSelect]);

  const context = React.useMemo(
    () => ({
      query,
      setQuery,
      results,
      activeIndex,
      setActiveIndex,
      columns,
      listboxId,
      labelOf,
      onEmojiSelect: select,
    }),
    [query, setQuery, results, activeIndex, columns, listboxId, labelOf, select],
  );

  return (
    <EmojiPickerPrimitive.Root
      key={key}
      data-slot="emoji-picker"
      className={cn(
        "bg-popover text-popover-foreground isolate flex h-full w-fit flex-col overflow-hidden rounded-md",
        className,
      )}
      columns={columns}
      locale={locale}
      resolveEmojiData={resolveEmojiData}
      onEmojiSelect={select}
      {...props}
    >
      <EmojiPickerContext.Provider value={context}>{children}</EmojiPickerContext.Provider>
    </EmojiPickerPrimitive.Root>
  );
}

const MOVES: Record<string, (columns: number) => number> = {
  ArrowRight: () => 1,
  ArrowLeft: () => -1,
  ArrowDown: (columns) => columns,
  ArrowUp: (columns) => -columns,
};

function EmojiPickerSearch({
  className,
  placeholder = "Search emoji…",
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Search>) {
  const {
    query,
    setQuery,
    results,
    activeIndex,
    setActiveIndex,
    columns,
    listboxId,
    labelOf,
    onEmojiSelect,
  } = useEmojiPicker();
  const [skinTone] = useSkinTone();
  const hasResults = query.trim() !== "" && results.length > 0;

  // While Emojisense results are shown, arrow keys and Enter belong to them. preventDefault keeps
  // Frimousse's document-level handler from moving or selecting in its hidden list.
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    props.onKeyDown?.(event);
    if (!hasResults || event.defaultPrevented) return;
    const move = MOVES[event.key]?.(columns);
    if (move !== undefined) {
      event.preventDefault();
      setActiveIndex(Math.min(results.length - 1, Math.max(0, activeIndex + move)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) onEmojiSelect({ emoji: applySkinTone(result.emoji, skinTone), label: labelOf(result) });
    }
  };

  return (
    <div
      data-slot="emoji-picker-search-wrapper"
      className={cn("flex h-9 items-center gap-2 border-b px-3", className)}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="size-4 shrink-0 opacity-50"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <EmojiPickerPrimitive.Search
        data-slot="emoji-picker-search"
        className="placeholder:text-muted-foreground flex h-10 w-full bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={hasResults}
        aria-controls={hasResults ? listboxId : undefined}
        aria-activedescendant={hasResults ? `${listboxId}-${activeIndex}` : undefined}
        {...props}
        value={query}
        onChange={(event) => {
          props.onChange?.(event);
          setQuery(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

function EmojiPickerRow({ children, className, ...props }: EmojiPickerListRowProps) {
  return (
    <div data-slot="emoji-picker-row" className={cn("scroll-my-1 px-1", className)} {...props}>
      {children}
    </div>
  );
}

function EmojiPickerEmoji({ emoji, className, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button
      data-slot="emoji-picker-emoji"
      className={cn(
        "data-[active]:bg-accent flex size-8 items-center justify-center rounded-sm text-lg",
        className,
      )}
      {...props}
    >
      {emoji.emoji}
    </button>
  );
}

function EmojiPickerCategoryHeader({ category, className, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      data-slot="emoji-picker-category-header"
      className={cn("bg-popover text-muted-foreground px-3 pt-3.5 pb-2 text-xs leading-none", className)}
      {...props}
    >
      {category.label}
    </div>
  );
}

function EmojiPickerResults({ empty }: { empty: React.ReactNode }) {
  const { results, activeIndex, setActiveIndex, columns, listboxId, labelOf, onEmojiSelect } =
    useEmojiPicker();
  const [skinTone] = useSkinTone();

  React.useEffect(() => {
    document.getElementById(`${listboxId}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [listboxId, activeIndex]);

  if (results.length === 0) {
    return (
      <div
        data-slot="emoji-picker-empty"
        className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm"
      >
        {empty}
      </div>
    );
  }
  return (
    <div
      role="listbox"
      id={listboxId}
      aria-label="Emoji results"
      data-slot="emoji-picker-results"
      className="grid p-1"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {results.map((result, index) => {
        const emoji = applySkinTone(result.emoji, skinTone);
        const label = labelOf(result);
        const active = index === activeIndex;
        return (
          <button
            key={result.id}
            type="button"
            role="option"
            id={`${listboxId}-${index}`}
            aria-selected={active}
            aria-label={label}
            tabIndex={-1}
            data-active={active ? "" : undefined}
            data-source={result.source}
            className="data-[active]:bg-accent flex size-8 items-center justify-center rounded-sm text-lg"
            onPointerEnter={() => setActiveIndex(index)}
            onClick={() => onEmojiSelect({ emoji, label })}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}

function EmojiPickerContent({
  className,
  empty = "No emoji found.",
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Viewport> & { empty?: React.ReactNode }) {
  const { query, results } = useEmojiPicker();
  const searching = query.trim() !== "";

  return (
    <EmojiPickerPrimitive.Viewport
      data-slot="emoji-picker-viewport"
      className={cn("relative flex-1 outline-hidden", className)}
      {...props}
    >
      <span className="sr-only" aria-live="polite">
        {searching ? `${results.length} results` : ""}
      </span>
      {searching ? (
        <EmojiPickerResults empty={empty} />
      ) : (
        <>
          <EmojiPickerPrimitive.Loading
            data-slot="emoji-picker-loading"
            className="text-muted-foreground absolute inset-0 flex items-center justify-center"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="size-4 animate-spin motion-reduce:animate-none"
            >
              <path d="M21 12a9 9 0 1 1-6.2-8.56" />
            </svg>
            <span className="sr-only">Loading…</span>
          </EmojiPickerPrimitive.Loading>
          <EmojiPickerPrimitive.List
            data-slot="emoji-picker-list"
            className="pb-1 select-none"
            components={{
              Row: EmojiPickerRow,
              Emoji: EmojiPickerEmoji,
              CategoryHeader: EmojiPickerCategoryHeader,
            }}
          />
        </>
      )}
    </EmojiPickerPrimitive.Viewport>
  );
}

function EmojiPickerFooter({ className, ...props }: React.ComponentProps<"div">) {
  const { query, results, activeIndex, labelOf } = useEmojiPicker();
  const [skinTone] = useSkinTone();
  const result = query.trim() !== "" ? results[activeIndex] : undefined;

  const preview = (emoji: SelectedEmoji | undefined) =>
    emoji ? (
      <>
        <div className="flex size-7 flex-none items-center justify-center text-lg">{emoji.emoji}</div>
        <span className="text-secondary-foreground truncate text-xs">{emoji.label}</span>
      </>
    ) : (
      <span className="text-muted-foreground ml-1.5 flex h-7 items-center truncate text-xs">
        Select an emoji…
      </span>
    );

  return (
    <div
      data-slot="emoji-picker-footer"
      className={cn(
        "flex w-full max-w-(--frimousse-viewport-width) min-w-0 items-center gap-1 border-t p-2",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {result ? (
          preview({ emoji: applySkinTone(result.emoji, skinTone), label: labelOf(result) })
        ) : (
          <EmojiPickerPrimitive.ActiveEmoji>{({ emoji }) => preview(emoji)}</EmojiPickerPrimitive.ActiveEmoji>
        )}
      </div>
      <EmojiPickerPrimitive.SkinToneSelector
        data-slot="emoji-picker-skin-tone-selector"
        className="hover:bg-accent focus-visible:ring-ring/50 flex size-7 flex-none items-center justify-center rounded-sm text-lg outline-hidden focus-visible:ring-[3px]"
      />
    </div>
  );
}

export { EmojiPicker, EmojiPickerContent, EmojiPickerFooter, EmojiPickerSearch };
