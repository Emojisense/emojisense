import type { ReactNode } from "react";

/** A large emoji with a die-cut outline. Decorative: the text next to it carries the meaning. */
export function Sticker({ emoji, large = false }: { emoji: string; large?: boolean }) {
  return (
    <span className={large ? "sticker sticker-large" : "sticker"} aria-hidden="true">
      {emoji}
    </span>
  );
}

interface EmptyStateProps {
  emoji: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ emoji, title, children, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <Sticker emoji={emoji} />
      <div className="empty-text">
        <h3 className="empty-title">{title}</h3>
        <p className="hint">{children}</p>
        {action && <div className="button-row">{action}</div>}
      </div>
    </div>
  );
}
