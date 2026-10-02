/**
 * Translations inside React islands. An island gets its own part of the catalog as a prop (never
 * the whole catalog) and the page's Intl tag, and builds a translator from them.
 */
import { createContext, Fragment, type ReactNode, useContext, useMemo } from "react";
import {
  type Catalog,
  createTranslator,
  interpolate,
  splitTags,
  type Translator,
  type Vars,
} from "./translate";

export function useTranslator<T extends Catalog>(messages: T, lang: string): Translator<T> {
  return useMemo(() => createTranslator(messages, lang), [messages, lang]);
}

/**
 * A message with `<tag>…</tag>` parts rendered as React nodes:
 * `rich(t.raw("hero.matched"), { q: (text) => <q>{text}</q> }, { match })`.
 */
export function rich(
  message: string,
  tags: Record<string, (children: ReactNode) => ReactNode>,
  vars?: Vars,
): ReactNode {
  // The parts of one message never reorder, so their position is a stable key.
  let offset = 0;
  return splitTags(message).map((part) => {
    const key = `${part.tag ?? "text"}-${offset}`;
    offset += part.text.length + 1;
    const text = vars ? interpolate(part.text, vars) : part.text;
    if (part.tag === undefined) return <Fragment key={key}>{text}</Fragment>;
    const render = tags[part.tag];
    if (!render) throw new Error(`i18n: no renderer for <${part.tag}>`);
    return <Fragment key={key}>{render(text)}</Fragment>;
  });
}

/**
 * +1 for the arrow key that points forward in the reading direction, -1 for the one that points
 * back, 0 for any other key. In a right-to-left page the left arrow moves forward.
 */
export function horizontalStep(event: { key: string; currentTarget: Element }): 1 | -1 | 0 {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return 0;
  const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  return event.key === forward ? 1 : -1;
}

export interface IslandI18n<T extends Catalog> {
  t: Translator<T>;
  /** Intl tag of the page ("zh-Hans"). */
  lang: string;
}

/** For islands that render many components (the demos): a provider and a hook. */
export function createI18nContext<T extends Catalog>() {
  const Context = createContext<IslandI18n<T> | null>(null);
  function Provider({ messages, lang, children }: { messages: T; lang: string; children: ReactNode }) {
    const t = useTranslator(messages, lang);
    const value = useMemo(() => ({ t, lang }), [t, lang]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }
  function useI18n(): IslandI18n<T> {
    const value = useContext(Context);
    if (!value) throw new Error("i18n: a demo rendered outside its I18n provider");
    return value;
  }
  return { Provider, useI18n };
}
