import { readFileSync } from "node:fs";
import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  DEFAULT_LIMITS,
  emojiForText,
  searchEmoji,
  suggestReactions,
  type ToolDeps,
  type ToolOutput,
} from "./tools.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

const INSTRUCTIONS =
  "Emoji tools. search_emoji finds emoji for keywords, slang or names (e.g. 'lgtm', 'jurassic park'). " +
  "emoji_for_text picks emoji to add to a sentence the user writes. suggest_reactions picks emoji a " +
  "reader would react with. Results are ranked best first; `match` explains why an emoji matched.";

const suggestionSchema = z.object({
  emoji: z.string(),
  id: z.string().describe("Emojibase hexcode of the base emoji, e.g. 1F680"),
  label: z.string(),
  score: z.number().describe("0–1, comparable within one result list only"),
  source: z
    .enum(["alias", "semantic", "custom", "default"])
    .describe("alias = offline dictionary, semantic = Emojisense API, default = generic filler reaction"),
  match: z.string().optional().describe("The alias phrase that matched"),
  window: z.string().optional().describe("The part of the input text that matched"),
});

const semanticField = z.boolean().describe("True when results from the Emojisense API were merged in");

/** Register the three tools on a new MCP server. Transport-agnostic: the CLI connects stdio. */
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "emojisense", version }, { instructions: INSTRUCTIONS });
  const locales = deps.engine.locales as [string, ...string[]];
  const locale = z
    .enum(locales)
    .optional()
    .describe(`Language of the input and of the labels. Default "${locales[0]}".`);
  const limit = (fallback: number, max: number) =>
    z.number().int().min(1).max(max).optional().describe(`Number of emoji to return. Default ${fallback}.`);
  const annotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: deps.api !== undefined };

  server.registerTool(
    "search_emoji",
    {
      title: "Search emoji",
      description:
        "Find emoji for a short query: a keyword, slang, a name or a concept (e.g. 'ship it', " +
        "'greatest of all time', 'kolay gelsin'). Works offline; misspellings are tolerated.",
      inputSchema: z.object({
        query: z.string().min(1).max(200).describe("What the emoji should mean, in a few words"),
        locale,
        limit: limit(DEFAULT_LIMITS.search, 50),
      }),
      outputSchema: z.object({
        query: z.string().describe("The normalized query"),
        locale: z.string(),
        semantic: semanticField,
        results: z.array(suggestionSchema),
      }),
      annotations,
    },
    async (input) => toCallToolResult(await searchEmoji(deps, input)),
  );

  server.registerTool(
    "emoji_for_text",
    {
      title: "Emoji for text",
      description:
        "Pick the best emoji to add to a sentence or message the user is writing. Returns ranked " +
        "emoji and the text with the best one appended.",
      inputSchema: z.object({
        text: z.string().min(1).max(2000).describe("The sentence or message"),
        locale,
        limit: limit(DEFAULT_LIMITS.forText, 20),
      }),
      outputSchema: z.object({
        suggestion: z.string().describe("The text with the best emoji appended"),
        semantic: semanticField,
        results: z.array(suggestionSchema),
      }),
      annotations,
    },
    async (input) => toCallToolResult(await emojiForText(deps, input)),
  );

  server.registerTool(
    "suggest_reactions",
    {
      title: "Suggest reactions",
      description:
        "Suggest emoji reactions to a message someone else wrote (as on Slack, Discord or GitHub). " +
        "Prefers common reaction emoji such as 🎉, 🙏 or 😂 over topical ones.",
      inputSchema: z.object({
        text: z.string().min(1).max(2000).describe("The message to react to"),
        locale,
        limit: limit(DEFAULT_LIMITS.reactions, 20),
      }),
      outputSchema: z.object({ semantic: semanticField, results: z.array(suggestionSchema) }),
      annotations,
    },
    async (input) => toCallToolResult(await suggestReactions(deps, input)),
  );

  return server;
}

function toCallToolResult<T extends object>({ text, structured }: ToolOutput<T>): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: { ...structured } };
}
