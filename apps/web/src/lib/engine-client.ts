/**
 * One engine for every live demo on a page. English loads first so the first keystroke is
 * answered at once; the other languages follow when the browser is idle. All islands share the
 * same promises, so the packs are fetched once.
 */
import {
  type AliasEngine,
  createEngine,
  createLayeredSemantic,
  loadPacks,
  type Pack,
  type SemanticProvider,
} from "emojisense";
import { useEffect, useState } from "react";
import { API_URL, PACK_BASE_URL, PUBLISHABLE_KEY } from "../config";

export const DEMO_LOCALES = ["en", "es", "zh", "hi", "ar", "fr", "bn", "pt", "ru", "id", "tr"] as const;

let english: Promise<AliasEngine> | undefined;
let everything: Promise<AliasEngine> | undefined;
let semantic: SemanticProvider | undefined;

const idle = () =>
  new Promise<void>((resolve) =>
    "requestIdleCallback" in globalThis ? requestIdleCallback(() => resolve(), { timeout: 2500 }) : setTimeout(resolve, 1200),
  );

/** English core pack only: small and fast. */
export function englishEngine(): Promise<AliasEngine> {
  english ??= loadPacks({ baseUrl: PACK_BASE_URL, locales: ["en"] }).then((packs) => createEngine(packs));
  return english;
}

/** Every language, core and extension packs. A pack that fails to load is skipped. */
export function fullEngine(): Promise<AliasEngine> {
  everything ??= (async () => {
    await englishEngine();
    await idle();
    const settled = await Promise.allSettled(
      DEMO_LOCALES.flatMap((locale) =>
        (["core", "ext"] as const).map((part) => loadPacks({ baseUrl: PACK_BASE_URL, locales: [locale], part })),
      ),
    );
    const packs = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    // loadPacks always adds English core; keep one copy of each file, core packs first.
    const unique = new Map(packs.map((p) => [`${p.locale}:${p.part ?? "core"}`, p] as const));
    const ordered = [...unique.values()].sort((a, b) => Number(a.part === "ext") - Number(b.part === "ext"));
    return createEngine(ordered as Pack[]);
  })();
  return everything;
}

/** The hosted meaning search (edge cache, then Workers AI), shared by all demos. */
export function sharedSemantic(): SemanticProvider | undefined {
  semantic ??= createLayeredSemantic({ endpoint: API_URL, key: PUBLISHABLE_KEY });
  return semantic;
}

export type EngineState = { engine?: AliasEngine; ready: "loading" | "english" | "all" | "failed" };

/** English at once, then the full multilingual engine when it is ready. */
export function useEngine(): EngineState {
  const [state, setState] = useState<EngineState>({ ready: "loading" });
  useEffect(() => {
    let live = true;
    englishEngine()
      .then((engine) => live && setState((s) => (s.ready === "all" ? s : { engine, ready: "english" })))
      .catch(() => live && setState({ ready: "failed" }));
    fullEngine()
      .then((engine) => live && setState({ engine, ready: "all" }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return state;
}
