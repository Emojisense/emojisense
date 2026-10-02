/**
 * Frimousse adapter. Frimousse ≥ 0.4 has no search override (its filter is a substring match
 * that regroups results by category), so the adapter is a hybrid:
 *   - empty query  → Frimousse's own list, fed with Emojisense data via `resolveEmojiData`
 *   - typed query  → Emojisense's ranked results, same `onEmojiSelect` contract and skin tone
 * See DECISIONS.md (2026-10-02, Frimousse adapter).
 */
import {
  applySkinTone,
  type CultureResult,
  type EmojiSet,
  groupLabel,
  type Pack,
  ROW_INDEX,
  type SearchResult,
  SKIN_TONES,
  type SkinTone,
} from "emojisense";
import {
  EmojiPicker,
  type EmojiPickerListEmojiProps,
  type EmojiPickerRootProps,
  useSkinTone,
} from "frimousse";
import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import { EmojiGlyph } from "./glyph.js";
import { type Emojisense, useEmojiSearch, useRelevantNow } from "./hooks.js";

type EmojiDataResolver = NonNullable<EmojiPickerRootProps["resolveEmojiData"]>;
type EmojiData = Awaited<ReturnType<EmojiDataResolver>>;

const TONES = SKIN_TONES.filter((t): t is Exclude<SkinTone, "none"> => t !== "none");

/**
 * What `onEmojiSelect` gets: Frimousse's `{ emoji, label }`. A custom emoji has `emoji`
 * `:shortcode:` and adds `imageUrl` and `shortcode`.
 */
export interface EmojiSelection {
  emoji: string;
  label: string;
  imageUrl?: string;
  shortcode?: string;
}

function selectionOf(result: SearchResult, skinTone: SkinTone, label: string): EmojiSelection {
  return {
    emoji: applySkinTone(result.emoji, skinTone),
    label,
    ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
    ...(result.shortcode ? { shortcode: result.shortcode } : {}),
  };
}

/**
 * A Frimousse `resolveEmojiData` built from Emojisense packs: localized labels (Turkish
 * included) and keywords for the browse view and Frimousse's own fallback filter.
 */
export function createEmojisenseResolver(packs: Pack[]): EmojiDataResolver {
  return (locale) => {
    const pack = packs.find((p) => p.locale === locale) ?? packs[0];
    if (!pack) throw new Error("emojisense: no packs loaded");
    const data: EmojiData = {
      locale,
      categories: pack.groups.map((group, index) => ({ index, label: groupLabel(group, pack.locale) })),
      skinTones: Object.fromEntries(TONES.map((t) => [t, applySkinTone("✋", t)])) as EmojiData["skinTones"],
      emojis: pack.emoji.map((row) => {
        const emoji = row[ROW_INDEX.emoji];
        const hasSkins = row[ROW_INDEX.skins] === 1;
        return {
          emoji,
          category: row[ROW_INDEX.group],
          label: row[ROW_INDEX.label],
          version: row[ROW_INDEX.version],
          tags: row[ROW_INDEX.keyword].split("|").filter(Boolean),
          ...(hasSkins
            ? {
                skins: Object.fromEntries(
                  TONES.map((t) => [t, applySkinTone(emoji, t)]),
                ) as EmojiData["skinTones"],
              }
            : {}),
        };
      }),
    };
    return data;
  };
}

const PENDING: EmojiDataResolver = () => new Promise<never>(() => {});

/**
 * Frimousse props for Emojisense packs that are still loading. Frimousse resolves its data once
 * per mount and ignores a new resolver, so the returned `key` remounts the picker when the packs
 * arrive. Until then Frimousse shows its loading state.
 */
export function useEmojisenseResolver(packs: Pack[]): { key: string; resolveEmojiData: EmojiDataResolver } {
  const ready = packs.length > 0;
  const resolveEmojiData = useMemo(() => (ready ? createEmojisenseResolver(packs) : PENDING), [ready, packs]);
  return { key: ready ? "ready" : "loading", resolveEmojiData };
}

export interface EmojisenseResultsProps
  extends Omit<ComponentProps<"div">, "children" | "onSelect" | "results"> {
  results: SearchResult[];
  onSelect: (emoji: EmojiSelection) => void;
  /** Label lookup for accessible names. */
  labelOf?: (result: SearchResult) => string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  listboxId: string;
  columns?: number;
  empty?: ReactNode;
  /** Draw the emoji as images of a hosted set (needs `endpoint`). Default "native". */
  emojiSet?: EmojiSet | undefined;
  endpoint?: string | undefined;
  /** Publishable key: hosted sets need one whose plan includes them. */
  publishableKey?: string | undefined;
}

/** Ranked results as an ARIA listbox. Must be rendered inside `EmojiPicker.Root` (skin tone). */
export function EmojisenseResults(props: EmojisenseResultsProps) {
  const {
    results,
    onSelect,
    labelOf = (r) => r.emoji,
    activeIndex,
    onActiveIndexChange,
    listboxId,
    columns = 9,
    empty = null,
    emojiSet,
    endpoint,
    publishableKey,
    style,
    ...rest
  } = props;
  const [skinTone] = useSkinTone();
  if (results.length === 0) return <>{empty}</>;
  return (
    <div
      role="listbox"
      id={listboxId}
      aria-label="Emoji results"
      data-emojisense-results=""
      style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, ...style }}
      {...rest}
    >
      {results.map((result, index) => {
        const selection = selectionOf(result, skinTone, labelOf(result));
        const context = result.source === "culture" ? (result as CultureResult).context : undefined;
        return (
          <button
            key={result.id}
            type="button"
            role="option"
            id={`${listboxId}-${index}`}
            aria-selected={index === activeIndex}
            aria-label={selection.label}
            aria-description={context}
            title={context ? `${selection.label} · ${context}` : undefined}
            tabIndex={-1}
            data-active={index === activeIndex ? "" : undefined}
            data-source={result.source}
            onMouseEnter={() => onActiveIndexChange(index)}
            onClick={() => onSelect(selection)}
          >
            <EmojiGlyph
              emoji={selection.emoji}
              imageUrl={selection.imageUrl}
              emojiSet={emojiSet}
              endpoint={endpoint}
              publishableKey={publishableKey}
            />
          </button>
        );
      })}
    </div>
  );
}

const GlyphContext = createContext<{
  emojiSet?: EmojiSet | undefined;
  endpoint?: string | undefined;
  publishableKey?: string | undefined;
}>({});

/** Frimousse's default list button, drawing the emoji with the picker's emoji set. */
function ListEmoji({ emoji, ...props }: EmojiPickerListEmojiProps) {
  const glyph = useContext(GlyphContext);
  return (
    <button type="button" {...props}>
      <EmojiGlyph emoji={emoji.emoji} {...glyph} />
    </button>
  );
}

const LIST_COMPONENTS = { Emoji: ListEmoji };

export interface EmojisensePickerProps
  extends Omit<EmojiPickerRootProps, "onEmojiSelect" | "resolveEmojiData" | "locale"> {
  emojisense: Emojisense;
  onEmojiSelect: (emoji: EmojiSelection) => void;
  placeholder?: string;
  /** Rendered when a query has no results. */
  empty?: ReactNode;
  limit?: number;
  /**
   * Show a "relevant now" row (seasonal and event emoji of the culture file) above the browse
   * list. Needs `cultureUrl` in `useEmojisense`. Off by default.
   */
  showRelevantNow?: boolean;
  /** Heading of that row. Default "Relevant now". */
  relevantNowLabel?: string;
}

interface RelevantNowShelfProps {
  emojisense: Emojisense;
  label: string;
  limit: number;
  onSelect: (emoji: { emoji: string; label: string }) => void;
}

/** One row of featured emoji for this moment; each names its reason. */
function RelevantNowShelf({ emojisense, label, limit, onSelect }: RelevantNowShelfProps) {
  const shelf = useRelevantNow(emojisense, { limit });
  const [skinTone] = useSkinTone();
  if (shelf.length === 0) return null;
  return (
    <fieldset data-emojisense-relevant-now="" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend data-emojisense-relevant-now-label="">{label}</legend>
      {shelf.map((item) => {
        const emoji = applySkinTone(item.emoji, skinTone);
        const name = emojisense.engine?.get(item.hexcode)?.labels[emojisense.locale] ?? emoji;
        return (
          <button
            key={item.hexcode}
            type="button"
            aria-label={name}
            aria-description={item.context}
            title={`${name} · ${item.context}`}
            data-culture-id={item.cultureId}
            onClick={() => onSelect({ emoji, label: name })}
          >
            <EmojiGlyph
              emoji={emoji}
              emojiSet={emojisense.emojiSet}
              endpoint={emojisense.endpoint}
              publishableKey={emojisense.publishableKey}
            />
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * Drop-in Frimousse picker with Emojisense search. Style it like any Frimousse picker; the
 * results grid adds `[data-emojisense-results]` and `[data-active]` hooks.
 */
export function EmojisensePicker(props: EmojisensePickerProps) {
  const {
    emojisense,
    onEmojiSelect,
    placeholder = "Search emoji…",
    empty,
    limit = 24,
    columns = 9,
    showRelevantNow = false,
    relevantNowLabel = "Relevant now",
    ...rest
  } = props;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const { results } = useEmojiSearch(query, emojisense, { limit });
  const { key, resolveEmojiData } = useEmojisenseResolver(emojisense.packs);
  const searching = query.trim() !== "";
  const { emojiSet, endpoint, publishableKey } = emojisense;
  const glyph = useMemo(() => ({ emojiSet, endpoint, publishableKey }), [emojiSet, endpoint, publishableKey]);

  const labelOf = useCallback(
    (r: SearchResult) => {
      const labels = emojisense.engine?.get(r.id)?.labels;
      return labels?.[emojisense.locale] ?? labels?.en ?? r.emoji;
    },
    [emojisense.engine, emojisense.locale],
  );

  return (
    <EmojiPicker.Root
      key={key}
      {...rest}
      columns={columns}
      locale={emojisense.locale}
      resolveEmojiData={resolveEmojiData}
      onEmojiSelect={onEmojiSelect}
    >
      <SearchInput
        query={query}
        onQueryChange={(next) => {
          setQuery(next);
          setActiveIndex(0);
        }}
        placeholder={placeholder}
        searching={searching}
        results={results}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        columns={columns}
        listboxId={listboxId}
        onSelect={onEmojiSelect}
        labelOf={labelOf}
      />
      <EmojiPicker.Viewport>
        {searching ? (
          <EmojisenseResults
            results={results}
            onSelect={onEmojiSelect}
            labelOf={labelOf}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
            listboxId={listboxId}
            columns={columns}
            empty={empty}
            emojiSet={emojiSet}
            endpoint={endpoint}
            publishableKey={publishableKey}
          />
        ) : (
          <GlyphContext.Provider value={glyph}>
            {showRelevantNow && (
              <RelevantNowShelf
                emojisense={emojisense}
                label={relevantNowLabel}
                limit={columns}
                onSelect={onEmojiSelect}
              />
            )}
            <EmojiPicker.Loading>Loading…</EmojiPicker.Loading>
            <EmojiPicker.List components={LIST_COMPONENTS} />
          </GlyphContext.Provider>
        )}
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  );
}

interface SearchInputProps {
  query: string;
  onQueryChange: (q: string) => void;
  placeholder: string;
  searching: boolean;
  results: SearchResult[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  columns: number;
  listboxId: string;
  onSelect: (emoji: EmojiSelection) => void;
  labelOf: (r: SearchResult) => string;
}

function SearchInput(props: SearchInputProps) {
  const { query, onQueryChange, placeholder, searching, results, activeIndex, setActiveIndex, columns } =
    props;
  const [skinTone] = useSkinTone();

  // While Emojisense results are shown, arrow keys and Enter belong to them, not to Frimousse's
  // hidden list (stopPropagation keeps Root's handler from selecting its own active emoji).
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!searching || results.length === 0) return;
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(Math.min(results.length - 1, Math.max(0, activeIndex + move)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const result = results[activeIndex];
      if (result) props.onSelect(selectionOf(result, skinTone, props.labelOf(result)));
    }
  };

  return (
    <EmojiPicker.Search
      value={query}
      onChange={(event) => onQueryChange(event.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      role="combobox"
      aria-expanded={searching && results.length > 0}
      aria-controls={searching ? props.listboxId : undefined}
      aria-activedescendant={
        searching && results.length > 0 ? `${props.listboxId}-${activeIndex}` : undefined
      }
      aria-autocomplete="list"
    />
  );
}
