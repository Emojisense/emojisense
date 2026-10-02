/**
 * One engine for every live demo on a page. The first engine is the English core plus the core
 * pack of the page's language (from `<html lang>`), so the first keystroke is answered at once in
 * the visitor's language. The other languages are heavy (all 22 packs are several MB, and indexing
 * them is seconds of main-thread work on a phone), so they load only when something asks: a demo,
 * a visitor who starts typing, or an idle page on a desktop with a fast connection. Every pack file
 * is fetched once and the full engine is built once, shared by all islands.
 */
import {
  type AliasEngine,
  assertPack,
  createEngine,
  createLayeredSemantic,
  type Pack,
  type SemanticProvider,
} from "emojisense";
import { useEffect, useState } from "react";
import { API_URL, PACK_BASE_URL, PUBLISHABLE_KEY } from "../config";

export const DEMO_LOCALES = ["en", "es", "zh", "hi", "ar", "fr", "bn", "pt", "ru", "id", "tr"] as const;

/** The full build is one long task, so it waits until the visitor pauses for this long. */
const QUIET_MS = 800;
const IDLE_TIMEOUT_MS = 5000;

type Part = "core" | "ext";
type FullEngineListener = (engine: Promise<AliasEngine>) => void;

const files = new Map<string, Promise<Pack>>();
const fullEngineListeners = new Set<FullEngineListener>();
let first: Promise<AliasEngine> | undefined;
let everything: Promise<AliasEngine> | undefined;
let semantic: SemanticProvider | undefined;
let idleUpgradeScheduled = false;

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

/** Every language, core and extension packs. A pack that fails to load is skipped. */
export function fullEngine(): Promise<AliasEngine> {
  if (!everything) {
    everything = buildFullEngine();
    for (const listener of fullEngineListeners) listener(everything);
    fullEngineListeners.clear();
  }
  return everything;
}

async function buildFullEngine(): Promise<AliasEngine> {
  await firstEngine();
  // Core packs first: the first pack is the primary one (English core, with shortcodes).
  const wanted = (["core", "ext"] as const).flatMap((part) =>
    DEMO_LOCALES.map((locale) => loadPack(locale, part)),
  );
  const settled = await Promise.allSettled(wanted);
  const packs = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  await quietFor(QUIET_MS);
  await idle(IDLE_TIMEOUT_MS);
  return createEngine(packs);
}

/** Calls `listener` with the full engine's promise as soon as anything starts loading it. */
function whenFullEngineStarts(listener: FullEngineListener): () => void {
  if (everything) {
    listener(everything);
    return () => {};
  }
  fullEngineListeners.add(listener);
  return () => fullEngineListeners.delete(listener);
}

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * Starts the full engine after the page has loaded and gone idle, on desktop-class devices with a
 * fast, unmetered network. Phones index the packs for seconds, so there they wait to be asked.
 */
function loadFullEngineWhenIdle(): void {
  if (idleUpgradeScheduled) return;
  idleUpgradeScheduled = true;
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection?.saveData || /2g|3g/.test(connection?.effectiveType ?? "")) return;
  if (!matchMedia("(pointer: fine)").matches) return;
  const start = () => {
    idle(IDLE_TIMEOUT_MS)
      .then(() => fullEngine())
      .catch(() => {});
  };
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
}

/** The hosted meaning search (edge cache, then Workers AI), shared by all demos. */
export function sharedSemantic(): SemanticProvider | undefined {
  semantic ??= createLayeredSemantic({ endpoint: API_URL, key: PUBLISHABLE_KEY });
  return semantic;
}

/** "english" is the first engine: English, plus the page's language on a translated page. */
export type EngineState = { engine?: AliasEngine; ready: "loading" | "english" | "all" | "failed" };

export interface UseEngineOptions {
  /**
   * When to load every language. "now" (default) starts at once. "idle" waits for a page that has
   * loaded and gone idle, or for any other island (or `fullEngine()`) to ask for it first.
   */
  upgrade?: "now" | "idle";
}

/** The first engine at once, then the full multilingual engine when it is ready. */
export function useEngine({ upgrade = "now" }: UseEngineOptions = {}): EngineState {
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
    if (upgrade === "now") onFullEngine(fullEngine());
    else {
      unsubscribe = whenFullEngineStarts(onFullEngine);
      loadFullEngineWhenIdle();
    }
    return () => {
      live = false;
      unsubscribe();
    };
  }, [upgrade]);
  return state;
}
