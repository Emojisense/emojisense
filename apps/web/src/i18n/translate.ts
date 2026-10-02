/**
 * Message lookup for the site and its islands. A catalog is nested JSON; keys are dotted paths
 * ("nav.pricing"). A string may hold `{name}` placeholders and simple `<tag>…</tag>` pairs that the
 * caller maps to markup. A plural message is an object of Intl.PluralRules categories
 * ({ "one": "…", "other": "…" }); every language lists the categories it needs.
 *
 * This file is shared by Astro and the React islands, so it never imports a catalog.
 */

export type PluralMessage = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;

export type MessageValue = string | PluralMessage | { [key: string]: MessageValue };
export type Catalog = { [key: string]: MessageValue };

/** Dotted paths of every message (a string or a plural object) in a catalog type. */
export type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends { other: string }
      ? K
      : T[K] extends object
        ? `${K}.${MessageKey<T[K]>}`
        : never;
}[keyof T & string];

/** Dotted paths of the plural messages only. */
export type PluralKey<T> = {
  [K in keyof T & string]: T[K] extends string
    ? never
    : T[K] extends { other: string }
      ? K
      : T[K] extends object
        ? `${K}.${PluralKey<T[K]>}`
        : never;
}[keyof T & string];

/** The value at a dotted path, e.g. a namespace handed to an island. */
export type At<T, P extends string> = P extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? At<T[Head], Tail>
    : never
  : P extends keyof T
    ? T[P]
    : never;

export type Vars = Record<string, string | number>;

export const PLACEHOLDER = /\{(\w+)\}/g;
export const TAG = /<(\w+)>([\s\S]*?)<\/\1>/g;

export function isPlural(value: unknown): value is PluralMessage {
  return typeof value === "object" && value !== null && typeof (value as PluralMessage).other === "string";
}

export function lookup(catalog: Catalog, key: string): MessageValue | undefined {
  let node: MessageValue | undefined = catalog;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || isPlural(node)) return undefined;
    node = (node as Catalog)[part];
  }
  return node;
}

export function interpolate(
  text: string,
  vars: Vars = {},
  escapeValue: (value: string) => string = String,
): string {
  return text.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`i18n: no value for {${name}} in "${text}"`);
    return escapeValue(String(value));
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export type TagRenderer = (inner: string) => string;

export interface Translator<T> {
  locale: string;
  /** A message with its placeholders filled in. */
  t(key: MessageKey<T>, vars?: Vars): string;
  /** A plural message for `count`; `{count}` is filled in with the locale's digits. */
  plural(key: PluralKey<T>, count: number, vars?: Vars): string;
  /**
   * Trusted HTML for `set:html`: the text and the values are escaped, and each `<tag>…</tag>`
   * pair is rendered by `tags[tag]`. A tag without a renderer is an error.
   */
  html(key: MessageKey<T>, vars?: Vars, tags?: Record<string, TagRenderer>): string;
  /**
   * The message as text and `<tag>` parts, placeholders filled in. A template renders each tag
   * itself, so scoped styles still reach the elements (they would not reach `set:html` output).
   */
  parts(key: MessageKey<T>, vars?: Vars): MessagePart[];
  /** The raw message, for a caller that splits it itself (React rich text). */
  raw(key: MessageKey<T>): string;
}

export type MessagePart = { text: string; tag?: undefined } | { tag: string; text: string };

export function createTranslator<T extends Catalog>(catalog: T, locale: string): Translator<T> {
  const rules = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);

  const text = (key: string): string => {
    const value = lookup(catalog, key);
    if (typeof value !== "string") throw new Error(`i18n: "${key}" is not a message in ${locale}`);
    return value;
  };

  return {
    locale,
    t: (key, vars) => interpolate(text(key), vars),
    plural(key, count, vars = {}) {
      const value = lookup(catalog, key);
      if (!isPlural(value)) throw new Error(`i18n: "${key}" is not a plural message in ${locale}`);
      const form = value[rules.select(count)] ?? value.other;
      return interpolate(form, { count: numbers.format(count), ...vars });
    },
    html(key, vars, tags = {}) {
      const escaped = interpolate(escapeHtml(text(key)), vars, escapeHtml);
      return renderTags(escaped, tags, key);
    },
    parts: (key, vars) =>
      splitTags(text(key)).map((part) => ({ ...part, text: interpolate(part.text, vars) })),
    raw: (key) => text(key),
  };
}

/** Replaces `<tag>inner</tag>` pairs with `render(inner)`. Unknown tags are an error. */
export function renderTags(text: string, tags: Record<string, TagRenderer>, key = ""): string {
  // The text was escaped, so the tags arrive as &#60;tag&#62;.
  return text.replace(/&#60;(\w+)&#62;([\s\S]*?)&#60;\/\1&#62;/g, (_whole, name: string, inner: string) => {
    const render = tags[name];
    if (!render) throw new Error(`i18n: no renderer for <${name}> in "${key}"`);
    return render(inner);
  });
}

/** `<a href>` renderer for html(). */
export function linkTag(href: string, attributes = ""): TagRenderer {
  return (inner) => `<a href="${escapeHtml(href)}"${attributes ? ` ${attributes}` : ""}>${inner}</a>`;
}

/** Wraps the text in an element without attributes, e.g. `strong` or `code`. */
export function wrapTag(element: string, className?: string): TagRenderer {
  return (inner) => `<${element}${className ? ` class="${className}"` : ""}>${inner}</${element}>`;
}

/** Splits a message into text and `<tag>` parts, for renderers that build nodes (React). */
export function splitTags(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  for (const match of text.matchAll(TAG)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ tag: match[1] ?? "", text: match[2] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
