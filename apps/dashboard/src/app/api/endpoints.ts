import type {
  AnalyticsWindow,
  BillingInterval,
  CultureAdminOverview,
  CultureEntryRecord,
  CultureLiveEntry,
  CultureLiveExport,
  CulturePreview,
  CultureProposal,
  CultureProposalStatus,
  CulturePublishReport,
  EmojiSet,
  KeyKind,
  PaidPlanId,
} from "@emojisense/platform";
import type {
  AcceptInviteResponse,
  AdminStatusResponse,
  AnalyticsFilters,
  AnalyticsResponse,
  AppDetailResponse,
  AppResponse,
  AppsResponse,
  BillingResponse,
  CheckoutRequest,
  CheckoutResponse,
  CreatedInviteResponse,
  CreatedKeyResponse,
  CustomEmoji,
  CustomEmojiListResponse,
  DeleteAccountRequest,
  DeleteAccountResponse,
  DeletedTenantResponse,
  EmojiImportResponse,
  Environment,
  KeyResponse,
  MeResponse,
  OkResponse,
  TeamMemberResponse,
  TeamResponse,
  TenantResponse,
  TenantsResponse,
  UsageResponse,
  WebhookDeliveriesResponse,
  WebhookResponse,
  WebhooksResponse,
  WebhookTestResponse,
} from "../../shared/contract";
import { request } from "./client";
import type { CreatedWebhook, EmojiUpload, TeamRole, WebhookEvent } from "./types";

const segment = encodeURIComponent;
const culturePath = (id: string) => `/api/admin/culture/proposals/${segment(id)}`;
type ProposalWithPreview = { proposal: CultureProposal; preview: CulturePreview };
const appPath = (appId: string) => `/api/apps/${segment(appId)}`;
/** Team routes act on the caller's own team unless `owner` names another one. */
const ownerQuery = (owner?: string) => (owner ? `?owner=${segment(owner)}` : "");

export const api = {
  me: () => request<MeResponse>("GET", "/api/me"),
  logout: () => request<OkResponse>("POST", "/api/auth/logout"),
  /** Deletes the signed-in account and everything it owns, and the Clerk user if the Worker can. */
  deleteAccount: (confirm: string) =>
    request<DeleteAccountResponse>("DELETE", "/api/me", { confirm } satisfies DeleteAccountRequest),

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

  /** `used` / `limit` count every emoji of every app of the owning account. */
  listEmoji: (appId: string) => request<CustomEmojiListResponse>("GET", `${appPath(appId)}/emoji`),
  uploadEmoji: (appId: string, upload: EmojiUpload) => {
    const form = new FormData();
    form.set("file", upload.file);
    form.set("shortcode", upload.shortcode);
    form.set("aliases", upload.aliases.join(","));
    if (upload.tenantId) form.set("tenantId", upload.tenantId);
    return request<CustomEmoji>("POST", `${appPath(appId)}/emoji`, form);
  },
  updateEmoji: (appId: string, emojiId: string, input: { shortcode?: string; aliases?: string[] }) =>
    request<CustomEmoji>("PATCH", `${appPath(appId)}/emoji/${segment(emojiId)}`, input),
  deleteEmoji: (appId: string, emojiId: string) =>
    request<OkResponse>("DELETE", `${appPath(appId)}/emoji/${segment(emojiId)}`),
  /** One batch of at most 50 new emoji. Call again with the same token while `remaining > 0`. */
  importSlack: (appId: string, token: string) =>
    request<EmojiImportResponse>("POST", `${appPath(appId)}/emoji/import/slack`, { token }),
  importDiscord: (appId: string, input: { botToken: string; guildId: string }) =>
    request<EmojiImportResponse>("POST", `${appPath(appId)}/emoji/import/discord`, input),

  /** `filters` narrow the report to one country and/or one locale of the app's own searches. */
  analytics: (appId: string, days: AnalyticsWindow, filters: Partial<AnalyticsFilters> = {}) => {
    const query = new URLSearchParams({ days: String(days) });
    if (filters.country) query.set("country", filters.country);
    if (filters.locale) query.set("locale", filters.locale);
    return request<AnalyticsResponse>("GET", `${appPath(appId)}/analytics?${query}`);
  },

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
  /** Whop's hosted checkout for the plan (owner only). The SPA sends the browser there. */
  checkout: (plan: PaidPlanId, interval: BillingInterval) =>
    request<CheckoutResponse>("POST", "/api/billing/checkout", { plan, interval } satisfies CheckoutRequest),

  /** Whether the internal pages show for this account (ADMIN_EMAILS). */
  adminStatus: () => request<AdminStatusResponse>("GET", "/api/admin"),
  cultureOverview: (status?: CultureProposalStatus) =>
    request<CultureAdminOverview>("GET", `/api/admin/culture${status ? `?status=${status}` : ""}`),
  cultureProposal: (id: string) => request<ProposalWithPreview>("GET", culturePath(id)),
  /** Validation, gate and search preview of an edited entry, without saving it. */
  culturePreview: (record: CultureEntryRecord) =>
    request<CulturePreview>("POST", "/api/admin/culture/preview", { record }),
  updateCultureProposal: (id: string, record: CultureEntryRecord) =>
    request<ProposalWithPreview>("PATCH", culturePath(id), { record }),
  approveCultureProposal: (id: string, input: { reason?: string; record?: CultureEntryRecord }) =>
    request<{ proposal: CultureProposal; live: CultureLiveEntry }>(
      "POST",
      `${culturePath(id)}/approve`,
      input,
    ),
  rejectCultureProposal: (id: string, reason: string) =>
    request<{ proposal: CultureProposal }>("POST", `${culturePath(id)}/reject`, { reason }),
  retireCultureEntry: (id: string, reason: string) =>
    request<{ live: CultureLiveEntry }>("POST", `/api/admin/culture/live/${segment(id)}/retire`, { reason }),
  publishCulture: () => request<CulturePublishReport>("POST", "/api/admin/culture/publish", {}),
  exportCulture: (markExported: boolean) =>
    request<CultureLiveExport>("POST", "/api/admin/culture/export", { markExported }),
};
