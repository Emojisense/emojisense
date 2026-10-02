import { Fragment, type ReactNode, useMemo } from "react";
import type { EmojiSuggestion } from "./mcp";
import type { ReplyBlock } from "./scenarios";
import { splitWords } from "./useConversation";

interface ReplyProps {
  blocks: readonly ReplyBlock[];
  /** Words revealed so far. */
  shown: number;
  streaming: boolean;
  /** The tool results. Their emoji are the ones the text can contain. */
  results: readonly EmojiSuggestion[];
}

/** The assistant's answer, revealed word by word. Quotes keep their line breaks. */
export function Reply({ blocks, shown, streaming, results }: ReplyProps) {
  const pattern = useMemo(() => emojiPattern(results.map((r) => r.emoji)), [results]);
  let budget = shown;
  const rendered: { kind: ReplyBlock["kind"]; lines: string[] }[] = [];
  for (const block of blocks) {
    if (budget <= 0) break;
    const lines: string[] = [];
    for (const line of block.text.split("\n")) {
      if (budget <= 0) break;
      const words = splitWords(line).slice(0, budget);
      budget -= words.length;
      lines.push(words.join(" "));
    }
    rendered.push({ kind: block.kind, lines });
  }

  return (
    <div className="assistant-reply">
      {rendered.map((block, index) => {
        const last = index === rendered.length - 1;
        const content = (
          <>
            {block.lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines only ever grow at the end.
              <Fragment key={i}>
                {i > 0 && <br />}
                {withEmoji(line, pattern)}
              </Fragment>
            ))}
            {last && streaming && <span className="assistant-caret" aria-hidden="true" />}
          </>
        );
        return block.kind === "quote" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks only ever grow at the end.
          <blockquote key={index} className="assistant-quote">
            {content}
          </blockquote>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks only ever grow at the end.
          <p key={index}>{content}</p>
        );
      })}
    </div>
  );
}

function emojiPattern(emoji: readonly string[]): RegExp | undefined {
  const unique = [...new Set(emoji.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (unique.length === 0) return undefined;
  return new RegExp(`(${unique.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "u");
}

function withEmoji(text: string, pattern: RegExp | undefined): ReactNode {
  if (!pattern) return text;
  // split() with one capture group puts the matches at the odd indexes.
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string.
      <span key={i} className="emoji">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
