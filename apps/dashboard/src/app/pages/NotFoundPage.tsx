import type { ReactNode } from "react";
import { Link, usePageHeading } from "../router";

export function NotFoundPage({
  title = "Page not found",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  const headingRef = usePageHeading(title);
  return (
    <div className="not-found">
      <span className="not-found-emoji emoji" aria-hidden="true">
        🫥
      </span>
      <p className="section-label">404</p>
      <h1 ref={headingRef} className="page-title" tabIndex={-1}>
        {title}
      </h1>
      <p className="page-lede">
        {children ?? "This address does not match a dashboard page. The link may be old."}
      </p>
      <div className="btn-row">
        <Link to="/apps" className="btn btn-primary">
          Go to your apps
        </Link>
      </div>
    </div>
  );
}
