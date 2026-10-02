import type { ReactNode } from "react";
import { formatClock, type Message, PEOPLE } from "./content";

const EMOJI_GRAPHEME = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Plain text with emoji wrapped in `.emoji` and `code` spans for backticks. Keys are text offsets. */
function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const chunk of text.split(/(`[^`]+`)/)) {
    const start = offset;
    offset += chunk.length;
    if (chunk.length > 2 && chunk.startsWith("`") && chunk.endsWith("`")) {
      parts.push(<code key={`c${start}`}>{chunk.slice(1, -1)}</code>);
      continue;
    }
    let plain = "";
    for (const { segment, index } of graphemes.segment(chunk)) {
      if (!EMOJI_GRAPHEME.test(segment)) {
        plain += segment;
        continue;
      }
      if (plain) parts.push(plain);
      plain = "";
      parts.push(
        <span key={`e${start + index}`} className="emoji chat-inline-emoji">
          {segment}
        </span>,
      );
    }
    if (plain) parts.push(plain);
  }
  return <>{parts}</>;
}

export function Avatar({ initials, tone, small }: { initials: string; tone: number; small?: boolean }) {
  return (
    <span className={`chat-avatar tone-${tone}${small ? " is-small" : ""}`} aria-hidden="true">
      {initials}
    </span>
  );
}

interface MessageItemProps {
  message: Message;
  /** Same author as the message above: no avatar and name. */
  grouped: boolean;
  nameOf: (emoji: string) => string;
  onToggleReaction: (emoji: string) => void;
  children?: ReactNode;
}

export function MessageItem({ message, grouped, nameOf, onToggleReaction, children }: MessageItemProps) {
  const person = PEOPLE[message.author];
  const time = formatClock(message.minute);
  return (
    <article
      className={`chat-msg${grouped ? " is-grouped" : ""}${message.fresh ? " is-fresh" : ""}`}
      aria-label={`${person.name}, ${time}`}
    >
      {grouped ? (
        <time className="chat-msg-gutter-time" aria-hidden="true">
          {time.replace(/ (AM|PM)$/, "")}
        </time>
      ) : (
        <Avatar initials={person.initials} tone={person.tone} />
      )}
      <div className="chat-msg-body">
        {!grouped && (
          <p className="chat-msg-meta">
            <span className="chat-msg-name">{person.name}</span>
            <time className="chat-msg-time">{time}</time>
          </p>
        )}
        <p className="chat-msg-text">
          <RichText text={message.text} />
        </p>
        {message.reactions.length > 0 && (
          <ul className="chat-reactions" aria-label="Reactions">
            {message.reactions.map((r) => {
              const pop = r.bump > 0 ? " is-pop" : "";
              return (
                <li
                  key={r.emoji}
                  className={`chat-reaction${r.bump === 1 && r.mine && r.count === 1 ? " is-new" : ""}`}
                >
                  <button
                    type="button"
                    className="chat-pill"
                    aria-pressed={r.mine}
                    aria-label={`${nameOf(r.emoji)}: ${r.count} ${r.count === 1 ? "reaction" : "reactions"}`}
                    onClick={() => onToggleReaction(r.emoji)}
                  >
                    <span key={r.bump} className={`emoji chat-pill-emoji${pop}`}>
                      {r.emoji}
                    </span>
                    <span key={`n${r.count}`} className={`chat-pill-count${pop}`}>
                      {r.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {children}
      </div>
    </article>
  );
}
