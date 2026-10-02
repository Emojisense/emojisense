import { getPlan } from "@emojisense/platform";
import { useCallback, useEffect, useState } from "react";
import type { AppDetailResponse, KeySummary } from "../../shared/contract";
import { ApiError, api, errorMessage } from "../api";
import { KeysPanel } from "../components/KeysPanel";
import { EnvironmentPill, PlanPill } from "../components/Pills";
import { PlanCard } from "../components/PlanCard";
import { UsagePanel } from "../components/UsagePanel";
import { formatDate, isoDate } from "../format";
import { Link, usePageHeading } from "../router";
import { NotFoundPage } from "./NotFoundPage";

type AppState =
  | { status: "loading" }
  | { status: "ready"; data: AppDetailResponse }
  | { status: "missing" }
  | { status: "error"; message: string };

export function AppPage({ appId }: { appId: string }) {
  const [state, setState] = useState<AppState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    api.getApp(appId).then(
      (data) => setState({ status: "ready", data }),
      (error: unknown) =>
        setState(
          error instanceof ApiError && error.status === 404
            ? { status: "missing" }
            : { status: "error", message: errorMessage(error) },
        ),
    );
  }, [appId]);

  useEffect(load, [load]);

  if (state.status === "missing") {
    return (
      <NotFoundPage title="App not found">
        This app does not exist, or it belongs to another account.
      </NotFoundPage>
    );
  }
  if (state.status === "loading") {
    return (
      <p className="hint" role="status">
        Loading app…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="notice notice-error" role="alert">
        <p>{state.message}</p>
        <button type="button" className="button button-small" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const setKeys = (keys: KeySummary[]) =>
    setState({
      status: "ready",
      data: {
        app: { ...state.data.app, activeKeyCount: keys.filter((key) => key.revokedAt === null).length },
        keys,
      },
    });
  return <AppDetail data={state.data} onKeysChange={setKeys} />;
}

function AppDetail({
  data,
  onKeysChange,
}: {
  data: AppDetailResponse;
  onKeysChange: (keys: KeySummary[]) => void;
}) {
  const { app, keys } = data;
  const headingRef = usePageHeading(app.name);

  // The keys table gets the full width; usage sits next to the plan whose limits it measures.
  return (
    <div className="layout-main">
      <header>
        <nav aria-label="Breadcrumb" className="breadcrumb">
          <ol>
            <li>
              <Link to="/apps">Apps</Link>
            </li>
            <li aria-current="page">{app.name}</li>
          </ol>
        </nav>
        <h1 ref={headingRef} className="page-title" tabIndex={-1}>
          {app.name}
        </h1>
        <dl className="facts">
          <div>
            <dt>Environment</dt>
            <dd>
              <EnvironmentPill environment={app.environment} />
            </dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>
              <PlanPill name={getPlan(app.plan).name} />
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>
              <time dateTime={isoDate(app.createdAt)}>{formatDate(app.createdAt)}</time>
            </dd>
          </div>
          <div>
            <dt>Active keys</dt>
            <dd>{app.activeKeyCount}</dd>
          </div>
        </dl>
      </header>
      <KeysPanel app={app} keys={keys} onKeysChange={onKeysChange} />
      <div className="layout">
        <UsagePanel app={app} />
        <aside className="layout-aside" aria-label="Plan">
          <PlanCard />
        </aside>
      </div>
    </div>
  );
}
