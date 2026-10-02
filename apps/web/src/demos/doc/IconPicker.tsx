import {
  type AliasEngine,
  type AliasResult,
  createSearchSession,
  groupLabel,
  type ResultSource,
  type SessionState,
} from "emojisense";
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDemoI18n } from "../../i18n/demos";
import { labelOf, pageLocale, sharedSemantic } from "../../lib/engine-client";
import { describeEmoji } from "./describe";

const COLUMNS = 8;
const RESULT_LIMIT = 48;

interface Cell {
  emoji: string;
  id: string;
  source: ResultSource;
  match?: AliasResult | undefined;
}

interface Section {
  key: string;
  label?: string;
  cells: Cell[];
}

function browseSections(engine: AliasEngine, locale: string): Section[] {
  const byGroup = new Map<string, Cell[]>();
  for (const entry of engine.entries) {
    // Unknown groups (skin tone and hair components) are parts, not icons.
    if (groupLabel(entry.group) === entry.group) continue;
    const cells = byGroup.get(entry.group) ?? [];
    cells.push({ emoji: entry.emoji, id: entry.id, source: "alias" });
    byGroup.set(entry.group, cells);
  }
  return [...byGroup].map(([group, cells]) => ({ key: group, label: groupLabel(group, locale), cells }));
}

/** Rows of flat cell indexes, per section, so ↑ / ↓ keep the column across section breaks. */
function gridRows(sections: Section[]): number[][] {
  const rows: number[][] = [];
  let index = 0;
  for (const section of sections) {
    for (let start = 0; start < section.cells.length; start += COLUMNS) {
      const size = Math.min(COLUMNS, section.cells.length - start);
      rows.push(Array.from({ length: size }, (_, i) => index + start + i));
    }
    index += section.cells.length;
  }
  return rows;
}

/** Scroll only the list (never the page) so the option is fully visible below the sticky label. */
function revealWithin(list: HTMLElement, option: HTMLElement, stickyOffset: number) {
  const top = option.offsetTop - stickyOffset;
  const bottom = option.offsetTop + option.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

interface OptionProps {
  cell: Cell;
  index: number;
  optionId: string;
  label: string;
  selected: boolean;
  onChoose: (event: { currentTarget: HTMLElement }) => void;
  onHover: (event: PointerEvent<HTMLElement>) => void;
}

const EmojiOption = memo(function EmojiOption({
  cell,
  index,
  optionId,
  label,
  selected,
  onChoose,
  onHover,
}: OptionProps) {
  return (
    <button
      type="button"
      id={optionId}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-label={label}
      data-index={index}
      className="doc-pick-option emoji"
      onClick={onChoose}
      onPointerMove={onHover}
    >
      {cell.emoji}
    </button>
  );
});

interface IconSearchProps {
  engine: AliasEngine;
  onPick: (emoji: string) => void;
  onClose: (restoreFocus: boolean) => void;
}

/** The compact icon popover: browse by group, or search with the engine (meaning fused in). */
function IconSearch({ engine, onPick, onClose }: IconSearchProps) {
  const { t, messages } = useDemoI18n();
  const locale = useMemo(() => pageLocale(), []);
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SessionState | undefined>();
  const [active, setActive] = useState(0);

  const session = useMemo(() => {
    const semantic = sharedSemantic();
    return createSearchSession({
      engine,
      ...(semantic ? { semantic } : {}),
      locale,
      limit: RESULT_LIMIT,
      debounceMs: 180,
      onChange: setState,
    });
  }, [engine, locale]);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    session.update(query);
    setActive(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [session, query]);

  // On touch screens a focused field would push the on-screen keyboard over the grid.
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) inputRef.current?.focus({ preventScroll: true });
  }, []);

  const browsing = query.trim() === "";
  const all = useMemo(() => browseSections(engine, locale), [engine, locale]);
  const sections = useMemo<Section[]>(() => {
    if (browsing) return all;
    if (!state || state.query !== query) return [{ key: "results", cells: [] }];
    const matches = new Map(state.alias.results.map((result) => [result.id, result]));
    const cells = state.results.map((result) => ({
      emoji: result.emoji,
      id: result.id,
      source: result.source,
      match: matches.get(result.id),
    }));
    return [{ key: "results", cells }];
  }, [browsing, all, state, query]);
  const cells = useMemo(() => sections.flatMap((section) => section.cells), [sections]);
  const rows = useMemo(() => gridRows(sections), [sections]);
  const offsets = useMemo(() => {
    let total = 0;
    return sections.map((section) => {
      const start = total;
      total += section.cells.length;
      return start;
    });
  }, [sections]);
  const current = cells[active];
  const info = current
    ? describeEmoji(engine, current.id, current.source, current.match, messages.doc.menu, locale)
    : undefined;

  useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    const sticky = list?.querySelector<HTMLElement>(".doc-pick-group")?.offsetHeight ?? 0;
    if (list && option) revealWithin(list, option, sticky);
  }, [active]);

  const choose = useCallback(
    (index: number) => {
      const cell = cells[index];
      if (cell) onPick(cell.emoji);
    },
    [cells, onPick],
  );
  const onChoose = useCallback(
    (event: { currentTarget: HTMLElement }) => choose(Number(event.currentTarget.dataset.index)),
    [choose],
  );
  const onHover = useCallback((event: PointerEvent<HTMLElement>) => {
    setActive(Number(event.currentTarget.dataset.index));
  }, []);

  const moveBy = (rowStep: number, columnStep: number) => {
    if (cells.length === 0) return;
    if (columnStep !== 0) {
      setActive((index) => Math.min(cells.length - 1, Math.max(0, index + columnStep)));
      return;
    }
    const rowIndex = rows.findIndex((row) => row.includes(active));
    const row = rows[rowIndex];
    const next = rows[rowIndex + rowStep];
    if (!row || !next) return;
    const column = row.indexOf(active);
    setActive(next[Math.min(column, next.length - 1)] ?? active);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      moveBy(...move);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    }
  };

  const shuffle = () => {
    const pool = all.flatMap((section) => section.cells);
    const cell = pool[Math.floor(Math.random() * pool.length)];
    if (cell) onPick(cell.emoji);
  };

  const searching = !browsing && (!state || state.query !== query);

  return (
    <div className="doc-pick" role="dialog" aria-label={t.t("doc.picker.dialog")}>
      <div className="doc-pick-bar">
        <div className="doc-pick-search">
          <svg className="doc-pick-search-icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.25 10.25 13.5 13.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t.t("doc.picker.placeholder")}
            aria-label={t.t("doc.picker.search")}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(active) : undefined}
          />
        </div>
        <button type="button" className="doc-pick-random" onClick={shuffle} title={t.t("doc.picker.random")}>
          <svg className="doc-pick-random-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 4.5h2.5c3.5 0 3.5 7 7 7H14M2 11.5h2.5c1.4 0 2.2-1.1 2.9-2.3M9.6 6.8c.7-1.2 1.5-2.3 2.9-2.3H14M12.25 2.75 14 4.5l-1.75 1.75M12.25 9.75 14 11.5l-1.75 1.75" />
          </svg>
          <span className="visually-hidden">{t.t("doc.picker.randomEmoji")}</span>
        </button>
      </div>

      <div
        ref={listRef}
        id={listId}
        className="doc-pick-list"
        role="listbox"
        aria-label={browsing ? t.t("doc.picker.all") : t.t("doc.picker.for", { query })}
      >
        {sections.map((section, sectionIndex) => (
          <fieldset
            key={section.key}
            className="doc-pick-section"
            aria-label={section.label ?? t.t("doc.picker.results")}
          >
            {section.label && (
              <div className="doc-pick-group" aria-hidden="true">
                {section.label}
              </div>
            )}
            <div className="doc-pick-grid">
              {section.cells.map((cell, cellIndex) => {
                const index = (offsets[sectionIndex] ?? 0) + cellIndex;
                return (
                  <EmojiOption
                    key={cell.id}
                    cell={cell}
                    index={index}
                    optionId={optionId(index)}
                    label={labelOf(engine, cell.id, locale) ?? cell.emoji}
                    selected={index === active}
                    onChoose={onChoose}
                    onHover={onHover}
                  />
                );
              })}
            </div>
          </fieldset>
        ))}
        {!browsing && !searching && cells.length === 0 && (
          <p className="doc-pick-empty">{t.t("doc.picker.empty", { query })}</p>
        )}
      </div>

      <div className="doc-pick-foot">
        {current && info ? (
          <>
            <span className="emoji doc-pick-preview" aria-hidden="true">
              {current.emoji}
            </span>
            <span className="doc-pick-name">{info.label}</span>
            <code className="doc-pick-code">:{info.code}:</code>
            {info.why && <span className="doc-pick-why">{info.why}</span>}
          </>
        ) : (
          <span className="doc-pick-hint">{t.t("doc.picker.hint", messages.doc.picker.hintWords)}</span>
        )}
      </div>
    </div>
  );
}

export interface IconPickerProps {
  icon: string;
  engine: AliasEngine | undefined;
  onPick: (emoji: string) => void;
}

/** The page icon. Click it to change it with a compact search popover. */
export function IconPicker({ icon, engine, onPick }: IconPickerProps) {
  const { t } = useDemoI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = useMemo(() => {
    const entry = engine?.entries.find((candidate) => candidate.emoji === icon);
    return entry ? labelOf(engine, entry.id) : undefined;
  }, [engine, icon]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      if (!anchorRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close]);

  const pick = useCallback(
    (emoji: string) => {
      onPick(emoji);
      close(true);
    },
    [onPick, close],
  );

  return (
    <div className="doc-icon-anchor" ref={anchorRef}>
      <button
        ref={buttonRef}
        type="button"
        className="doc-icon"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ? t.t("doc.picker.pageIconNamed", { label }) : t.t("doc.picker.pageIcon")}
        disabled={!engine}
        onClick={() => setOpen((value) => !value)}
      >
        <span key={icon} className="emoji">
          {icon}
        </span>
      </button>
      {open && engine && <IconSearch engine={engine} onPick={pick} onClose={close} />}
    </div>
  );
}
