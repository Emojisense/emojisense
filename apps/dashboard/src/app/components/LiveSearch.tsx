import { type AliasEngine, createSearchSession, type SearchSession, type SessionState } from "emojisense";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { type App, api, type CustomEmoji } from "../api";
import { API_URL } from "../lib/config";
import { loadEngine, semanticFor } from "../lib/engine";
import { planIncludes } from "../lib/plans";
import { forgetTryKey, readTryKey, saveTryKey } from "../lib/tryKey";
import { Link } from "../router";
import { appHref } from "../routes";
import { Icon } from "../ui/Icon";
import { useToast } from "../ui/Toast";
import { TryKeyField } from "./TryKeyField";

/** Queries that the on-device dictionary answers without the API. */
const EXAMPLES = ["ship it", "facepalm", "sleepy monday", "no cap", "party"];

interface LiveSearchProps {
  app: App;
  /** A publishable key created in this tab (memory only), so calls count for this app. */
  createdKey?: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/^:+|:+$/g, "")
    .trim();
}

/** Custom emoji are matched here by shortcode and alias, and shown before the standard set. */
function matchCustom(emoji: CustomEmoji[], query: string): CustomEmoji[] {
  const needle = normalize(query);
  if (needle.length < 2) return [];
  const compact = needle.replace(/[\s_-]+/g, "");
  return emoji
    .filter(
      (item) =>
        item.shortcode.replace(/[_-]+/g, "").includes(compact) ||
        item.aliases.some((alias) => normalize(alias).includes(needle)),
    )
    .slice(0, 6);
}

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "";
  return ms < 1 ? `${ms.toFixed(2)} ms` : `${Math.round(ms)} ms`;
}

export function LiveSearch({ app, createdKey }: LiveSearchProps) {
  const toast = useToast();
  const inputId = useId();
  const statusId = useId();
  const [pastedKey, setPastedKey] = useState(() => readTryKey(app.id));
  const keyInUse: { key: string; source: "pasted" | "created" } | null = pastedKey
    ? { key: pastedKey, source: "pasted" }
    : createdKey
      ? { key: createdKey, source: "created" }
      : null;
  const apiKey = keyInUse?.key;
  const [engine, setEngine] = useState<AliasEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SessionState | null>(null);
  const [custom, setCustom] = useState<CustomEmoji[]>([]);
  const session = useRef<SearchSession | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` retries the load
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadEngine().then(
      (loaded) => live && setEngine(loaded),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!engine) return;
    // Without a key the search stays on the device; it never calls the API anonymously here.
    const created = createSearchSession({
      engine,
      ...(apiKey ? { semantic: semanticFor(apiKey) } : {}),
      limit: 24,
      onChange: setState,
    });
    session.current = created;
    if (queryRef.current) created.update(queryRef.current);
    return () => {
      created.dispose();
      session.current = null;
    };
  }, [engine, apiKey]);

  const customAllowed = planIncludes(app.plan, "custom_emoji");
  useEffect(() => {
    if (!customAllowed) return;
    let live = true;
    api.listEmoji(app.id).then(
      (list) => live && setCustom(list.emoji),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [app.id, customAllowed]);

  const customMatches = useMemo(() => matchCustom(custom, query), [custom, query]);

  function search(value: string) {
    setQuery(value);
    session.current?.update(value);
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${label}`);
    } catch {
      toast("Copy did not work in this browser.");
    }
  }

  const results = state && state.query === query ? state.results : [];
  const hasQuery = query.trim().length > 0;
  const noMatch =
    hasQuery && state?.status !== "loading" && results.length === 0 && customMatches.length === 0;

  return (
    <section className="card live" aria-labelledby={`${inputId}-title`}>
      <div className="card-head">
        <div>
          <h2 id={`${inputId}-title`} className="card-title">
            Try it
          </h2>
          <p className="card-sub">The same search your users get: on the device first, then by meaning.</p>
        </div>
        <span className="badge badge-dot" data-tone={engine ? "good" : failed ? "bad" : "idle"}>
          {engine ? "Live" : failed ? "Offline" : "Loading"}
        </span>
      </div>
      <div className="card-body live-body">
        <div className="live-field">
          <Icon name="search" />
          <label htmlFor={inputId} className="visually-hidden">
            Search emoji
          </label>
          <input
            id={inputId}
            className="live-input"
            type="search"
            placeholder={engine ? "Type anything: slang, a feeling, a film…" : "Loading the emoji data…"}
            autoComplete="off"
            spellCheck={false}
            value={query}
            disabled={!engine}
            aria-describedby={statusId}
            onChange={(event) => search(event.target.value)}
          />
          {state && hasQuery && (
            <span className="live-timing mono" aria-hidden="true">
              {state.status === "loading" ? "…" : formatMs(state.semanticMs ?? state.aliasMs)}
            </span>
          )}
        </div>

        {failed && (
          <div className="notice">
            <span>
              The emoji data did not load from <code className="code-inline">{API_URL}</code>, so the live
              search is off.
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setAttempt((count) => count + 1)}>
              Try again
            </button>
          </div>
        )}

        {!hasQuery && engine && (
          <div className="live-examples">
            <span className="hint">Try</span>
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="chip" onClick={() => search(example)}>
                {example}
              </button>
            ))}
          </div>
        )}

        {hasQuery && (customMatches.length > 0 || results.length > 0) && (
          <ul className="live-results" aria-label={`Results for ${query}`}>
            {customMatches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="live-tile live-tile-custom"
                  title={`:${item.shortcode}: (custom)`}
                  onClick={() => copy(`:${item.shortcode}:`, `:${item.shortcode}:`)}
                >
                  <img src={item.imageUrl} alt={`:${item.shortcode}:`} loading="lazy" />
                </button>
              </li>
            ))}
            {results.map((result) => {
              const label = engine?.get(result.id)?.labels.en ?? result.id;
              return (
                <li key={result.id}>
                  <button
                    type="button"
                    className="live-tile emoji"
                    title={label}
                    aria-label={`${result.emoji} ${label}`}
                    onClick={() => copy(result.emoji, result.emoji)}
                  >
                    {result.emoji}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {noMatch && (
          <div className="live-empty">
            <span className="emoji" aria-hidden="true">
              🫥
            </span>
            <p>
              Nothing for “{query}” yet.
              {customAllowed && (
                <>
                  {" "}
                  <Link to={`${appHref(app.id, "emoji")}?new=${encodeURIComponent(query)}`} className="link">
                    Add it as a custom emoji
                  </Link>
                </>
              )}
            </p>
          </div>
        )}

        {hasQuery && state?.status === "error" && (
          <p className="notice">
            <span className="emoji" aria-hidden="true">
              🔑
            </span>
            <span>
              The API did not take this key from this page, so these are on-device results. A publishable key
              answers only its allowed origins: add{" "}
              <code className="code-inline">{window.location.origin}</code> to try it here.
            </span>
          </p>
        )}

        <p id={statusId} className="live-status hint" aria-live="polite">
          {state && hasQuery
            ? `${results.length + customMatches.length} results · ${
                state.status === "fused"
                  ? `on device and by meaning${state.semanticCached ? " (edge cache)" : ""}`
                  : state.status === "loading"
                    ? "on device, asking for meaning…"
                    : "on device"
              }`
            : ""}
        </p>

        <TryKeyField
          current={keyInUse}
          onUse={(key) => {
            saveTryKey(app.id, key);
            setPastedKey(key);
          }}
          onForget={() => {
            forgetTryKey(app.id);
            setPastedKey(null);
          }}
        />
      </div>
    </section>
  );
}
