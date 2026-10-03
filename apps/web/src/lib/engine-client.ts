/**
 * One engine for every live demo on a page. The first engine is the English core plus the core
 * pack of the page's language (from `<html lang>`), so the first keystroke is answered at once in
 * the visitor's language. The full engine adds the visitor's other languages (the browser's) and
 * the extension packs, and loads only when something asks: a demo, a visitor who starts typing, or
 * an idle page on a desktop with a fast connection. Every language (22 packs, several MB, seconds
 * of indexing on a phone) loads only for the showcases that need it: the playground and the
 * assistant demo. Every pack file is fetched once and each engine is built once, shared by all
 * islands. Searches match the visitor's languages only (`visitorLocales`), whatever is loaded.
 */
import {
  type AliasEngine,
  assertPack,
  createEngine,
  createLayeredSemantic,
  type Pack,
  type SemanticProvider,
  userLocales,
} from "emojisense";
import { createStatsReporter, type StatsReporter } from "emojisense/stats";
import { useEffect, useState } from "react";
import { API_URL, PACK_BASE_URL, PUBLISHABLE_KEY, SHARDS_URL, STATS_SAMPLE, STATS_URL } from "../config";

export const DEMO_LOCALES = ["en", "es", "zh", "hi", "ar", "fr", "bn", "pt", "ru", "id", "tr"] as const;

/** The full build is one long task, so it waits until the visitor pauses for this long. */
const QUIET_MS = 800;
const IDLE_TIMEOUT_MS = 5000;

type Part = "core" | "ext";
/** "visitor": the visitor's languages (`fullEngine`). "all": every language (`showcaseEngine`). */
export type EngineScope = "visitor" | "all";
type FullEngineListener = (engine: Promise<AliasEngine>) => void;

const files = new Map<string, Promise<Pack>>();
const fullEngineListeners: Record<EngineScope, Set<FullEngineListener>> = {
  visitor: new Set(),
  all: new Set(),
};
const fullEngines: Partial<Record<EngineScope, Promise<AliasEngine>>> = {};
/** Languages an island shows besides the visitor's (the hero's examples): their core packs join the full engine. */
const requested = new Set<DemoLocale>();
let first: Promise<AliasEngine> | undefined;
let visitor: DemoLocale[] | undefined;
let semantic: SemanticProvider | undefined;
const idleUpgradeScheduled = new Set<EngineScope>();

export function packUrl(locale: string, part: Part = "core"): string {
  return `${PACK_BASE_URL}/pack.${locale}${part === "ext" ? ".ext" : ""}.json`;
}

/**
 * One pack file, fetched and validated once per page. `loadPacks` always adds English, so calling
 * it per locale would download English again for every other file.
 */
function loadPack(locale: string, part: Part): Promise<Pack> {
  const url = packUrl(locale, part);
  let request = files.get(url);
  if (!request) {
    request = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`emojisense: ${url} answered ${response.status}`);
      const pack: unknown = await response.json();
      assertPack(pack);
      return pack;
    });
    files.set(url, request);
  }
  return request;
}

const idle = (timeout: number) =>
  new Promise<void>((resolve) =>
    "requestIdleCallback" in globalThis
      ? requestIdleCallback(() => resolve(), { timeout })
      : setTimeout(resolve, 1200),
  );

/** Resolves once nobody has typed, clicked or touched the page for `ms`. */
function quietFor(ms: number): Promise<void> {
  const events = ["keydown", "pointerdown", "input"] as const;
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      for (const type of events) removeEventListener(type, restart, true);
      resolve();
    };
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(done, ms);
    };
    for (const type of events) addEventListener(type, restart, { capture: true, passive: true });
    restart();
  });
}

export type DemoLocale = (typeof DEMO_LOCALES)[number];

/** The engine locale of the page: `<html lang="zh-Hans">` → "zh". English when unknown. */
export function pageLocale(): DemoLocale {
  const tag = globalThis.document?.documentElement.lang ?? "";
  const language = tag.split("-")[0]?.toLowerCase() ?? "";
  return DEMO_LOCALES.find((locale) => locale === language) ?? "en";
}

/** A result's label in the page's language, else English. */
export function labelOf(
  engine: AliasEngine | undefined,
  id: string,
  locale: string = pageLocale(),
): string | undefined {
  const labels = engine?.get(id)?.labels;
  return labels?.[locale] ?? labels?.en;
}

/**
 * The visitor's languages that have a pack: the page's first, then the browser's, always English.
 * Search only these: a visitor of English and Turkish never gets a Portuguese alias's match.
 */
export function visitorLocales(): DemoLocale[] {
  visitor ??= userLocales({
    languages: [globalThis.document?.documentElement.lang ?? "", ...(globalThis.navigator?.languages ?? [])],
    supported: DEMO_LOCALES,
  }) as DemoLocale[];
  return visitor;
}

/**
 * Adds the core packs of `locales` to the full engine, for an island that shows searches in them
 * (the hero's examples). Ask on mount: the full engine reads the list when it starts loading.
 */
export function requestLanguages(locales: readonly string[]): void {
  for (const locale of locales) {
    const known = DEMO_LOCALES.find((demo) => demo === locale);
    if (known) requested.add(known);
  }
}

/** English core plus the page language's core pack: small, fast, and in the visitor's language. */
export function firstEngine(): Promise<AliasEngine> {
  if (!first) {
    const locale = pageLocale();
    // English is the primary pack (it carries the shortcodes), so it comes first.
    const wanted =
      locale === "en" ? [loadPack("en", "core")] : [loadPack("en", "core"), loadPack(locale, "core")];
    first = Promise.all(wanted).then((packs) => createEngine(packs));
  }
  return first;
}

/**
 * The visitor's languages, core and extension packs, plus the core packs of the languages islands
 * requested (`requestLanguages`). A pack that fails to load is skipped.
 */
export function fullEngine(): Promise<AliasEngine> {
  return startEngine("visitor");
}

/** Every language, core and extension packs: for the showcases (the playground, the assistant demo). */
export function showcaseEngine(): Promise<AliasEngine> {
  return startEngine("all");
}

function startEngine(scope: EngineScope): Promise<AliasEngine> {
  let engine = fullEngines[scope];
  if (!engine) {
    engine = buildEngine(scope);
    fullEngines[scope] = engine;
    for (const listener of fullEngineListeners[scope]) listener(engine);
    fullEngineListeners[scope].clear();
  }
  return engine;
}

async function buildEngine(scope: EngineScope): Promise<AliasEngine> {
  await firstEngine();
  const extended = scope === "all" ? [...DEMO_LOCALES] : visitorLocales();
  const core = [...new Set([...extended, ...requested])];
  // Core packs first, English first: the first pack is the primary one (with shortcodes).
  const ordered = (locales: readonly DemoLocale[]) => ["en", ...locales.filter((locale) => locale !== "en")];
  const wanted = [
    ...ordered(core).map((locale) => loadPack(locale, "core")),
    ...ordered(extended).map((locale) => loadPack(locale, "ext")),
  ];
  const settled = await Promise.allSettled(wanted);
  const packs = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  await quietFor(QUIET_MS);
  await idle(IDLE_TIMEOUT_MS);
  return createEngine(packs);
}

/** Calls `listener` with the full engine's promise as soon as anything starts loading it. */
function whenFullEngineStarts(scope: EngineScope, listener: FullEngineListener): () => void {
  const engine = fullEngines[scope];
  if (engine) {
    listener(engine);
    return () => {};
  }
  fullEngineListeners[scope].add(listener);
  return () => fullEngineListeners[scope].delete(listener);
}

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * Starts the full engine after the page has loaded and gone idle, on desktop-class devices with a
 * fast, unmetered network. Phones index the packs for seconds, so there they wait to be asked.
 */
function loadFullEngineWhenIdle(scope: EngineScope): void {
  if (idleUpgradeScheduled.has(scope)) return;
  idleUpgradeScheduled.add(scope);
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection?.saveData || /2g|3g/.test(connection?.effectiveType ?? "")) return;
  if (!matchMedia("(pointer: fine)").matches) return;
  const start = () => {
    idle(IDLE_TIMEOUT_MS)
      .then(() => startEngine(scope))
      .catch(() => {});
  };
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
}

/** The hosted meaning search (shards, then the API's edge cache and Workers AI), shared by all demos. */
export function sharedSemantic(): SemanticProvider | undefined {
  semantic ??= createLayeredSemantic({ shardsUrl: SHARDS_URL, endpoint: API_URL, key: PUBLISHABLE_KEY });
  return semantic;
}

let stats: StatsReporter | undefined;

/** Reports how the visitors' own searches end (STATS_URL), shared by all demos. */
export function sharedStats(): StatsReporter | undefined {
  if (!STATS_URL) return undefined;
  stats ??= createStatsReporter({
    endpoint: STATS_URL,
    key: PUBLISHABLE_KEY,
    sampleRate: STATS_SAMPLE,
    locale: pageLocale(),
  });
  return stats;
}

/** "english" is the first engine: English, plus the page's language on a translated page. */
export type EngineState = { engine?: AliasEngine; ready: "loading" | "english" | "all" | "failed" };

export interface UseEngineOptions {
  /**
   * When to load the full engine. "now" (default) starts at once. "idle" waits for a page that has
   * loaded and gone idle, or for any other island (or `fullEngine()`) to ask for it first.
   */
  upgrade?: "now" | "idle";
  /** "visitor" (default): the visitor's languages. "all": every language, for the showcases. */
  scope?: EngineScope;
}

/** The first engine at once, then the full engine when it is ready. */
export function useEngine({ upgrade = "now", scope = "visitor" }: UseEngineOptions = {}): EngineState {
  const [state, setState] = useState<EngineState>({ ready: "loading" });
  useEffect(() => {
    let live = true;
    firstEngine()
      .then((engine) => live && setState((s) => (s.ready === "all" ? s : { engine, ready: "english" })))
      .catch(() => live && setState((s) => (s.ready === "all" ? s : { ready: "failed" })));
    const onFullEngine: FullEngineListener = (full) => {
      full.then((engine) => live && setState({ engine, ready: "all" })).catch(() => {});
    };
    let unsubscribe = () => {};
    if (upgrade === "now") onFullEngine(startEngine(scope));
    else {
      unsubscribe = whenFullEngineStarts(scope, onFullEngine);
      loadFullEngineWhenIdle(scope);
    }
    return () => {
      live = false;
      unsubscribe();
    };
  }, [upgrade, scope]);
  return state;
}
