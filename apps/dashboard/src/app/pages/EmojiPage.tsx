import { lowestPlanWith, PLANS } from "@emojisense/platform";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import {
  api,
  type CustomEmoji,
  type CustomEmojiListResponse,
  type CustomEmojiSource,
  type PlanId,
  type Tenant,
} from "../api";
import { DropZone } from "../components/emoji/DropZone";
import { EditEmojiDialog } from "../components/emoji/EditEmojiDialog";
import { ImportDialog, type ImportSource } from "../components/emoji/ImportDialog";
import { UploadDialog, type UploadRequest } from "../components/emoji/UploadDialog";
import { formatNumber } from "../format";
import { toShortcode } from "../lib/emoji";
import { FEATURE_PLAN, planIncludes } from "../lib/plans";
import { useResource } from "../lib/useResource";
import { navigate, useSearchParams } from "../router";
import { appHref } from "../routes";
import { useAppDetail } from "../shell/context";
import { EmptyState, ErrorState, LoadingState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { PlanGate } from "../ui/PlanGate";
import { Segmented } from "../ui/Segmented";
import { useToast } from "../ui/Toast";
import { usePopover } from "../ui/usePopover";

type SourceFilter = "all" | CustomEmojiSource;

const SOURCE_TAG: Record<CustomEmojiSource, string> = {
  upload: "uploaded",
  slack: "from slack",
  discord: "from discord",
  api: "via api",
};

export function EmojiPage() {
  const { app, readOnly } = useAppDetail();
  const toast = useToast();
  const params = useSearchParams();
  const [list, { reload, mutate }] = useResource<CustomEmojiListResponse>(`emoji:${app.id}`, () =>
    api.listEmoji(app.id),
  );
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [upload, setUpload] = useState<UploadRequest | null>(null);
  const [editing, setEditing] = useState<CustomEmoji | null>(null);
  const [importing, setImporting] = useState<ImportSource | null>(null);
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const filterId = useId();

  const tenantsAllowed = planIncludes(app.plan, "tenants");
  useEffect(() => {
    if (!tenantsAllowed) return;
    api.listTenants(app.id).then(
      (data) => setTenants(data.tenants),
      () => undefined,
    );
  }, [app.id, tenantsAllowed]);

  // Analytics and the live search link here with ?new=<query> to turn a missed search into an emoji.
  useEffect(() => {
    const query = params.get("new");
    if (query === null) return;
    navigate(appHref(app.id, "emoji"), { replace: true });
    setUpload({ files: [], shortcode: toShortcode(query), aliases: query });
  }, [params, app.id]);

  const visible = useMemo(() => {
    if (list.status !== "ready") return [];
    const needle = filter.trim().toLowerCase().replace(/^:|:$/g, "");
    return list.data.emoji.filter(
      (emoji) =>
        (source === "all" || emoji.source === source) &&
        (!needle ||
          emoji.shortcode.includes(needle) ||
          emoji.aliases.some((alias) => alias.includes(needle))),
    );
  }, [list, filter, source]);

  if (list.status === "loading") {
    return (
      <>
        <Header />
        <LoadingState label="Loading custom emoji…" />
      </>
    );
  }
  // After a downgrade to a plan without custom emoji, the ones left stay listed so they can be deleted.
  if (
    list.status === "plan" ||
    (list.status === "ready" && list.data.limit === 0 && !list.data.emoji.length)
  ) {
    return (
      <>
        <Header />
        <PlanGate
          feature="custom_emoji"
          plan={list.status === "plan" ? list.plan : FEATURE_PLAN.custom_emoji}
        />
      </>
    );
  }
  if (list.status === "error") {
    return (
      <>
        <Header />
        <ErrorState message={list.message} onRetry={reload} />
      </>
    );
  }

  const { emoji, used, limit } = list.data;
  const full = limit !== null && used >= limit;
  const counts = emoji.reduce<Record<string, number>>((all, item) => {
    all[item.source] = (all[item.source] ?? 0) + 1;
    return all;
  }, {});

  function added(item: CustomEmoji) {
    mutate((data) => ({ ...data, emoji: [item, ...data.emoji], used: data.used + 1 }));
    toast(`Added :${item.shortcode}:`);
  }

  return (
    <>
      <Header
        actions={
          !readOnly && (
            <>
              <ImportMenu onChoose={setImporting} />
              <button
                type="button"
                className="btn btn-primary"
                disabled={full}
                onClick={() => setUpload({ files: [] })}
              >
                <Icon name="upload" />
                Upload emoji
              </button>
            </>
          )
        }
      />

      <div className="stack-lg">
        <div className="emoji-bar">
          <EmojiUsage used={used} limit={limit} appCount={emoji.length} />
          {emoji.length > 0 && (
            <div className="emoji-filters">
              <div className="input-affix">
                <Icon name="search" />
                <label htmlFor={filterId} className="visually-hidden">
                  Filter custom emoji
                </label>
                <input
                  id={filterId}
                  className="input"
                  type="search"
                  placeholder="Filter by shortcode or alias"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>
              <Segmented<SourceFilter>
                label="Source"
                value={source}
                onChange={setSource}
                options={[
                  { value: "all", label: `All ${emoji.length}` },
                  { value: "upload", label: "Uploaded", disabled: !counts.upload },
                  { value: "slack", label: "Slack", disabled: !counts.slack },
                  { value: "discord", label: "Discord", disabled: !counts.discord },
                ]}
              />
            </div>
          )}
        </div>

        {full && limit !== null && (
          <p className="notice" role="status">
            {limitNotice(used, limit, app.plan)}
          </p>
        )}
        {!readOnly && !full && <DropZone onFiles={(files) => setUpload({ files })} />}

        {emoji.length === 0 ? (
          <div className="card">
            <EmptyState emoji="🎨" title="No custom emoji yet">
              Upload your team’s favorites, or import a whole Slack or Discord workspace at once.
            </EmptyState>
          </div>
        ) : visible.length === 0 ? (
          <p className="hint">No custom emoji match “{filter}”.</p>
        ) : (
          <ul className="emoji-grid" aria-label="Custom emoji">
            {visible.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="emoji-tile"
                  onClick={() => setEditing(item)}
                  aria-label={`:${item.shortcode}:${item.aliases.length ? `, also ${item.aliases.join(", ")}` : ""}`}
                >
                  <span className="emoji-tile-image">
                    <img className="emoji-tile-img" src={item.imageUrl} alt="" loading="lazy" />
                  </span>
                  <span className="emoji-tile-code">:{item.shortcode}:</span>
                  <span className="emoji-tile-tag">
                    {item.tenantId
                      ? (tenants.find((tenant) => tenant.id === item.tenantId)?.name ?? "one tenant")
                      : SOURCE_TAG[item.source]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <UploadDialog
        appId={app.id}
        request={upload}
        tenants={tenants}
        onUploaded={added}
        onClose={() => setUpload(null)}
      />
      <EditEmojiDialog
        appId={app.id}
        emoji={editing}
        tenants={tenants}
        readOnly={readOnly}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          mutate((data) => ({
            ...data,
            emoji: data.emoji.map((item) => (item.id === saved.id ? saved : item)),
          }));
          setEditing(null);
          toast(`Saved :${saved.shortcode}:`);
        }}
        onDeleted={(deleted) => {
          mutate((data) => ({
            ...data,
            emoji: data.emoji.filter((item) => item.id !== deleted.id),
            used: Math.max(0, data.used - 1),
          }));
          setEditing(null);
          toast(`Deleted :${deleted.shortcode}:`);
        }}
      />
      <ImportDialog
        appId={app.id}
        plan={app.plan}
        source={importing}
        onImported={reload}
        onClose={() => setImporting(null)}
      />
    </>
  );
}

function Header({ actions }: { actions?: ReactNode }) {
  const { app } = useAppDetail();
  return (
    <PageHeader
      title="Custom emoji"
      documentTitle={`Custom emoji · ${app.name}`}
      lede="Your own emoji, found by search next to the standard set, on the device and through the API."
      actions={actions}
    />
  );
}

/**
 * `used` and `limit` belong to the account: the plan limit counts the emoji of every app it owns.
 * `appCount` is this app's part.
 */
function EmojiUsage({ used, limit, appCount }: { used: number; limit: number | null; appCount: number }) {
  const percent = limit ? Math.min(100, (used / limit) * 100) : 0;
  const share = appCount === used ? "" : `This app: ${formatNumber(appCount)} of ${formatNumber(used)}. `;
  return (
    <div className="emoji-usage">
      <p>
        <strong>{formatNumber(used)}</strong>
        <span className="muted"> of {limit === null ? "unlimited" : formatNumber(limit)} custom emoji</span>
      </p>
      {limit !== null && limit > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: same track as the usage meters
        <div
          className="meter-track"
          role="meter"
          aria-label="Custom emoji used"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={`${formatNumber(used)} of ${formatNumber(limit)}`}
        >
          <div className="meter-fill" style={{ width: used > 0 ? `max(0.375rem, ${percent}%)` : "0" }} />
        </div>
      )}
      <p className="hint">{share}The limit counts every app of the account.</p>
    </div>
  );
}

/** Why uploads and imports are off: the account is at (or, after a downgrade, over) its limit. */
function limitNotice(used: number, limit: number, planId: PlanId): string {
  const plan = PLANS[planId];
  const next = lowestPlanWith((candidate) => candidate.limits.custom_emoji > Math.max(limit, used));
  const upgrade = next ? ` ${PLANS[next].name} allows ${formatNumber(PLANS[next].limits.custom_emoji)}.` : "";
  if (limit === 0) {
    return `Custom emoji are not part of the ${plan.name} plan. You can still edit and delete these.${upgrade}`;
  }
  const state =
    used > limit
      ? `The account has ${formatNumber(used)} custom emoji, more than the ${formatNumber(limit)} of the ${plan.name} plan.`
      : `All ${formatNumber(limit)} custom emoji of the ${plan.name} plan are in use across the account’s apps.`;
  return `${state} Delete some to add new ones.${upgrade}`;
}

function ImportMenu({ onChoose }: { onChoose: (source: ImportSource) => void }) {
  const popover = usePopover();
  const { app } = useAppDetail();
  const locked = !planIncludes(app.plan, "emoji_import");
  const menuId = useId();
  return (
    <div className="menu-anchor" ref={popover.containerRef}>
      <button
        ref={popover.buttonRef}
        type="button"
        className="btn"
        aria-expanded={popover.open}
        aria-controls={menuId}
        onClick={popover.toggle}
      >
        Import
        <Icon name="chevrons" />
      </button>
      {popover.open && (
        <div id={menuId} className="menu menu-right">
          {(["slack", "discord"] as const).map((source) => (
            <button
              key={source}
              type="button"
              className="menu-item"
              onClick={() => {
                popover.close();
                onChoose(source);
              }}
            >
              <span className="emoji" aria-hidden="true">
                {source === "slack" ? "💬" : "🎮"}
              </span>
              <span className="switcher-item-text">
                <span>From {source === "slack" ? "Slack" : "Discord"}</span>
                {locked && <span className="nav-lock">{PLANS[FEATURE_PLAN.emoji_import].name}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
