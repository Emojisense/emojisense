import type { ReactNode } from "react";
import { usePageHeading } from "../router";

interface PageHeaderProps {
  title: string;
  /** Document title when it differs from the heading, e.g. "Keys · Relay". */
  documentTitle?: string;
  eyebrow?: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  /** Shown before the title, e.g. the app's emoji avatar. */
  leading?: ReactNode;
}

export function PageHeader({ title, documentTitle, eyebrow, lede, actions, leading }: PageHeaderProps) {
  const headingRef = usePageHeading(documentTitle ?? title);
  return (
    <header className="page-head">
      <div className="page-head-main">
        {leading}
        <div className="page-head-text">
          {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
          <h1 ref={headingRef} className="page-title" tabIndex={-1}>
            {title}
          </h1>
          {lede && <p className="page-lede">{lede}</p>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
