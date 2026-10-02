import { getPlan } from "@emojisense/platform";
import { LiveSearch } from "../components/LiveSearch";
import { QuickStart } from "../components/QuickStart";
import { UsagePanel } from "../components/UsagePanel";
import { formatDate } from "../format";
import { appEmoji } from "../lib/identity";
import { sessionKey } from "../lib/sessionKeys";
import { Link } from "../router";
import { appHref } from "../routes";
import { useAppDetail } from "../shell/context";
import { EnvBadge, RoleBadge } from "../ui/Badges";
import { CopyButton } from "../ui/Copy";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";

export function OverviewPage() {
  const { app, keys, role } = useAppDetail();
  const publishable = keys.find((key) => key.kind === "publishable" && key.revokedAt === null);
  const fullKey = publishable ? sessionKey(publishable.id) : undefined;

  return (
    <>
      <PageHeader
        title={app.name}
        leading={
          <span className="avatar avatar-xl emoji" aria-hidden="true">
            {appEmoji(app.id)}
          </span>
        }
        eyebrow={
          <>
            <EnvBadge environment={app.environment} />
            <span>{getPlan(app.plan).name} plan</span>
            <span aria-hidden="true">·</span>
            <span>Created {formatDate(app.createdAt)}</span>
            {role !== "owner" && <RoleBadge value={role} />}
          </>
        }
        actions={
          <>
            <span className="app-id">
              <span className="mono">{app.id}</span>
              <CopyButton value={app.id} label="Copy the app ID" done="App ID copied" />
            </span>
            <Link to={appHref(app.id, "keys")} className="btn">
              <Icon name="key" />
              {app.activeKeyCount} active key{app.activeKeyCount === 1 ? "" : "s"}
            </Link>
          </>
        }
      />
      <div className="stack-lg">
        <UsagePanel app={app} />
        <div className="overview-grid">
          <LiveSearch app={app} apiKey={fullKey} />
          <QuickStart app={app} keys={keys} />
        </div>
      </div>
    </>
  );
}
