/**
 * The scripted side of the demo. The prompts, the tool arguments and the wording are fixed; every
 * emoji, label and match in a reply is read from the live tool result, so the text follows the
 * engine. Queries were chosen by running the real handlers on the real packs (all 11 locales,
 * core + ext, the same files `pnpm --filter @emojisense/mcp build` bundles).
 */
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
    .replace(/[ \t]+([.,!?:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

const results = (run: ToolRun): EmojiSuggestion[] => run.structured.results;
const glyph = (result: EmojiSuggestion | undefined) => result?.emoji ?? "";
/** Why a result matched: the matched words of the input, else the alias phrase. */
const reason = (result: EmojiSuggestion | undefined) => result?.window ?? result?.match;

export const SCENARIOS: Scenario[] = [
  {
    id: "tweet",
    prompt: "Write a launch tweet for our dark mode",
    call: { name: "search_emoji", args: { query: "dark mode", limit: 6 } },
    reply(run) {
      const [first, , third, fourth] = results(run);
      const lead = third ?? first;
      const close = lead === first ? undefined : first;
      return [
        p("Here's a draft, with emoji from the search:"),
        quote(
          `Dark mode is here ${glyph(lead)}\nEasier on the eyes after sunset, kinder to your battery, and it follows your system setting. Update and go dark ${glyph(close)}`,
        ),
        ...(fourth && lead ? [p(`Want it moodier? Swap ${lead.emoji} for ${fourth.emoji}.`)] : []),
      ];
    },
  },
  {
    id: "birthday",
    prompt: "Birthday message for Ana, in Spanish",
    call: { name: "search_emoji", args: { query: "happy birthday", locale: "es", limit: 6 } },
    reply(run) {
      const [first, second, , , fifth] = results(run);
      const cake = second ?? first;
      return [
        p("Here's one for Ana:"),
        quote(
          `¡Feliz cumpleaños, Ana! ${glyph(cake)}\nQue este año te traiga muchas risas, buenos planes y alguna que otra sorpresa ${glyph(fifth)}. ¡A celebrarlo a lo grande! ${glyph(cake === first ? undefined : first)}`,
        ),
        ...(cake
          ? [
              p(
                `I searched in English and asked for Spanish labels, so ${cake.emoji} came back as “${cake.label}”.`,
              ),
            ]
          : []),
      ];
    },
  },
  {
    id: "react",
    prompt: "React to “10k users. We did it!”",
    call: { name: "suggest_reactions", args: { text: "10k users. We did it!" } },
    reply(run) {
      const list = results(run);
      const [first, second, third] = list;
      if (!first) return [p("Nothing in that message stands out to react to.")];
      const why = reason(first);
      // A runner for "10k" is a fun miss worth naming, unless it made the recommended set.
      const race = list.slice(3).find((r) => r.match === "10k");
      return [
        p(
          first.source === "default" || !why
            ? `React with ${first.emoji}. It's the safe default here.`
            : `React with ${first.emoji}. It matched “${why}”, and it's an emoji people actually react with.`,
        ),
        ...(second && third
          ? [p(`${second.emoji} and ${third.emoji} work too if the thread is celebrating.`)]
          : []),
        ...(race ? [p(`Skip ${race.emoji}: it matched “10k”, as in the race.`)] : []),
      ];
    },
  },
  {
    id: "status",
    prompt: "Set my status: deploying on a Friday",
    call: { name: "emoji_for_text", args: { text: "Deploying on a Friday. Wish me luck." } },
    reply(run) {
      const [first, second, third] = results(run);
      const status = run.structured.suggestion ?? "Deploying on a Friday. Wish me luck.";
      const why = reason(first);
      return [
        p("Here's your status:"),
        quote(status),
        ...(first && why ? [p(`${first.emoji} matched “${why}”.`)] : []),
        ...(second
          ? [
              p(
                `Runner-up: ${second.emoji}.${third ? ` If it goes sideways, ${third.emoji} is right there.` : ""}`,
              ),
            ]
          : []),
      ];
    },
  },
];
