/**
 * The part of the Discourse theme component that is plain TypeScript: built into one ES module
 * (javascripts/discourse/lib/emojisense.js) that the theme's initializer imports.
 */
import type { AliasEngine } from "emojisense";
import {
  createApiSemantic,
  createEngineLoader,
  createSuggestionSource,
  type SuggestionSource,
} from "emojisense/autocomplete";
import { customEmojiPack, type DiscourseCustomEmoji } from "./custom.js";
import { type DiscourseEmojiData, toDiscourseCodes } from "./shortcodes.js";

export { customEmojiPack, type DiscourseCustomEmoji } from "./custom.js";
export { type DiscourseEmojiData, mergeCodes, toDiscourseCodes } from "./shortcodes.js";
export { findEmojiQuery } from "./trigger.js";

/** The pack locales the theme ships. */
export const LOCALES = ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id", "tr"] as const;

/** The base the loader builds file URLs on; `files` maps each file name to its real URL. */
const FILE_BASE = "emojisense://files";

export interface EmojisenseDiscourseOptions {
  /** Data files by name ("pack.en.json", "pack.en.ext.json", "culture.en.json") → URL. */
  files: Readonly<Record<string, string>>;
  locale: string;
  /** Load the culture file of the locale. Default true. */
  culture?: boolean;
  /** The Emojisense API, for search by meaning when the dictionary is unsure. Off without it. */
  endpoint?: string;
  /** Publishable key (`pk_…`). */
  publishableKey?: string;
  customEmoji?: readonly DiscourseCustomEmoji[];
  data: DiscourseEmojiData;
  fetch?: typeof fetch;
  whenIdle?: (task: () => void) => void;
}

export interface SearchOptions {
  /** The user's skin tone, 1 to 6. */
  diversity?: number;
  denied?: readonly string[];
  limit: number;
  /** The autocomplete and the picker search at the same time without cancelling each other. */
  use: "autocomplete" | "picker";
}

export interface EmojisenseDiscourse {
  /** Starts loading the packs, once. */
  load(): void;
  isReady(): boolean;
  /** Discourse emoji names for a query, best first; `undefined` while the packs load. */
  search(term: string, options: SearchOptions): Promise<string[] | undefined>;
}

/** The Emojisense locale for a Discourse locale ("pt_BR" → "pt"); English for the others. */
export function packLocale(discourseLocale: string): string {
  const language = discourseLocale.split(/[-_]/)[0]?.toLowerCase() ?? "";
  return (LOCALES as readonly string[]).includes(language) ? language : "en";
}

export function createEmojisense(options: EmojisenseDiscourseOptions): EmojisenseDiscourse {
  const { files, locale, data } = options;
  const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  // Theme assets have their own URLs: map the file names the loader asks for to them.
  const fileFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const file = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
    const real = url.startsWith(FILE_BASE) ? files[file] : url;
    return real ? baseFetch(real, init) : Promise.resolve(new Response("", { status: 404 }));
  }) as typeof fetch;
  const custom = customEmojiPack(options.customEmoji ?? []);
  const loader = createEngineLoader({
    packUrl: FILE_BASE,
    locale,
    cultureUrl: options.culture === false ? undefined : FILE_BASE,
    extraPacks: custom ? [custom] : [],
    fetch: fileFetch,
    ...(options.whenIdle ? { whenIdle: options.whenIdle } : {}),
  });

  const sources = new Map<SearchOptions["use"], SuggestionSource>();
  let engine: AliasEngine | undefined;
  loader.subscribe((next) => {
    engine = next;
    for (const source of sources.values()) source.dispose();
    sources.clear();
  });
  const sourceFor = (use: SearchOptions["use"], current: AliasEngine) => {
    let source = sources.get(use);
    if (!source) {
      source = createSuggestionSource({
        engine: current,
        semantic: createApiSemantic({
          endpoint: options.endpoint,
          key: options.publishableKey,
          packVersion: current.packVersion,
        }),
        locale,
        limit: use === "picker" ? 48 : 12,
        region: "device",
      });
      sources.set(use, source);
    }
    return source;
  };

  return {
    load() {
      loader.load().catch(() => {
        // Without packs, Discourse's own emoji search stays in charge.
      });
    },
    isReady: () => engine !== undefined,
    async search(term, { diversity, denied, limit, use }) {
      if (!engine) return undefined;
      const suggestions = await sourceFor(use, engine).resolve(term);
      return toDiscourseCodes(suggestions, {
        data,
        limit,
        ...(diversity !== undefined ? { diversity } : {}),
        ...(denied ? { denied } : {}),
      });
    },
  };
}
