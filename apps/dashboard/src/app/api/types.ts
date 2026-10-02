/**
 * Dashboard API shapes. The JSON the Worker serves is typed in src/shared/contract.ts; this file
 * re-exports it under the names the pages use, plus the inputs the SPA builds itself.
 */
import type { WebhookEventType } from "@emojisense/platform";
import type {
  AppSummary,
  CreatedWebhookResponse,
  MeResponse,
  TenantSummary,
  WebhookDeliverySummary,
  WebhookSummary,
} from "../../shared/contract";

export {
  type CustomEmojiSource,
  EMOJI_SETS,
  type EmojiSet,
  type PlanId,
  TEAM_ROLES,
  type TeamRole,
} from "@emojisense/platform";
export type {
  AcceptInviteResponse,
  AnalyticsDay,
  AnalyticsResponse,
  BillingResponse,
  CreatedInviteResponse,
  CustomEmoji,
  CustomEmojiListResponse,
  DeletedTenantResponse,
  EmojiImportResponse,
  EmojiImportSkipReason,
  Role,
  TeamInviteSummary,
  TeamMemberResponse,
  TeamMemberSummary,
  TeamResponse,
  TeamSummary,
  TenantsResponse,
  UpgradeResponse,
} from "../../shared/contract";

/** An app as listed by `/api/apps`, with the caller's role and the owner's plan. */
export type App = AppSummary;
export type Me = MeResponse;

/** The multipart form of `POST /api/apps/:id/emoji`. Omit `tenantId` (a `tenants.id`) for app-wide. */
export interface EmojiUpload {
  file: File;
  shortcode: string;
  aliases: string[];
  tenantId?: string;
}

export { WEBHOOK_EVENTS } from "@emojisense/platform";
export type Tenant = TenantSummary;
export type Webhook = WebhookSummary;
export type WebhookEvent = WebhookEventType;
export type WebhookDelivery = WebhookDeliverySummary;
/** Only the create response carries the signing secret. */
export type CreatedWebhook = CreatedWebhookResponse;
