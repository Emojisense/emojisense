/**
 * The tools on the integration stage. Each one plays its query against the real engine and picks
 * `target`; test/claims.test.ts checks that the dictionary ranks it near the top, so a data change
 * cannot make a demo pick something else.
 */
import type { AliasEngine } from "emojisense";
import type { IntegrationKey } from "../../lib/integrations";
import type { LogoName } from "../../lib/logos";

export type ColonSkinId = "tiptap" | "ckeditor5" | "tinymce" | "discourse" | "wordpress";
export type SkinId = "react" | ColonSkinId | "chrome" | "raycast" | "mcp";

/**
 * How the tool asks for emoji: the React picker, a ":" in the text, a picker on a shortcut, a
 * launcher's search field, or an AI assistant's tool call.
 */
export type SkinKind = "frimousse" | "colon" | "picker" | "launcher" | "assistant";

export interface Skin {
  id: SkinId;
  key: IntegrationKey;
  logo: LogoName;
  kind: SkinKind;
  /** English, like the shortcodes: English is always searched. */
  query: string;
  /** Emojibase id the autoplay picks. */
  target: string;
  /** The same emoji, for the finished state before the engine loads. */
  emoji: string;
}

export const SKINS: readonly Skin[] = [
  {
    id: "react",
    key: "react",
    logo: "react",
    kind: "frimousse",
    query: "greatest of all time",
    target: "1F410",
    emoji: "🐐",
  },
  {
    id: "tiptap",
    key: "tiptap",
    logo: "tiptap",
    kind: "colon",
    query: "ship it",
    target: "1F680",
    emoji: "🚀",
  },
  {
    id: "ckeditor5",
    key: "ckeditor5",
    logo: "ckeditor",
    kind: "colon",
    query: "pizza",
    target: "1F355",
    emoji: "🍕",
  },
  {
    id: "tinymce",
    key: "tinymce",
    logo: "tinymce",
    kind: "colon",
    query: "party",
    target: "1F389",
    emoji: "🎉",
  },
  {
    id: "discourse",
    key: "discourse",
    logo: "discourse",
    kind: "colon",
    query: "mind blown",
    target: "1F92F",
    emoji: "🤯",
  },
  {
    id: "wordpress",
    key: "wordpress",
    logo: "wordpress",
    kind: "colon",
    query: "thank you",
    target: "1F64F",
    emoji: "🙏",
  },
  {
    id: "chrome",
    key: "chrome",
    logo: "chrome",
    kind: "picker",
    query: "on my way",
    target: "1F51C",
    emoji: "🔜",
  },
  {
    id: "raycast",
    key: "raycast",
    logo: "raycast",
    kind: "launcher",
    query: "celebrate",
    target: "1F973",
    emoji: "🥳",
  },
  {
    id: "mcp",
    key: "mcp",
    logo: "mcp",
    kind: "assistant",
    query: "launch day",
    target: "1F680",
    emoji: "🚀",
  },
];

export interface SkinProps {
  skin: Skin;
  engine: AliasEngine | undefined;
  /** The stage is on screen: the autoplay may start. */
  visible: boolean;
}
