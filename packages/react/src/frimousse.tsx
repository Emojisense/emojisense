/**
 * Frimousse adapter. Frimousse ≥ 0.4 has no search override (its filter is a substring match
 * that regroups results by category), so the adapter is a hybrid:
 *   - empty query  → Frimousse's own list, fed with Emojisense data via `resolveEmojiData`
 *   - typed query  → Emojisense's ranked results, same `onEmojiSelect` contract and skin tone
 * See DECISIONS.md (2026-10-02, Frimousse adapter).
 */
import {
  applySkinTone,
  type Pack,
  ROW_INDEX,
  type SearchResult,
  SKIN_TONES,
  type SkinTone,
} from "emojisense";
import { EmojiPicker, type EmojiPickerRootProps, useSkinTone } from "frimousse";
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";
import { type Emojisense, useEmojiSearch } from "./hooks.js";

type EmojiDataResolver = NonNullable<EmojiPickerRootProps["resolveEmojiData"]>;
type EmojiData = Awaited<ReturnType<EmojiDataResolver>>;

const GROUP_LABELS: Record<string, Record<string, string>> = {
  en: {
    "smileys-emotion": "Smileys & emotion",
    "people-body": "People & body",
    "animals-nature": "Animals & nature",
    "food-drink": "Food & drink",
    "travel-places": "Travel & places",
    activities: "Activities",
    objects: "Objects",
    symbols: "Symbols",
    flags: "Flags",
  },
  tr: {
    "smileys-emotion": "İfadeler ve duygular",
    "people-body": "İnsanlar ve vücut",
    "animals-nature": "Hayvanlar ve doğa",
    "food-drink": "Yiyecek ve içecek",
    "travel-places": "Seyahat ve yerler",
    activities: "Etkinlikler",
    objects: "Nesneler",
    symbols: "Semboller",
    flags: "Bayraklar",
  },
};

const TONES = SKIN_TONES.filter((t): t is Exclude<SkinTone, "none"> => t !== "none");

/**
 * A Frimousse `resolveEmojiData` built from Emojisense packs: localized labels (Turkish
 * included) and keywords for the browse view and Frimousse's own fallback filter.
 */
export function createEmojisenseResolver(packs: Pack[]): EmojiDataResolver {
  return (locale) => {
    const pack = packs.find((p) => p.locale === locale) ?? packs[0];
    if (!pack) throw new Error("emojisense: no packs loaded");
    const labels = GROUP_LABELS[pack.locale] ?? GROUP_LABELS.en ?? {};
    const data: EmojiData = {
      locale,
      categories: pack.groups.map((group, index) => ({ index, label: labels[group] ?? group })),
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

export interface EmojisenseResultsProps
  extends Omit<ComponentProps<"div">, "children" | "onSelect" | "results"> {
  results: SearchResult[];
  onSelect: (emoji: { emoji: string; label: string }) => void;
  /** Label lookup for accessible names. */
  labelOf?: (result: SearchResult) => string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  listboxId: string;
  columns?: number;
  empty?: ReactNode;
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
        const emoji = applySkinTone(result.emoji, skinTone);
        const label = labelOf(result);
        return (
          <button
            key={result.id}
            type="button"
            role="option"
            id={`${listboxId}-${index}`}
            aria-selected={index === activeIndex}
            aria-label={label}
            tabIndex={-1}
            data-active={index === activeIndex ? "" : undefined}
            data-source={result.source}
            onMouseEnter={() => onActiveIndexChange(index)}
            onClick={() => onSelect({ emoji, label })}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}

export interface EmojisensePickerProps
  extends Omit<EmojiPickerRootProps, "onEmojiSelect" | "resolveEmojiData" | "locale"> {
  emojisense: Emojisense;
  onEmojiSelect: (emoji: { emoji: string; label: string }) => void;
  placeholder?: string;
  /** Rendered when a query has no results. */
  empty?: ReactNode;
  limit?: number;
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
    ...rest
  } = props;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const { results } = useEmojiSearch(query, emojisense, { limit });
  const resolver = useMemo(() => createEmojisenseResolver(emojisense.packs), [emojisense.packs]);
  const searching = query.trim() !== "";

  const labelOf = useCallback(
    (r: SearchResult) => {
      const labels = emojisense.engine?.get(r.id)?.labels;
      return labels?.[emojisense.locale] ?? labels?.en ?? r.emoji;
    },
    [emojisense.engine, emojisense.locale],
  );

  return (
    <EmojiPicker.Root
      {...rest}
      columns={columns}
      locale={emojisense.locale}
      resolveEmojiData={resolver}
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
          />
        ) : (
          <>
            <EmojiPicker.Loading>Loading…</EmojiPicker.Loading>
            <EmojiPicker.List />
          </>
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
  onSelect: (emoji: { emoji: string; label: string }) => void;
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
      if (result)
        props.onSelect({ emoji: applySkinTone(result.emoji, skinTone), label: props.labelOf(result) });
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
