/**
 * The real tool handlers of the Emojisense MCP server (packages/mcp/src/tools.ts). They depend on
 * the alias engine only, so the browser runs the same code an MCP client reaches over stdio. No
 * API client is passed: this is the server's offline mode, the default install.
 */
import type { AliasEngine } from "emojisense";
import type { EmojiSuggestion } from "../../../../../packages/mcp/src/suggestion";
import {
  emojiForText,
  type SearchEmojiInput,
  searchEmoji,
  suggestReactions,
  type TextInput,
} from "../../../../../packages/mcp/src/tools";

export type { EmojiSuggestion };

/** The server's key in a client config (`mcpServers.emojisense`). */
export const SERVER_NAME = "emojisense";

export type ToolCall =
  | { name: "search_emoji"; args: SearchEmojiInput }
  | { name: "emoji_for_text"; args: TextInput }
  | { name: "suggest_reactions"; args: TextInput };

export type ToolName = ToolCall["name"];

/** The tools the server registers, in its order (packages/mcp/src/server.ts). */
export const TOOLS: { name: ToolName; summary: string }[] = [
  { name: "search_emoji", summary: "Keywords, slang, names, films" },
  { name: "emoji_for_text", summary: "Emoji for a sentence you write" },
  { name: "suggest_reactions", summary: "What a reader reacts with" },
];

export interface ToolRun {
  /** `content[0].text` of the MCP result: what the model reads. */
  text: string;
  /** `structuredContent` of the MCP result. */
  structured: { results: EmojiSuggestion[]; suggestion?: string } & Record<string, unknown>;
  /** Wall time of the handler in this browser. */
  ms: number;
}

/** Call one tool handler, as the MCP server does for `tools/call`. */
export async function runTool(engine: AliasEngine, call: ToolCall): Promise<ToolRun> {
  const deps = { engine };
  const started = performance.now();
  const output =
    call.name === "search_emoji"
      ? await searchEmoji(deps, call.args)
      : call.name === "emoji_for_text"
        ? await emojiForText(deps, call.args)
        : await suggestReactions(deps, call.args);
  return { text: output.text, structured: output.structured, ms: performance.now() - started };
}
