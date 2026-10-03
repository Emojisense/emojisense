import { type EmojiSet, userLocales } from "emojisense";

/** `window.emojisenseConfig`, written by Emojisense_Assets::client_config() in PHP. */
export interface ClientConfig {
  /** Pack version directory on this site, e.g. ".../plugins/emojisense/packs/0.1.0". */
  packUrl: string;
  /** Pack locale of the site: "en", "tr", … It ranks first and names the emoji. */
  locale: string;
  /** Culture files (this site, or the API when it is on); "" = no culture layer. */
  cultureUrl: string;
  /** API address; "" unless search by meaning is on. */
  endpoint: string;
  /** Publishable key; may be "" even with an endpoint (anonymous calls). */
  key: string;
  emojiSet: EmojiSet;
  strings?: Record<string, string>;
}

/** Extra values of the block editor script. */
export interface EditorConfig extends ClientConfig {
  autocomplete: boolean;
  reactionPostTypes: string[];
  defaultReactions: string[];
  maxReactions: number;
  suggestions: boolean;
  settingsUrl: string;
  reactionSetMetaKey: string;
}

declare global {
  interface Window {
    emojisenseConfig?: Partial<EditorConfig>;
  }
}

const FALLBACK: ClientConfig = {
  packUrl: "",
  locale: "en",
  cultureUrl: "",
  endpoint: "",
  key: "",
  emojiSet: "native",
};

/** The configuration with safe values for anything missing. */
export function readConfig<T extends ClientConfig = ClientConfig>(
  source: Partial<EditorConfig> | undefined = globalThis.window?.emojisenseConfig,
): T {
  return { ...FALLBACK, ...(source ?? {}) } as T;
}

/**
 * The languages to load and search: the site language, then the languages of this browser that
 * have a pack, and English. A visitor of a Turkish site who reads English gets both, and never a
 * match from a Portuguese alias. `languages`: BCP 47 tags, default `navigator.languages`.
 */
export function searchLocales(config: ClientConfig, languages?: readonly string[]): string[] {
  return [...new Set([config.locale, ...userLocales({ languages })])];
}

/** The attributes of <emojisense-picker> for this configuration. */
export function pickerAttributes(config: ClientConfig, placeholder?: string): Record<string, string> {
  const attributes: Record<string, string> = {
    "pack-url": config.packUrl,
    locale: config.locale,
    locales: searchLocales(config).join(" "),
    "emoji-set": config.endpoint ? config.emojiSet : "native",
  };
  if (config.endpoint) attributes.endpoint = config.endpoint;
  if (config.endpoint && config.key) attributes["publishable-key"] = config.key;
  // The picker loads the file next to pack-url by default: "off" keeps the admin's choice.
  attributes["culture-url"] = config.cultureUrl || "off";
  if (placeholder) attributes.placeholder = placeholder;
  return attributes;
}
