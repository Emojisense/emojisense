import type { ReactNode } from "react";
import { EmptyState } from "../components/EmptyState";
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
    <div className="layout-main">
      <h1 ref={headingRef} className="page-title" tabIndex={-1}>
        {title}
      </h1>
      <EmptyState
        emoji="🫥"
        title="Nothing here"
        action={
          <Link to="/apps" className="button">
            Go to your apps
          </Link>
        }
      >
        {children ?? "This address does not match a dashboard page."}
      </EmptyState>
    </div>
  );
}
