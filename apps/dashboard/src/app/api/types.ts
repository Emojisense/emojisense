/**
 * Dashboard API shapes. Everything the Worker already serves comes from src/shared/contract.ts;
 * the product routes that have not landed yet (custom emoji, tenants, webhooks) mirror the
 * product contract (v1) here until they move there too.
 */
import type { CustomEmojiSource } from "@emojisense/platform";
import type { AppSummary, MeResponse } from "../../shared/contract";

export { EMOJI_SETS, type EmojiSet, type PlanId, TEAM_ROLES, type TeamRole } from "@emojisense/platform";
export type {
  AcceptInviteResponse,
  AnalyticsDay,
  AnalyticsResponse,
  BillingResponse,
  CreatedInviteResponse,
  Role,
  TeamInviteSummary,
  TeamMemberResponse,
  TeamMemberSummary,
  TeamResponse,
  TeamSummary,
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

export interface Tenant {
  id: string;
  externalId: string;
  name: string | null;
  createdAt: number;
  emojiCount: number;
}

export const WEBHOOK_EVENTS = [
  "custom_emoji.created",
  "custom_emoji.deleted",
  "tenant.created",
  "tenant.deleted",
  "usage.threshold",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
  id: string;
  appId: string;
  url: string;
  events: WebhookEvent[];
  createdAt: number;
  disabledAt: number | null;
}

/** Only the create response carries the signing secret. */
export interface CreatedWebhook {
  webhook: Webhook;
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  /** HTTP status; `null` = network error. */
  status: number | null;
  durationMs: number | null;
  createdAt: number;
}
