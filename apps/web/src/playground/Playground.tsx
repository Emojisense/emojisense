import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { fullEngine, useEngine } from "../lib/engine-client";
import { type HealthState, useHealth, useOnline } from "./hooks";
import { createTracedSemantic } from "./lib/edge";
import {
  DEFAULT_SETTINGS,
  readSettings,
  readTab,
  type SearchSettings,
  TABS,
  type Tab,
  writeSettings,
} from "./lib/settings";
import type { CodeSample } from "./lib/snippets";
import { PhotoLab } from "./PhotoLab";
import { ReactionsLab } from "./ReactionsLab";
import { SearchInspector } from "./SearchInspector";
import "./playground.css";

const TAB_LABELS: Record<Tab, { emoji: string; label: string }> = {
  search: { emoji: "🔎", label: "Search" },
  reactions: { emoji: "💬", label: "Reactions" },
  photo: { emoji: "📷", label: "Photo" },
};

const URL_WRITE_DELAY_MS = 250;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const loadAllLanguages = () => {
  fullEngine().catch(() => {});
};

/** The Emojisense playground: search, reactions and photo, live, with timings and code. */
export default function Playground() {
  // English answers at once. Indexing every language is seconds of main-thread work on a phone,
  // so it starts on an idle desktop, on the visitor's first touch, or for a non-English locale.
  const { engine, ready } = useEngine({ upgrade: "idle" });
  const online = useOnline();
  const health = useHealth(online);
  const traced = useMemo(() => createTracedSemantic(), []);
  const [tab, setTab] = useState<Tab>("search");
  const [opened, setOpened] = useState<ReadonlySet<Tab>>(new Set(["search"]));
  const [settings, setSettings] = useState<SearchSettings>(DEFAULT_SETTINGS);
  const [codeTab, setCodeTab] = useState<CodeSample["id"]>("js");
  const [announcement, setAnnouncement] = useState("");
  const [urlRead, setUrlRead] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  const open = useCallback((next: Tab) => {
    setTab(next);
    setOpened((s) => (s.has(next) ? s : new Set([...s, next])));
  }, []);

  // Shareable state: read once after hydration (the server render uses the defaults).
  useEffect(() => {
    const first = readTab(window.location.hash);
    setSettings(readSettings(window.location.search));
    setTab(first);
    setOpened(new Set([first]));
    setUrlRead(true);
    const onHash = () => open(readTab(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [open]);

  useEffect(() => {
    if (settings.locale !== "en") loadAllLanguages();
  }, [settings.locale]);

  useEffect(() => {
    if (!urlRead) return;
    const timer = window.setTimeout(() => {
      const hash = tab === "search" ? "" : `#${tab}`;
      const next = `${window.location.pathname}${writeSettings(settings)}${hash}`;
      if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(window.history.state, "", next);
      }
    }, URL_WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [settings, tab, urlRead]);

  // "/" focuses search from anywhere on the page, as in most developer tools.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target))
        return;
      event.preventDefault();
      open("search");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const changeSettings = useCallback((patch: Partial<SearchSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length] ?? "search";
    open(next);
    tabRefs.current[TABS.indexOf(next)]?.focus();
  };

  return (
    <div className="pg" onPointerDownCapture={loadAllLanguages} onFocusCapture={loadAllLanguages}>
      <div className="pg-bar">
        <div className="pg-tabs" role="tablist" aria-label="Capabilities" onKeyDown={onTabKey}>
          {TABS.map((name, index) => (
            <button
              key={name}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${name}`}
              aria-selected={tab === name}
              aria-controls={`${id}-panel-${name}`}
              tabIndex={tab === name ? 0 : -1}
              onClick={() => open(name)}
            >
              <span className="emoji" aria-hidden="true">
                {TAB_LABELS[name].emoji}
              </span>
              {TAB_LABELS[name].label}
            </button>
          ))}
        </div>
        <StatusLine online={online} health={health} ready={ready} languages={engine?.locales.length} />
      </div>

      {TABS.map((name) => (
        <div
          key={name}
          id={`${id}-panel-${name}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${name}`}
          className="pg-tabpanel"
          hidden={tab !== name}
        >
          {opened.has(name) && name === "search" && (
            <SearchInspector
              engine={engine}
              ready={ready}
              online={online}
              health={health}
              traced={traced}
              settings={settings}
              onChange={changeSettings}
              inputRef={inputRef}
              codeTab={codeTab}
              onCodeTab={setCodeTab}
              announce={announce}
            />
          )}
          {opened.has(name) && name === "reactions" && (
            <ReactionsLab
              engine={engine}
              online={online}
              codeTab={codeTab}
              onCodeTab={setCodeTab}
              announce={announce}
            />
          )}
          {opened.has(name) && name === "photo" && (
            <PhotoLab
              engine={engine}
              online={online}
              active={tab === "photo"}
              codeTab={codeTab}
              onCodeTab={setCodeTab}
              announce={announce}
            />
          )}
        </div>
      ))}

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function StatusLine(props: {
  online: boolean;
  health: HealthState;
  ready: "loading" | "english" | "all" | "failed";
  languages: number | undefined;
}) {
  const { online, health, ready, languages } = props;
  const edge = !online
    ? { state: "off", text: "Offline · on-device search still works" }
    : health.kind === "checking"
      ? { state: "wait", text: "Connecting to the edge…" }
      : health.kind === "down"
        ? { state: "down", text: "Edge API unreachable · on device still works" }
        : health.health.semantic
          ? { state: "up", text: `Edge online · ${health.health.model}` }
          : { state: "warn", text: "Edge online · dictionary only, no Workers AI" };
  const device =
    ready === "failed"
      ? { state: "down", text: "Dictionary did not load" }
      : ready === "all"
        ? { state: "up", text: `${languages ?? 11} languages on device` }
        : ready === "english"
          ? { state: "wait", text: "English ready · other languages load when needed" }
          : { state: "wait", text: "Loading dictionary…" };
  return (
    <div className="pg-status" aria-live="polite">
      <span className="pg-status-item" data-state={device.state}>
        {device.text}
      </span>
      <span className="pg-status-item" data-state={edge.state}>
        {edge.text}
      </span>
    </div>
  );
}
