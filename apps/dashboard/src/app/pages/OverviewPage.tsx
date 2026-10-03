import { getPlan } from "@emojisense/platform";
import { EnvironmentsCard } from "../components/EnvironmentsCard";
import { LiveSearch } from "../components/LiveSearch";
import { QuickStart } from "../components/QuickStart";
import { UsagePanel } from "../components/UsagePanel";
import { formatDate } from "../format";
import { appEmoji } from "../lib/identity";
import { sessionKey } from "../lib/sessionKeys";
import { useAppDetail } from "../shell/context";
import { RoleBadge } from "../ui/Badges";
import { CopyButton } from "../ui/Copy";
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
            <span>{getPlan(app.plan).name} plan</span>
            <span aria-hidden="true">·</span>
            <span>Created {formatDate(app.createdAt)}</span>
            {role !== "owner" && <RoleBadge value={role} />}
          </>
        }
        actions={
          <span className="app-id">
            <span className="app-id-label">App ID</span>
            <span className="mono">{app.id}</span>
            <CopyButton value={app.id} label="Copy the app ID" done="App ID copied" />
          </span>
        }
      />
      <div className="stack-lg">
        <EnvironmentsCard app={app} />
        <div className="overview-grid">
          <LiveSearch key={app.id} app={app} createdKey={fullKey} />
          <QuickStart app={app} keys={keys} />
        </div>
        <UsagePanel app={app} />
      </div>
    </>
  );
}
