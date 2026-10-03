import { useEffect, useState } from "react";
import type { App } from "../api";
import { CreateAppForm } from "../components/CreateAppForm";
import { formatDate } from "../format";
import { appEmoji } from "../lib/identity";
import { lowestListedPlanWith } from "../lib/plans";
import { Link, navigate, useSearchParams } from "../router";
import { appHref } from "../routes";
import { useSession } from "../session";
import { useApps } from "../shell/context";
import { EnvBadge, roleLabel } from "../ui/Badges";
import { Dialog } from "../ui/Dialog";
import { ErrorState, LoadingState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { PlanGate } from "../ui/PlanGate";

/** The cheapest plan on sale with room for one more app than the account has; none on the top one. */
const planWithMoreApps = (appCount: number) => lowestListedPlanWith((plan) => plan.maxApps > appCount);

export function AppsPage() {
  const { me, refresh } = useSession();
  const { apps, reload, upsert } = useApps();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const { maxApps } = me.plan;
  const atLimit = maxApps !== null && me.appCount >= maxApps;

  // "Create app" in the app switcher links to /apps?new=1.
  useEffect(() => {
    if (params.get("new") !== "1") return;
    navigate("/apps", { replace: true });
    if (!atLimit) setCreating(true);
  }, [params, atLimit]);

  async function handleCreated(app: App) {
    setCreating(false);
    upsert(app);
    await refresh();
    navigate(appHref(app.id));
  }

  const list = apps.status === "ready" ? apps.data : [];
  const own = list.filter((app) => app.role === "owner");
  const shared = list.filter((app) => app.role !== "owner");
  const empty = apps.status === "ready" && list.length === 0;
  const morePlan = atLimit ? planWithMoreApps(me.appCount) : undefined;

  return (
    <>
      <PageHeader
        title="Apps"
        lede="Each app has its own keys, custom emoji, analytics and usage."
        actions={
          !empty && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={atLimit}
              title={atLimit ? `Your ${me.plan.name} plan allows ${maxApps} apps.` : undefined}
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" />
              New app
            </button>
          )
        }
      />

      <div className="stack-lg" aria-busy={apps.status === "loading"}>
        {apps.status === "loading" && <LoadingState label="Loading apps…" />}
        {apps.status === "error" && <ErrorState message={apps.message} onRetry={reload} />}
        {empty && <FirstApp onCreated={handleCreated} />}
        {own.length > 0 && (
          <section aria-label="Your apps" className="stack">
            {shared.length > 0 && <h2 className="section-label">Your apps</h2>}
            <ul className="app-grid">
              {own.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </ul>
          </section>
        )}
        {own.length > 0 && morePlan && <PlanGate feature="apps" plan={morePlan} compact />}
        {shared.length > 0 && (
          <section aria-label="Shared with you" className="stack">
            <h2 className="section-label">Shared with you</h2>
            <ul className="app-grid">
              {shared.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <Dialog
        open={creating}
        title="Create an app"
        description="An app holds the keys and the usage of one product in one environment."
        onClose={() => setCreating(false)}
      >
        <CreateAppForm autoFocus onCreated={handleCreated} onCancel={() => setCreating(false)} />
      </Dialog>
    </>
  );
}

function AppCard({ app }: { app: App }) {
  const shared = app.role !== "owner";
  return (
    <li className="app-card">
      <div className="app-card-top">
        <span className="avatar avatar-lg emoji" aria-hidden="true">
          {appEmoji(app.id)}
        </span>
        <EnvBadge environment={app.environment} />
      </div>
      <h3 className="app-card-name">
        <Link to={appHref(app.id)} className="app-card-link">
          {app.name}
        </Link>
      </h3>
      <p className="app-card-meta">
        {shared ? (
          <span>
            {app.ownerName ?? "Team"}’s app · {roleLabel(app.role)}
          </span>
        ) : (
          <>
            <span>
              {app.activeKeyCount} active key{app.activeKeyCount === 1 ? "" : "s"}
            </span>
            <span aria-hidden="true">·</span>
            <span>Created {formatDate(app.createdAt)}</span>
          </>
        )}
      </p>
      <Icon name="arrowRight" className="app-card-arrow" />
    </li>
  );
}

function FirstApp({ onCreated }: { onCreated: (app: App) => void }) {
  return (
    <div className="card onboarding">
      <div className="onboarding-intro">
        <span className="empty-emoji emoji" aria-hidden="true">
          🐣
        </span>
        <h2 className="empty-title">No apps yet</h2>
        <p className="empty-text">
          Create your first app. Then add a key, and your picker understands slang, feelings and 11 languages.
        </p>
      </div>
      <div className="onboarding-form">
        <CreateAppForm onCreated={onCreated} />
      </div>
    </div>
  );
}
