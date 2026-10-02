/**
 * Import custom emoji from Slack (user token) or Discord (bot token + server id), Pro and up.
 * The token lives only for the request: it is never stored, logged or echoed.
 *
 * One call stores at most {@link IMPORT_BATCH} new emoji, so it stays well inside the Worker's
 * subrequest and time limits. The answer says how many wait (`remaining`); the client calls
 * again, and emoji imported by an earlier call then count as `exists`. Each imported emoji emits
 * custom_emoji.created, like an upload.
 */
import {
  CUSTOM_EMOJI_MAX_BYTES,
  type CustomEmojiSource,
  countAccountCustomEmoji,
  createCustomEmoji,
  type EmojiBucket,
  hasEmojiImport,
  inspectEmojiImage,
  listCustomEmoji,
  type Plan,
  parseShortcode,
  randomId,
  toCustomEmoji,
} from "@emojisense/platform";
import type { EmojiImportResponse, EmojiImportSkipReason } from "../../shared/contract";
import { requireAppAccess } from "../access";
import { apiUrlOf, emitEmojiEvent, readCapped, requireBucket } from "../custom-emoji";
import {
  type EmojiCandidate,
  type EmojiListing,
  isProviderImageUrl,
  listDiscordEmoji,
  listSlackEmoji,
  parseDiscordInput,
  parseSlackToken,
} from "../emoji-sources";
import type { AuthedContext, Deps } from "../env";
import { json, readJsonObject } from "../http";
import { requirePlan } from "../plans";

/** New emoji stored per call. */
export const IMPORT_BATCH = 50;
/** Parallel image downloads per call. */
const DOWNLOAD_CONCURRENCY = 6;
const DOWNLOAD_TIMEOUT_MS = 10_000;

type Outcome = "imported" | EmojiImportSkipReason;

async function download(fetch: Deps["fetch"], url: string): Promise<Uint8Array | "failed" | "too_large"> {
  if (!isProviderImageUrl(url)) return "failed";
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) return "failed";
    return (await readCapped(response.body, CUSTOM_EMOJI_MAX_BYTES)) ?? "too_large";
  } catch {
    return "failed";
  }
}

interface ImportJob {
  ctx: AuthedContext;
  appId: string;
  /** The account that owns the app: the limit counts all of its apps. */
  accountId: string;
  /** The owner's plan. */
  plan: Plan;
  bucket: EmojiBucket;
  source: CustomEmojiSource;
}

async function importOne(job: ImportJob, shortcode: string, url: string): Promise<Outcome> {
  const { ctx, appId, accountId, plan, bucket, source } = job;
  const bytes = await download(ctx.deps.fetch, url);
  if (bytes === "failed") return "failed";
  if (bytes === "too_large") return "invalid";
  const checked = inspectEmojiImage(bytes);
  if (!checked.ok) return "invalid";
  const result = await createCustomEmoji(ctx.env.DB, bucket, {
    appId,
    accountId,
    tenantId: null,
    shortcode,
    aliases: [],
    image: checked.image,
    source,
    limit: plan.limits.custom_emoji,
    now: ctx.deps.now(),
    id: randomId(),
  });
  if (result.status === "shortcode_taken") return "exists";
  if (result.status === "limit_reached") return "limit";
  emitEmojiEvent(ctx, "custom_emoji.created", appId, toCustomEmoji(result.row, apiUrlOf(ctx.env), null));
  return "imported";
}

/** Shortcode rules, duplicates and the plan limit decide what is tried; then a batch is stored. */
export async function runImport(job: ImportJob, listing: EmojiListing): Promise<EmojiImportResponse> {
  const { ctx, appId, accountId, plan } = job;
  const skippedBy: Record<EmojiImportSkipReason, number> = {
    alias: listing.aliases,
    exists: 0,
    invalid: listing.invalid,
    limit: 0,
    failed: 0,
  };
  const existing = new Set(
    (await listCustomEmoji(ctx.env.DB, appId, { tenantId: null })).map((row) => row.shortcode),
  );
  const queue: { shortcode: string; url: string }[] = [];
  // Code-unit order, not locale order: the same list imports the same way on every runtime.
  const byName = (a: EmojiCandidate, b: EmojiCandidate) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const candidate of [...listing.candidates].sort(byName)) {
    const shortcode = parseShortcode(candidate.name);
    if (!shortcode.ok) skippedBy.invalid++;
    else if (existing.has(shortcode.value)) skippedBy.exists++;
    else {
      existing.add(shortcode.value);
      queue.push({ shortcode: shortcode.value, url: candidate.url });
    }
  }

  const used = await countAccountCustomEmoji(ctx.env.DB, accountId);
  const room = Math.max(0, plan.limits.custom_emoji - used);
  const fits = queue.slice(0, room);
  skippedBy.limit += queue.length - fits.length;
  const batch = fits.slice(0, IMPORT_BATCH);

  let imported = 0;
  for (let i = 0; i < batch.length; i += DOWNLOAD_CONCURRENCY) {
    const outcomes = await Promise.all(
      batch.slice(i, i + DOWNLOAD_CONCURRENCY).map((item) => importOne(job, item.shortcode, item.url)),
    );
    for (const outcome of outcomes) {
      if (outcome === "imported") imported++;
      else skippedBy[outcome]++;
    }
  }
  const skipped = Object.values(skippedBy).reduce((sum, n) => sum + n, 0);
  return { imported, skipped, remaining: fits.length - batch.length, skippedBy };
}

/** Developer role, a plan with imports (Pro and up), and the R2 binding. */
async function prepare(ctx: AuthedContext, source: CustomEmojiSource): Promise<ImportJob> {
  const { app, plan } = await requireAppAccess(ctx.env.DB, ctx.account.id, ctx.params.id, "edit");
  requirePlan(plan, hasEmojiImport, "Slack and Discord import");
  return { ctx, appId: app.id, accountId: app.account_id, plan, bucket: requireBucket(ctx.env), source };
}

/** POST /api/apps/:id/emoji/import/slack `{ token }` → `{ imported, skipped, remaining, skippedBy }`. */
export async function importSlackEmoji(ctx: AuthedContext): Promise<Response> {
  const job = await prepare(ctx, "slack");
  const token = parseSlackToken((await readJsonObject(ctx.request)).token);
  return json(await runImport(job, await listSlackEmoji(ctx.deps.fetch, token)));
}

/** POST /api/apps/:id/emoji/import/discord `{ botToken, guildId }` → like the Slack import. */
export async function importDiscordEmoji(ctx: AuthedContext): Promise<Response> {
  const job = await prepare(ctx, "discord");
  const { botToken, guildId } = parseDiscordInput(await readJsonObject(ctx.request));
  return json(await runImport(job, await listDiscordEmoji(ctx.deps.fetch, botToken, guildId)));
}
