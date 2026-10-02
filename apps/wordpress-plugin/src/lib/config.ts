import type { EmojiSet } from "emojisense";

/** `window.emojisenseConfig`, written by Emojisense_Assets::client_config() in PHP. */
export interface ClientConfig {
  /** Pack version directory on this site, e.g. ".../plugins/emojisense/packs/0.1.0". */
  packUrl: string;
  /** Pack locale: "en", "tr", … */
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

/** The attributes of <emojisense-picker> for this configuration. */
export function pickerAttributes(config: ClientConfig, placeholder?: string): Record<string, string> {
  const attributes: Record<string, string> = {
    "pack-url": config.packUrl,
    locale: config.locale,
    "emoji-set": config.endpoint ? config.emojiSet : "native",
  };
  if (config.endpoint) attributes.endpoint = config.endpoint;
  if (config.endpoint && config.key) attributes["publishable-key"] = config.key;
  if (config.cultureUrl) attributes["culture-url"] = config.cultureUrl;
  if (placeholder) attributes.placeholder = placeholder;
  return attributes;
}
