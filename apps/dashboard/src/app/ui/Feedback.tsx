import type { ReactNode } from "react";

interface EmptyStateProps {
  emoji: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3;
}

/** An empty screen is an invitation to act: say what goes here and how to add it. */
export function EmptyState({ emoji, title, children, action, headingLevel = 3 }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="empty">
      <span className="empty-emoji emoji" aria-hidden="true">
        {emoji}
      </span>
      <Heading className="empty-title">{title}</Heading>
      <p className="empty-text">{children}</p>
      {action && <div className="btn-row">{action}</div>}
    </div>
  );
}

export function LoadingState({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <div key={index} className="skeleton loading-row" style={{ width: `${92 - index * 14}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <p style={{ flex: 1 }}>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
