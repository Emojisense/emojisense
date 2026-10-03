/**
 * The scripted side of the demo. The prompts, the tool arguments and the wording are fixed; every
 * emoji, label and match in a reply is read from the live tool result, so the text follows the
 * engine. Queries were chosen by running the real handlers on the real packs (all 11 locales,
 * core + ext, the same files `pnpm --filter @emojisense/mcp build` bundles) and the API. The words
 * around the results are in the page's language (demos.assistant.scenarios); the tool calls stay
 * as they are.
 */
import type { DemoMessages } from "../../i18n/demos";
import type { Translator } from "../../i18n/translate";
import type { EmojiSuggestion, ToolCall, ToolRun } from "./mcp";

export interface ReplyBlock {
  kind: "p" | "quote";
  text: string;
}

export interface Scenario {
  id: string;
  /** The chip label and the user's message. */
  prompt: string;
  /** What the assistant sends to the MCP server. */
  call: ToolCall;
  /** The assistant's answer, written around the live results. */
  reply: (run: ToolRun) => ReplyBlock[];
}

const p = (text: string): ReplyBlock => ({ kind: "p", text: tidy(text) });
const quote = (text: string): ReplyBlock => ({ kind: "quote", text: tidy(text) });

/** Drop the gaps an empty result leaves behind ("go dark ." → "go dark."). */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+([.,!?:،。])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

const results = (run: ToolRun): EmojiSuggestion[] => run.structured.results;
const glyph = (result: EmojiSuggestion | undefined) => result?.emoji ?? "";
/** Why a result matched: the matched words of the input, else the alias phrase. */
const reason = (result: EmojiSuggestion | undefined) => result?.window ?? result?.match;

/**
 * No alias covers this sentence: offline, `search_emoji` returns nothing; with an API key, meaning
 * search answers 💻 😵 🪫. The status text stays English: it is what the user posts.
 */
export const STATUS_QUERY = { query: "laptop died mid demo", target: "1F4BB" } as const;
const STATUS_TEXT = "Laptop died mid demo. Presenting from my phone.";
/** The message the reaction scenario sends to the tool (it stays English: it is the tool's input). */
const REACT_TEXT = "10k users. We did it!";

export function scenarios(t: Translator<DemoMessages>): Scenario[] {
  const s = (key: Parameters<typeof t.t>[0], vars?: Record<string, string>) => t.t(key, vars);
  return [
    {
      id: "tweet",
      prompt: s("assistant.scenarios.tweet.prompt"),
      call: { name: "search_emoji", args: { query: "dark mode", limit: 6 } },
      reply(run) {
        const [first, , third, fourth] = results(run);
        const lead = third ?? first;
        const close = lead === first ? undefined : first;
        return [
          p(s("assistant.scenarios.tweet.intro")),
          quote(s("assistant.scenarios.tweet.quote", { lead: glyph(lead), close: glyph(close) })),
          ...(fourth && lead
            ? [p(s("assistant.scenarios.tweet.moodier", { from: lead.emoji, to: fourth.emoji }))]
            : []),
        ];
      },
    },
    {
      id: "birthday",
      prompt: s("assistant.scenarios.birthday.prompt"),
      call: { name: "search_emoji", args: { query: "happy birthday", locale: "es", limit: 6 } },
      reply(run) {
        const [first, second, , , fifth] = results(run);
        const cake = second ?? first;
        return [
          p(s("assistant.scenarios.birthday.intro")),
          // The message itself is the Spanish the user asked for, on every page.
          quote(
            `¡Feliz cumpleaños, Ana! ${glyph(cake)}\nQue este año te traiga muchas risas, buenos planes y alguna que otra sorpresa ${glyph(fifth)}. ¡A celebrarlo a lo grande! ${glyph(cake === first ? undefined : first)}`,
          ),
          ...(cake
            ? [p(s("assistant.scenarios.birthday.labels", { emoji: cake.emoji, label: cake.label }))]
            : []),
        ];
      },
    },
    {
      id: "react",
      prompt: s("assistant.scenarios.react.prompt"),
      call: { name: "suggest_reactions", args: { text: REACT_TEXT } },
      reply(run) {
        const list = results(run);
        const [first, second, third] = list;
        if (!first) return [p(s("assistant.scenarios.react.none"))];
        const why = reason(first);
        // A runner for "10k" is a fun miss worth naming, unless it made the recommended set.
        const race = list.slice(3).find((r) => r.match === "10k");
        return [
          p(
            first.source === "default" || !why
              ? s("assistant.scenarios.react.safe", { emoji: first.emoji })
              : s("assistant.scenarios.react.matched", { emoji: first.emoji, why }),
          ),
          ...(second && third
            ? [p(s("assistant.scenarios.react.alsoWork", { second: second.emoji, third: third.emoji }))]
            : []),
          ...(race ? [p(s("assistant.scenarios.react.skip", { emoji: race.emoji }))] : []),
        ];
      },
    },
    {
      id: "status",
      prompt: s("assistant.scenarios.status.prompt"),
      call: { name: "search_emoji", args: { query: STATUS_QUERY.query, limit: 6 } },
      reply(run) {
        const [first, second] = results(run);
        if (!first) return [p(s("assistant.scenarios.status.offline"))];
        const why = reason(first);
        return [
          p(s("assistant.scenarios.status.intro")),
          quote(`${first.emoji} ${STATUS_TEXT}`),
          p(
            first.source === "semantic" || !why
              ? s("assistant.scenarios.status.byMeaning", { emoji: first.emoji })
              : s("assistant.scenarios.status.matched", { emoji: first.emoji, why }),
          ),
          ...(second ? [p(s("assistant.scenarios.status.runnerUp", { emoji: second.emoji }))] : []),
        ];
      },
    },
  ];
}
