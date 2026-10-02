import type { AliasEngine } from "emojisense";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDemoI18n } from "../i18n/demos";
import { firstEngine, fullEngine, pageLocale, sharedSemantic, useEngine } from "../lib/engine-client";
import { useAutoplayControl } from "./autoplay-control";
import { DEFAULT_ICON, docCopy, documentHtml, TEAMMATE } from "./doc/content";
import { IconPicker } from "./doc/IconPicker";
import { sleep } from "./doc/sleep";
import docCss from "./doc.css?url";

type Runtime = typeof import("./doc/editor");
type DocEditor = import("./doc/editor").DocEditor;

interface Autoplay {
  phase: "waiting" | "playing" | "done";
  controller: AbortController | undefined;
}

interface SidebarPage {
  emoji: string;
  title: string;
  depth?: number;
  current?: boolean;
}

type SidebarWords = ReturnType<typeof useDemoI18n>["messages"]["doc"]["sidebar"];

const teamPages = (words: SidebarWords, pageTitle: string): SidebarPage[] => [
  { emoji: "📣", title: words.launchPlan },
  { emoji: "🗂️", title: words.retros },
  { emoji: DEFAULT_ICON, title: pageTitle, depth: 1, current: true },
  { emoji: "🌱", title: words.q2, depth: 1 },
  { emoji: "🗺️", title: words.roadmap },
  { emoji: "🧪", title: words.experiments },
];
const privatePages = (words: SidebarWords): SidebarPage[] => [
  { emoji: "✍️", title: words.drafts },
  { emoji: "📚", title: words.reading },
];

/** Resolves once enough of the element is on screen; the autoplay never runs unseen. */
function whenVisible(element: Element, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        resolve();
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    signal.addEventListener(
      "abort",
      () => {
        observer.disconnect();
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function Icon({ path }: { path: string }) {
  return (
    <svg className="doc-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const GLYPHS = {
  search: "M7 11.25a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5ZM10.25 10.25 13.5 13.5",
  home: "M2.75 7.25 8 2.75l5.25 4.5V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3.25a.5.5 0 0 1-.5-.5Z",
  inbox: "M2.5 9.5 4 3.5h8l1.5 6M2.5 9.5V12.5h11v-3h-3.25a2.25 2.25 0 0 1-4.5 0Z",
  chevron: "M6 4.5 9.5 8 6 11.5",
  plus: "M8 3.5v9M3.5 8h9",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
};

function Sidebar({ icon, pageTitle }: { icon: string; pageTitle: string }) {
  const { messages } = useDemoI18n();
  const words = messages.doc.sidebar;
  const row = (page: SidebarPage) => (
    <li
      key={page.title}
      className="doc-side-page"
      data-current={page.current || undefined}
      style={page.depth ? { paddingInlineStart: `${0.5 + page.depth * 0.875}rem` } : undefined}
    >
      <span className="emoji">{page.current ? icon : page.emoji}</span>
      <span className="doc-side-title">{page.title}</span>
    </li>
  );
  return (
    <aside className="doc-side" aria-hidden="true">
      <div className="doc-side-workspace">
        <span className="doc-side-mark">H</span>
        <span className="doc-side-name">Halcyon</span>
      </div>
      <ul className="doc-side-nav">
        <li>
          <Icon path={GLYPHS.search} />
          {words.search}
          <kbd>⌘K</kbd>
        </li>
        <li>
          <Icon path={GLYPHS.home} />
          {words.home}
        </li>
        <li>
          <Icon path={GLYPHS.inbox} />
          {words.inbox}
        </li>
      </ul>
      <p className="doc-side-label">{words.product}</p>
      <ul className="doc-side-pages">{teamPages(words, pageTitle).map(row)}</ul>
      <p className="doc-side-label">{words.private}</p>
      <ul className="doc-side-pages">{privatePages(words).map(row)}</ul>
      <p className="doc-side-new">
        <Icon path={GLYPHS.plus} />
        {words.newPage}
      </p>
    </aside>
  );
}

/**
 * Docs use case: a block editor with Emojisense `:` autocomplete (the real @emojisense/tiptap
 * extension on the shared engine) and a searchable page icon. A teammate types the summary
 * until the visitor touches the demo.
 */
export default function DocDemo() {
  const { t, lang, messages } = useDemoI18n();
  const copy = useMemo(() => docCopy(messages.doc), [messages]);
  const { engine, ready } = useEngine();
  const engineRef = useRef<AliasEngine | undefined>(undefined);
  const rootRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | undefined>(undefined);
  const docRef = useRef<DocEditor | undefined>(undefined);
  const autoplay = useRef<Autoplay>({ phase: "waiting", controller: undefined });
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState(false);
  const [failed, setFailed] = useState(false);

  // The editor reads the engine through this ref: English first, then every language.
  useEffect(() => {
    if (engine && (ready === "all" || !engineRef.current)) engineRef.current = engine;
  }, [engine, ready]);

  /** The visitor's first touch ends the autoplay and shows the finished summary. */
  const takeOver = useCallback(() => {
    const state = autoplay.current;
    if (state.phase === "done") return;
    state.phase = "done";
    state.controller?.abort();
    const doc = docRef.current;
    if (doc) runtimeRef.current?.finishScript(doc);
    setTyping(false);
  }, []);
  useAutoplayControl(typing, takeOver);

  useEffect(() => {
    const root = rootRef.current;
    const scroller = scrollerRef.current;
    const host = hostRef.current;
    if (!root || !scroller || !host) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The editor lives as long as the component; the autoplay stops at the first touch.
    const lifetime = new AbortController();
    const playback = new AbortController();
    const signal = AbortSignal.any([lifetime.signal, playback.signal]);
    if (reduced) autoplay.current.phase = "done";
    autoplay.current.controller = playback;
    let doc: DocEditor | undefined;

    (async () => {
      let runtime: Runtime;
      try {
        runtime = await import("./doc/editor");
      } catch {
        if (!lifetime.signal.aborted) setFailed(true);
        return;
      }
      if (lifetime.signal.aborted) return;
      runtimeRef.current = runtime;
      doc = runtime.createDocEditor({
        element: host,
        copy,
        words: messages.doc,
        locale: pageLocale(),
        content: documentHtml(copy, reduced),
        engine: () => engineRef.current,
        semantic: sharedSemantic,
        hint: reduced,
        onMenuPointerDown: takeOver,
      });
      docRef.current = doc;
      setLoaded(true);
      if (autoplay.current.phase === "done") {
        runtime.finishScript(doc);
        return;
      }

      await whenVisible(root, signal);
      // The full engine knows "dumpster fire"; wait for it a little, then settle for English.
      const quiet = <T,>(promise: Promise<T>) => promise.catch(() => undefined);
      const full = await Promise.race([quiet(fullEngine()), quiet(sleep(6000, signal))]);
      const best = full ?? (await quiet(firstEngine()));
      if (!best) {
        takeOver();
        return;
      }
      engineRef.current = best;
      await sleep(500, signal);
      if (autoplay.current.phase !== "waiting") return;
      autoplay.current.phase = "playing";
      setTyping(true);
      await runtime.playScript(doc, scroller, TEAMMATE.name, signal);
      autoplay.current.phase = "done";
      setTyping(false);
    })().catch(() => {
      // Aborted: the visitor took over, or the demo was closed.
    });

    return () => {
      lifetime.abort();
      doc?.destroy();
      docRef.current = undefined;
    };
  }, [takeOver, copy, messages]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onInteract = (event: Event) => {
      if (event.isTrusted) takeOver();
    };
    const events = ["pointerdown", "keydown", "focusin"] as const;
    for (const type of events) root.addEventListener(type, onInteract, true);
    return () => {
      for (const type of events) root.removeEventListener(type, onInteract, true);
    };
  }, [takeOver]);

  return (
    <section ref={rootRef} className="doc" aria-label={t.t("doc.region")}>
      <link rel="stylesheet" href={docCss} precedence="demo" />
      <Sidebar icon={icon} pageTitle={copy.pageTitle} />

      <div className="doc-main">
        <header className="doc-bar">
          <p className="doc-crumbs" aria-hidden="true">
            <span className="doc-crumb-parent">{messages.doc.sidebar.product}</span>
            <span className="doc-crumb-sep">/</span>
            <span className="doc-crumb-parent">{messages.doc.sidebar.retros}</span>
            <span className="doc-crumb-sep">/</span>
            <span className="doc-crumb-current">
              <span className="emoji">{icon}</span>
              {copy.pageTitle}
            </span>
          </p>
          <div className="doc-bar-end">
            <span className="doc-status" aria-live="polite">
              {typing ? t.t("doc.typing", { name: TEAMMATE.name }) : t.t("doc.edited")}
            </span>
            <span className="doc-people" aria-hidden="true">
              <span className="doc-avatar" data-active={typing || undefined} title={TEAMMATE.fullName}>
                {TEAMMATE.initials}
              </span>
              <span className="doc-avatar">JO</span>
            </span>
            <span className="doc-share" aria-hidden="true">
              {t.t("doc.share")}
            </span>
            <span className="doc-more" aria-hidden="true">
              <Icon path={GLYPHS.more} />
            </span>
          </div>
        </header>

        <div ref={scrollerRef} className="doc-scroll">
          <article className="doc-page">
            <IconPicker icon={icon} engine={engine} onPick={setIcon} />
            <h1 className="doc-title">{copy.pageTitle}</h1>
            <dl className="doc-props">
              <div>
                <dt>{t.t("doc.owner")}</dt>
                <dd>
                  <span className="doc-avatar doc-avatar-sm" aria-hidden="true">
                    {TEAMMATE.initials}
                  </span>
                  {TEAMMATE.fullName}
                </dd>
              </div>
              <div>
                <dt>{t.t("doc.date")}</dt>
                <dd>
                  {new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(
                    Date.UTC(2026, 8, 30),
                  )}
                </dd>
              </div>
            </dl>
            {failed && <p className="doc-failed">{t.t("doc.failed")}</p>}
            {!loaded && !failed && (
              <div className="doc-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
            )}
            <div ref={hostRef} className="doc-editor" />
          </article>
        </div>
      </div>
    </section>
  );
}
