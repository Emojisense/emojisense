import { useCallback, useEffect, useId, useState } from "react";
import type { AppSummary } from "../../shared/contract";
import { api, errorMessage } from "../api";
import { CreateAppCard } from "../components/CreateAppCard";
import { EmptyState } from "../components/EmptyState";
import { EnvironmentPill } from "../components/Pills";
import { PlanCard } from "../components/PlanCard";
import { formatDate } from "../format";
import { Link, navigate, usePageHeading } from "../router";
import { useSession } from "../session";

type AppsState =
  | { status: "loading" }
  | { status: "ready"; apps: AppSummary[] }
  | { status: "error"; message: string };

export function AppsPage() {
  const { refresh } = useSession();
  const [state, setState] = useState<AppsState>({ status: "loading" });
  const headingRef = usePageHeading("Apps");
  const listHeadingId = useId();

  const load = useCallback(() => {
    setState({ status: "loading" });
    api.listApps().then(
      ({ apps }) => setState({ status: "ready", apps }),
      (error: unknown) => setState({ status: "error", message: errorMessage(error) }),
    );
  }, []);

  useEffect(load, [load]);

  async function handleCreated(app: AppSummary) {
    await refresh();
    navigate(`/apps/${app.id}`);
  }

  return (
    <div className="layout">
      <div className="layout-main">
        <header>
          <h1 ref={headingRef} className="page-title" tabIndex={-1}>
            Apps
          </h1>
          <p className="lede">An app holds the API keys and the usage of one product in one environment.</p>
        </header>

        <section aria-labelledby={listHeadingId} aria-busy={state.status === "loading"}>
          <h2 id={listHeadingId} className="visually-hidden">
            Your apps
          </h2>
          {state.status === "loading" && (
            <p className="hint" role="status">
              Loading apps…
            </p>
          )}
          {state.status === "error" && (
            <div className="notice notice-error" role="alert">
              <p>{state.message}</p>
              <button type="button" className="button button-small" onClick={load}>
                Try again
              </button>
            </div>
          )}
          {state.status === "ready" && state.apps.length === 0 && (
            <EmptyState emoji="🐣" title="No apps yet">
              Create your first app below. Then add a key and call the API with it.
            </EmptyState>
          )}
          {state.status === "ready" && state.apps.length > 0 && (
            <ul className="app-list">
              {state.apps.map((app) => (
                <li key={app.id} className="card app-item">
                  <Link to={`/apps/${app.id}`}>{app.name}</Link>
                  <div className="app-meta">
                    <EnvironmentPill environment={app.environment} />
                    <span>
                      {app.activeKeyCount} active key{app.activeKeyCount === 1 ? "" : "s"}
                    </span>
                    <span>Created {formatDate(app.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <CreateAppCard onCreated={handleCreated} />
      </div>
      <aside className="layout-aside" aria-label="Plan">
        <PlanCard />
      </aside>
    </div>
  );
}
