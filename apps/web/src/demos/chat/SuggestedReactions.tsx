import { type CSSProperties, useId } from "react";
import { SparkleIcon } from "./icons";
import type { ReactionSuggestions } from "./reactions";

interface SuggestedReactionsProps {
  /** Undefined while the API and engine are answering. */
  data: ReactionSuggestions | undefined;
  isMine: (emoji: string) => boolean;
  nameOf: (emoji: string) => string;
  onPick: (emoji: string) => void;
}

const SKELETONS = ["a", "b", "c", "d", "e"];

export function SuggestedReactions({ data, isMine, nameOf, onPick }: SuggestedReactionsProps) {
  const labelId = useId();
  if (data && data.results.length === 0) return null;
  return (
    <div className="chat-suggest">
      <span className="chat-suggest-label" id={labelId}>
        <SparkleIcon />
        Suggested reactions
      </span>
      <ul className="chat-suggest-chips" aria-labelledby={labelId} aria-busy={!data}>
        {data
          ? data.results.map((r, i) => {
              const mine = isMine(r.emoji);
              return (
                <li key={r.id} className="chat-chip-item" style={{ "--i": i } as CSSProperties}>
                  <button
                    type="button"
                    className="chat-chip"
                    aria-pressed={mine}
                    aria-label={`React with ${nameOf(r.emoji)}`}
                    title={nameOf(r.emoji)}
                    onClick={() => onPick(r.emoji)}
                  >
                    <span className="emoji">{r.emoji}</span>
                  </button>
                </li>
              );
            })
          : SKELETONS.map((key) => <li key={key} className="chat-chip-skeleton" aria-hidden="true" />)}
      </ul>
      {data && (
        <span
          className="chat-suggest-via"
          title={
            data.via === "edge"
              ? "POST /v1/suggest-reactions, fused with on-device phrase matches"
              : "The on-device engine searched the message"
          }
        >
          {data.via === "edge" ? `edge · ${Math.round(data.ms ?? 0)} ms` : "on-device"}
        </span>
      )}
    </div>
  );
}
