import { type AliasResult, createSearchSession, type SearchResult, type SessionState } from "emojisense";
import { type CSSProperties, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { sharedSemantic, useEngine } from "../lib/engine-client";
import { searchCustom } from "./workspaces/custom-engine";
import {
  type CustomEmoji,
  customEmojiSrc,
  PRESET_QUERIES,
  type SeedReaction,
  WORKSPACES,
  type Workspace,
} from "./workspaces/data";
import "./workspaces.css";

const CUSTOM_LIMIT = 6;
const STANDARD_LIMIT = 16;

type WorkspaceId = Workspace["id"];

/** One result in the picker, custom or standard. */
interface Option {
  id: string;
  kind: "custom" | "standard";
  /** The glyph, or the `:shortcode:` of a custom emoji. */
  emoji: string;
  /** Shortcode name (custom) or emoji label (standard). */
  label: string;
  src?: string;
  /** The phrase that matched, when the alias index found it. */
  match?: string;
}

interface Reaction {
  id: string;
  emoji: string;
  label: string;
  src?: string;
  count: number;
  mine: boolean;
}

const FIRST = WORKSPACES[0] as Workspace;

function seedReactions(): Record<WorkspaceId, Reaction[]> {
  const toReaction = (workspace: Workspace, seed: SeedReaction): Reaction =>
    "custom" in seed
      ? {
          id: `${workspace.id}/${seed.custom}`,
          emoji: `:${seed.custom}:`,
          label: seed.custom,
          src: customEmojiSrc(workspace, seed.custom),
          count: seed.count,
          mine: false,
        }
      : { ...seed, mine: false };
  return Object.fromEntries(
    WORKSPACES.map((w) => [w.id, w.message.reactions.map((seed) => toReaction(w, seed))]),
  ) as Record<WorkspaceId, Reaction[]>;
}

function customOption(workspace: Workspace, item: CustomEmoji, match?: string): Option {
  return {
    id: `${workspace.id}/${item.name}`,
    kind: "custom",
    emoji: `:${item.name}:`,
    label: item.name,
    src: customEmojiSrc(workspace, item.name),
    ...(match ? { match } : {}),
  };
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

function optionName(option: Option): string {
  return option.kind === "custom" ? `:${option.label}:` : option.label || option.emoji;
}

/**
 * One chat product, three customer workspaces (tenants). Each workspace has its own custom emoji,
 * searched by the real engine as an extra in-memory pack, next to the standard set.
 */
export default function WorkspacesDemo() {
  const { engine, ready } = useEngine();
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId>(FIRST.id);
  const [direction, setDirection] = useState<"up" | "down">("down");
  const [query, setQuery] = useState<string>(PRESET_QUERIES[0]);
  const [standard, setStandard] = useState<SessionState | undefined>();
  const [active, setActive] = useState(0);
  const [reactions, setReactions] = useState(seedReactions);
  const [popped, setPopped] = useState<string | undefined>();
  const [inspected, setInspected] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const uid = useId();

  const workspaceIndex = Math.max(
    0,
    WORKSPACES.findIndex((w) => w.id === workspaceId),
  );
  const workspace = WORKSPACES[workspaceIndex] ?? FIRST;
  const hasQuery = query.trim() !== "";

  const semantic = useMemo(() => sharedSemantic(), []);
  const session = useMemo(
    () =>
      engine
        ? createSearchSession({
            engine,
            ...(semantic ? { semantic } : {}),
            limit: STANDARD_LIMIT,
            debounceMs: 180,
            onChange: setStandard,
          })
        : undefined,
    [engine, semantic],
  );
  useEffect(() => {
    session?.update(query);
  }, [session, query]);
  useEffect(() => () => session?.dispose(), [session]);

  const customResults = useMemo(
    () => (hasQuery ? searchCustom(workspace, query, CUSTOM_LIMIT) : []),
    [workspace, query, hasQuery],
  );
  const customOptions = useMemo<Option[]>(() => {
    if (!hasQuery) return workspace.emoji.map((item) => customOption(workspace, item));
    const byName = new Map(workspace.emoji.map((item) => [item.name, item]));
    return customResults.flatMap((r) => {
      const item = byName.get(r.name);
      return item ? [customOption(workspace, item, r.match)] : [];
    });
  }, [workspace, customResults, hasQuery]);

  const standardOptions = useMemo<Option[]>(() => {
    if (!hasQuery || !standard || standard.query !== query) return [];
    return standard.results.map((r: SearchResult) => {
      const alias = r.source === "alias" ? (r as AliasResult) : undefined;
      return {
        id: r.id,
        kind: "standard",
        emoji: r.emoji,
        label: alias?.label || engine?.get(r.id)?.labels.en || "",
        ...(alias ? { match: alias.match } : {}),
      };
    });
  }, [standard, query, hasQuery, engine]);

  const options = useMemo(() => [...customOptions, ...standardOptions], [customOptions, standardOptions]);
  const activeIndex = Math.min(active, options.length - 1);
  const current = options[activeIndex];
  const matchedCustom = new Set(customResults.map((r) => r.id));

  // A new query or workspace starts at the first (best) result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on these changes only.
  useEffect(() => setActive(0), [query, workspaceId]);

  const switchTo = (index: number, focus = false) => {
    const next = WORKSPACES[(index + WORKSPACES.length) % WORKSPACES.length];
    if (!next) return;
    if (next.id !== workspaceId) {
      setDirection(WORKSPACES.indexOf(next) > workspaceIndex ? "down" : "up");
      setWorkspaceId(next.id);
      setInspected(undefined);
    }
    if (focus) tabRefs.current[WORKSPACES.indexOf(next)]?.focus();
  };

  const onRailKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      switchTo(event.key === "Home" ? 0 : WORKSPACES.length - 1, true);
    } else if (step) {
      event.preventDefault();
      switchTo(workspaceIndex + step, true);
    }
  };

  const react = (option: Option) => {
    setReactions((all) => {
      const list = all[workspace.id];
      const existing = list.find((r) => r.id === option.id);
      const next = existing
        ? list.map((r) => (r.id === option.id && !r.mine ? { ...r, count: r.count + 1, mine: true } : r))
        : [
            ...list,
            {
              id: option.id,
              emoji: option.emoji,
              label: option.label,
              ...(option.src ? { src: option.src } : {}),
              count: 1,
              mine: true,
            },
          ];
      return { ...all, [workspace.id]: next };
    });
    setPopped(option.id);
  };

  const toggleReaction = (id: string) => {
    setReactions((all) => {
      const list = all[workspace.id].flatMap((r) => {
        if (r.id !== id) return [r];
        const count = r.count + (r.mine ? -1 : 1);
        return count > 0 ? [{ ...r, count, mine: !r.mine }] : [];
      });
      return { ...all, [workspace.id]: list };
    });
    setPopped(id);
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      react(current);
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    }
  };

  const listboxId = `${uid}-results`;
  const optionId = (index: number) => `${uid}-option-${index}`;
  const panelId = `${uid}-panel`;
  const inspectedItem =
    workspace.emoji.find((item) => `${workspace.id}/${item.name}` === inspected) ??
    workspace.emoji.find((item) => matchedCustom.has(`${workspace.id}/${item.name}`));
  const standardTiming =
    standard && standard.query === query && hasQuery
      ? standard.status === "fused" && standard.semanticMs !== undefined
        ? `meaning · ${Math.round(standard.semanticMs)} ms`
        : `on-device · ${standard.aliasMs < 0.1 ? "< 0.1" : standard.aliasMs.toFixed(1)} ms`
      : undefined;

  return (
    <div className="ws" data-dir={direction}>
      <div className="ws-app">
        <div className="ws-rail">
          <div
            className="ws-tabs"
            role="tablist"
            aria-label="Workspaces"
            aria-orientation="vertical"
            onKeyDown={onRailKey}
            style={{ "--ws-index": workspaceIndex } as CSSProperties}
          >
            <span className="ws-glide" aria-hidden="true" />
            {WORKSPACES.map((w, i) => (
              <button
                key={w.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                id={`${uid}-tab-${w.id}`}
                type="button"
                role="tab"
                className="ws-tab"
                aria-selected={w.id === workspace.id}
                aria-controls={panelId}
                aria-label={w.name}
                title={`${w.name} · ${w.kind}`}
                tabIndex={w.id === workspace.id ? 0 : -1}
                onClick={() => switchTo(i)}
              >
                {w.monogram}
              </button>
            ))}
          </div>
        </div>

        <div className="ws-panel" id={panelId} role="tabpanel" aria-labelledby={`${uid}-tab-${workspace.id}`}>
          <div className="ws-main">
            <header className="ws-head">
              <div key={workspace.id} className="ws-head-title ws-swap">
                <span className="ws-name">{workspace.name}</span>
                <span className="ws-channel">
                  <span aria-hidden="true">#</span>
                  {workspace.channel}
                </span>
              </div>
              <span className="ws-tenant" title="Tenant id">
                <span className="ws-tenant-key">tenant</span>
                {workspace.tenant}
              </span>
            </header>

            <div className="ws-body">
              <article key={workspace.id} className="ws-message ws-swap" aria-label="Message">
                <span className="ws-avatar" aria-hidden="true">
                  {initials(workspace.message.author)}
                </span>
                <div className="ws-message-main">
                  <p className="ws-meta">
                    <span className="ws-author">{workspace.message.author}</span>
                    <time className="ws-time">{workspace.message.time}</time>
                  </p>
                  <p className="ws-text">{workspace.message.text}</p>
                  <div className="ws-reactions">
                    {reactions[workspace.id].map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`ws-reaction${popped === r.id ? " is-popped" : ""}`}
                        aria-pressed={r.mine}
                        aria-label={`${r.src ? `:${r.label}:` : r.label}, ${r.count}`}
                        onClick={() => toggleReaction(r.id)}
                        onAnimationEnd={() => setPopped(undefined)}
                      >
                        {r.src ? (
                          <img src={r.src} alt="" width={64} height={64} />
                        ) : (
                          <span className="emoji">{r.emoji}</span>
                        )}
                        <span className="ws-count">{r.count}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="ws-reaction ws-add"
                      aria-label="Add reaction"
                      onClick={() => inputRef.current?.focus()}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M17.4 9.3a7.5 7.5 0 1 1-6.7-6.7" />
                        <path d="M7 11.8a3.6 3.6 0 0 0 6 0M7.6 8h0M12.4 8h0M15.5 2.5v5M13 5h5" />
                      </svg>
                    </button>
                  </div>
                </div>
              </article>

              <section className="ws-picker" aria-label="Emoji picker">
                <div className="ws-search">
                  <svg className="ws-search-icon" viewBox="0 0 20 20" aria-hidden="true">
                    <circle cx="8.75" cy="8.75" r="5.75" />
                    <path d="m13 13 4 4" />
                  </svg>
                  <input
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    aria-activedescendant={current ? optionId(activeIndex) : undefined}
                    aria-label={`Search emoji in ${workspace.name}`}
                    placeholder={`Search ${workspace.name} emoji`}
                    value={query}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onInputKey}
                  />
                  {query && (
                    <button
                      type="button"
                      className="ws-clear"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="m6 6 8 8M14 6l-8 8" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="ws-chips">
                  <span className="ws-chips-label">Try</span>
                  {PRESET_QUERIES.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="ws-chip"
                      aria-pressed={query === preset}
                      onClick={() => setQuery(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="ws-results" id={listboxId} role="listbox" aria-label="Emoji results">
                  {/* biome-ignore lint/a11y/useSemanticElements: an option group inside a listbox (ARIA APG pattern); fieldset is not allowed there. */}
                  <div className="ws-group" role="group" aria-labelledby={`${uid}-custom-label`}>
                    <div className="ws-group-label" id={`${uid}-custom-label`} role="presentation">
                      <span className="ws-custom-mark" aria-hidden="true" />
                      {hasQuery ? "Custom" : "Custom emoji"}
                      <span className="ws-group-from">{workspace.name}</span>
                    </div>
                    {customOptions.length > 0 ? (
                      <div key={workspace.id} className="ws-custom-list" role="presentation">
                        {customOptions.map((option, i) => (
                          <button
                            key={option.id}
                            id={optionId(i)}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={i === activeIndex}
                            aria-label={`:${option.label}:, custom`}
                            className="ws-custom-option"
                            style={{ animationDelay: `${i * 40}ms` }}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => react(option)}
                          >
                            <img className="ws-custom-art" src={option.src} alt="" width={64} height={64} />
                            <span className="ws-shortcode">:{option.label}:</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p key={workspace.id} className="ws-none ws-swap" role="presentation">
                        No custom emoji for “{query.trim()}” here. The standard set still answers.
                      </p>
                    )}
                  </div>

                  {hasQuery && (
                    // biome-ignore lint/a11y/useSemanticElements: an option group inside a listbox (ARIA APG pattern).
                    <div className="ws-group" role="group" aria-labelledby={`${uid}-standard-label`}>
                      <div className="ws-group-label" id={`${uid}-standard-label`} role="presentation">
                        Standard
                      </div>
                      <div className="ws-grid" role="presentation">
                        {ready === "failed" && (
                          <p className="ws-none" role="presentation">
                            The standard set cannot load right now. Custom search still works.
                          </p>
                        )}
                        {!engine &&
                          ready !== "failed" &&
                          Array.from({ length: 12 }, (_, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders that never reorder.
                            <span key={i} className="ws-tile ws-skeleton" role="presentation" />
                          ))}
                        {engine && standardOptions.length === 0 && (
                          <p className="ws-none" role="presentation">
                            No standard match yet. Keep typing.
                          </p>
                        )}
                        {standardOptions.map((option, j) => {
                          const i = customOptions.length + j;
                          return (
                            <button
                              key={option.id}
                              id={optionId(i)}
                              type="button"
                              role="option"
                              tabIndex={-1}
                              aria-selected={i === activeIndex}
                              aria-label={option.label || option.emoji}
                              className="ws-tile"
                              style={{ animationDelay: `${Math.min(j, 12) * 14}ms` }}
                              onMouseEnter={() => setActive(i)}
                              onClick={() => react(option)}
                            >
                              <span className="emoji">{option.emoji}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <footer className="ws-preview">
                  {current ? (
                    <>
                      <span className="ws-preview-glyph" aria-hidden="true">
                        {current.src ? (
                          <img src={current.src} alt="" width={64} height={64} />
                        ) : (
                          <span className="emoji">{current.emoji}</span>
                        )}
                      </span>
                      <span className="ws-preview-text">
                        <span className="ws-preview-name">{optionName(current)}</span>
                        <span className="ws-preview-why">
                          <span className="ws-source" data-kind={current.kind}>
                            {current.kind}
                          </span>
                          {hasQuery ? (
                            current.match ? (
                              <>
                                matched <q>{current.match}</q>
                              </>
                            ) : (
                              <>matched by meaning</>
                            )
                          ) : (
                            <>Enter or click to react</>
                          )}
                        </span>
                      </span>
                    </>
                  ) : (
                    <span className="ws-preview-why">Type a word, or try a chip.</span>
                  )}
                  {standardTiming && <span className="ws-timing">{standardTiming}</span>}
                </footer>
                <p className="visually-hidden" aria-live="polite">
                  {hasQuery
                    ? `${customOptions.length} custom and ${standardOptions.length} standard results in ${workspace.name}.`
                    : ""}
                </p>
              </section>
            </div>
          </div>

          <aside className="ws-aside" aria-label={`${workspace.name} custom emoji`}>
            <div className="ws-aside-head">
              <h4 className="ws-aside-title">
                Custom emoji <span className="ws-aside-count">{workspace.emoji.length}</span>
              </h4>
              {workspace.importedFrom ? (
                <span
                  key={workspace.id}
                  className="ws-badge ws-swap"
                  title="Slack and Discord import: Pro and Scale plans"
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 2.5v7M5 6.8 8 9.8l3-3M3 11v1.5A1 1 0 0 0 4 13.5h8a1 1 0 0 0 1-1V11" />
                  </svg>
                  Imported from {workspace.importedFrom}
                </span>
              ) : (
                <span key={workspace.id} className="ws-origin ws-swap">
                  Added by workspace admins
                </span>
              )}
            </div>

            <ul key={workspace.id} className="ws-set" aria-label="Custom set">
              {workspace.emoji.map((item, i) => {
                const id = `${workspace.id}/${item.name}`;
                const state = matchedCustom.size === 0 ? "idle" : matchedCustom.has(id) ? "match" : "dim";
                return (
                  <li key={item.name} style={{ animationDelay: `${i * 30}ms` }}>
                    <button
                      type="button"
                      className="ws-set-item"
                      data-state={state}
                      aria-label={`React with :${item.name}:`}
                      onMouseEnter={() => setInspected(id)}
                      onFocus={() => setInspected(id)}
                      onMouseLeave={() => setInspected(undefined)}
                      onBlur={() => setInspected(undefined)}
                      onClick={() => react(customOption(workspace, item))}
                    >
                      <img src={customEmojiSrc(workspace, item.name)} alt="" width={64} height={64} />
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="ws-inspect" aria-live="polite">
              {inspectedItem ? (
                <>
                  <span className="ws-inspect-name">:{inspectedItem.name}:</span>
                  <span className="ws-inspect-aliases">{inspectedItem.aliases.join(" · ")}</span>
                </>
              ) : (
                <span className="ws-inspect-aliases">Point at an emoji to see the words that find it.</span>
              )}
            </div>

            <div className="ws-note">
              <p className="ws-note-label">
                Tenants <span>Scale plan</span>
              </p>
              <p>
                Each customer is a tenant with its own custom set. Your server writes it with a secret key.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
