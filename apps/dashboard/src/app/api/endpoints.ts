import type { AnalyticsWindow, EmojiSet, KeyKind, PlanId } from "@emojisense/platform";
import type {
  AcceptInviteResponse,
  AnalyticsResponse,
  AppDetailResponse,
  AppResponse,
  AppsResponse,
  BillingResponse,
  CreatedInviteResponse,
  CreatedKeyResponse,
  DeleteAccountRequest,
  DeletedTenantResponse,
  Environment,
  KeyResponse,
  MeResponse,
  OkResponse,
  TeamMemberResponse,
  TeamResponse,
  TenantResponse,
  TenantsResponse,
  UpgradeResponse,
  UsageResponse,
  WaitlistResponse,
  WebhookDeliveriesResponse,
  WebhookResponse,
  WebhooksResponse,
  WebhookTestResponse,
} from "../../shared/contract";
import { request, unwrap } from "./client";
import type {
  CreatedWebhook,
  CustomEmoji,
  EmojiList,
  EmojiUpload,
  ImportResult,
  TeamRole,
  WebhookEvent,
} from "./types";

const segment = encodeURIComponent;
const appPath = (appId: string) => `/api/apps/${segment(appId)}`;
/** Team routes act on the caller's own team unless `owner` names another one. */
const ownerQuery = (owner?: string) => (owner ? `?owner=${segment(owner)}` : "");

function normalizeEmoji(emoji: CustomEmoji): CustomEmoji {
  return {
    ...emoji,
    aliases: Array.isArray(emoji.aliases) ? emoji.aliases : [],
    tenantId: emoji.tenantId || null,
  };
}

export const api = {
  me: () => request<MeResponse>("GET", "/api/me"),
  logout: () => request<OkResponse>("POST", "/api/auth/logout"),
  /** Deletes the signed-in account and everything it owns. The server also ends the session. */
  deleteAccount: (confirm: string) =>
    request<OkResponse>("DELETE", "/api/me", { confirm } satisfies DeleteAccountRequest),

  listApps: () => request<AppsResponse>("GET", "/api/apps"),
  createApp: (input: { name: string; environment: Environment }) =>
    request<AppResponse>("POST", "/api/apps", input).then((data) => data.app),
  getApp: (appId: string) => request<AppDetailResponse>("GET", appPath(appId)),
  updateApp: (appId: string, input: { name?: string; emojiSet?: EmojiSet }) =>
    request<AppResponse>("PATCH", appPath(appId), input).then((data) => data.app),

  createKey: (appId: string, input: { kind: KeyKind; allowedOrigins?: string[] }) =>
    request<CreatedKeyResponse>("POST", `${appPath(appId)}/keys`, input),
  updateKeyOrigins: (keyId: string, allowedOrigins: string[]) =>
    request<KeyResponse>("PATCH", `/api/keys/${segment(keyId)}`, { allowedOrigins }),
  revokeKey: (keyId: string) => request<KeyResponse>("DELETE", `/api/keys/${segment(keyId)}`),
  usage: (appId: string, period: string) =>
    request<UsageResponse>("GET", `${appPath(appId)}/usage?period=${segment(period)}`),

  listEmoji: (appId: string) =>
    request<EmojiList>("GET", `${appPath(appId)}/emoji`).then((list) => ({
      ...list,
      emoji: list.emoji.map(normalizeEmoji),
    })),
  uploadEmoji: (appId: string, upload: EmojiUpload) => {
    const form = new FormData();
    form.set("file", upload.file);
    form.set("shortcode", upload.shortcode);
    form.set("aliases", upload.aliases.join(","));
    if (upload.tenantId) form.set("tenantId", upload.tenantId);
    return request<unknown>("POST", `${appPath(appId)}/emoji`, form).then((data) =>
      normalizeEmoji(unwrap<CustomEmoji>(data, "emoji")),
    );
  },
  updateEmoji: (appId: string, emojiId: string, input: { shortcode?: string; aliases?: string[] }) =>
    request<unknown>("PATCH", `${appPath(appId)}/emoji/${segment(emojiId)}`, input).then((data) =>
      normalizeEmoji(unwrap<CustomEmoji>(data, "emoji")),
    ),
  deleteEmoji: (appId: string, emojiId: string) =>
    request<unknown>("DELETE", `${appPath(appId)}/emoji/${segment(emojiId)}`),
  importSlack: (appId: string, token: string) =>
    request<ImportResult>("POST", `${appPath(appId)}/emoji/import/slack`, { token }),
  importDiscord: (appId: string, input: { botToken: string; guildId: string }) =>
    request<ImportResult>("POST", `${appPath(appId)}/emoji/import/discord`, input),

  analytics: (appId: string, days: AnalyticsWindow) =>
    request<AnalyticsResponse>("GET", `${appPath(appId)}/analytics?days=${days}`),

  /** One page, ordered by externalId. Pass `nextCursor` back for the next one. */
  listTenants: (appId: string, cursor?: string) =>
    request<TenantsResponse>(
      "GET",
      `${appPath(appId)}/tenants?limit=100${cursor ? `&cursor=${segment(cursor)}` : ""}`,
    ),
  createTenant: (appId: string, input: { externalId: string; name?: string }) =>
    request<TenantResponse>("POST", `${appPath(appId)}/tenants`, input).then((data) => data.tenant),
  deleteTenant: (appId: string, tenantId: string) =>
    request<DeletedTenantResponse>("DELETE", `${appPath(appId)}/tenants/${segment(tenantId)}`),

  listWebhooks: (appId: string) => request<WebhooksResponse>("GET", `${appPath(appId)}/webhooks`),
  createWebhook: (appId: string, input: { url: string; events: WebhookEvent[] }) =>
    request<CreatedWebhook>("POST", `${appPath(appId)}/webhooks`, input),
  updateWebhook: (webhookId: string, input: { url?: string; events?: WebhookEvent[]; enabled?: boolean }) =>
    request<WebhookResponse>("PATCH", `/api/webhooks/${segment(webhookId)}`, input).then(
      (data) => data.webhook,
    ),
  deleteWebhook: (webhookId: string) => request<OkResponse>("DELETE", `/api/webhooks/${segment(webhookId)}`),
  testWebhook: (webhookId: string) =>
    request<WebhookTestResponse>("POST", `/api/webhooks/${segment(webhookId)}/test`).then(
      (data) => data.delivery,
    ),
  listDeliveries: (webhookId: string) =>
    request<WebhookDeliveriesResponse>("GET", `/api/webhooks/${segment(webhookId)}/deliveries`),

  team: (owner?: string) => request<TeamResponse>("GET", `/api/team${ownerQuery(owner)}`),
  createInvite: (input: { role: TeamRole; email?: string }, owner?: string) =>
    request<CreatedInviteResponse>("POST", `/api/team/invites${ownerQuery(owner)}`, input),
  revokeInvite: (inviteId: string, owner?: string) =>
    request<OkResponse>("DELETE", `/api/team/invites/${segment(inviteId)}${ownerQuery(owner)}`),
  updateMember: (memberId: string, role: TeamRole, owner?: string) =>
    request<TeamMemberResponse>("PATCH", `/api/team/members/${segment(memberId)}${ownerQuery(owner)}`, {
      role,
    }).then((data) => data.member),
  removeMember: (memberId: string, owner?: string) =>
    request<OkResponse>("DELETE", `/api/team/members/${segment(memberId)}${ownerQuery(owner)}`),
  acceptInvite: (token: string) =>
    request<AcceptInviteResponse>("POST", `/api/invites/${segment(token)}/accept`),

  billing: () => request<BillingResponse>("GET", "/api/billing"),
  upgrade: (plan: PlanId) => request<UpgradeResponse>("POST", "/api/billing/upgrade", { plan }),
  joinWaitlist: (email: string, plan: string) =>
    request<WaitlistResponse>("POST", "/api/waitlist", { email, plan }),
};
