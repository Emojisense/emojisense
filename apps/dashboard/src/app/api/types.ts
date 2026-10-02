/**
 * Dashboard API shapes. Everything the Worker already serves comes from src/shared/contract.ts;
 * custom emoji, whose routes have not landed yet, mirror the product contract (v1) here until
 * they move there too.
 */
import type { CustomEmojiSource, WebhookEventType } from "@emojisense/platform";
import type {
  AppSummary,
  CreatedWebhookResponse,
  MeResponse,
  TenantSummary,
  WebhookDeliverySummary,
  WebhookSummary,
} from "../../shared/contract";

export { EMOJI_SETS, type EmojiSet, type PlanId, TEAM_ROLES, type TeamRole } from "@emojisense/platform";
export type {
  AcceptInviteResponse,
  AnalyticsDay,
  AnalyticsResponse,
  BillingResponse,
  CreatedInviteResponse,
  DeletedTenantResponse,
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

export type EmojiSource = CustomEmojiSource;

export interface CustomEmoji {
  id: string;
  shortcode: string;
  aliases: string[];
  imageUrl: string;
  tenantId: string | null;
  source: EmojiSource;
  bytes: number;
  createdAt: number;
}

export interface EmojiList {
  emoji: CustomEmoji[];
  used: number;
  /** `null` = unlimited, `0` = not in the plan. */
  limit: number | null;
}

export interface EmojiUpload {
  file: File;
  shortcode: string;
  aliases: string[];
  tenantId?: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

export { WEBHOOK_EVENTS } from "@emojisense/platform";
export type Tenant = TenantSummary;
export type Webhook = WebhookSummary;
export type WebhookEvent = WebhookEventType;
export type WebhookDelivery = WebhookDeliverySummary;
/** Only the create response carries the signing secret. */
export type CreatedWebhook = CreatedWebhookResponse;
