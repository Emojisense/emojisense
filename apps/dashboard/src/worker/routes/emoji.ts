/**
 * Custom emoji of an app: list (every role), upload, edit, delete (developer and up). Uploads are
 * multipart forms; images go to R2 and are served by the API Worker at `imageUrl`. Uploads and
 * deletes emit custom_emoji.created / custom_emoji.deleted webhooks.
 */
import {
  CUSTOM_EMOJI_MAX_BYTES,
  type CustomEmoji,
  type CustomEmojiRow,
  countAccountCustomEmoji,
  createCustomEmoji,
  deleteCustomEmoji,
  findTenantById,
  hasCustomEmoji,
  listCustomEmoji,
  parseAliases,
  parseShortcode,
  randomId,
  type TenantRow,
  toCustomEmoji,
  updateCustomEmoji,
} from "@emojisense/platform";
import type { CustomEmojiListResponse, OkResponse } from "../../shared/contract";
import { requireAppAccess } from "../access";
import {
  apiUrlOf,
  checkedImage,
  emitEmojiEvent,
  limitOf,
  limitReached,
  requireBucket,
  shortcodeTaken,
  valid,
} from "../custom-emoji";
import type { D1Database } from "../d1";
import type { AuthedContext } from "../env";
import { HttpError, json, readCapped, readJsonObject } from "../http";
import { requirePlan } from "../plans";
import { isValidId } from "../validate";

/** The image plus the text fields of the form. */
const MAX_FORM_BYTES = CUSTOM_EMOJI_MAX_BYTES + 16 * 1024;

const tooLarge = () =>
  new HttpError(
    413,
    "image_too_large",
    `The image is larger than ${CUSTOM_EMOJI_MAX_BYTES / 1024} KB.`,
    "file",
  );

async function readUploadForm(request: Request): Promise<FormData> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(type)) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "Send the upload as multipart/form-data with the fields file, shortcode and aliases.",
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) throw tooLarge();
  const bytes = await readCapped(request.body, MAX_FORM_BYTES);
  if (!bytes) throw tooLarge();
  try {
    return await new Response(bytes, { headers: { "content-type": type } }).formData();
  } catch {
    throw new HttpError(400, "invalid_request", "The form data could not be read.");
  }
}

const textField = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

/** `tenantId` is a `tenants.id` of this app; empty or missing = app-wide. */
async function parseTenant(
  db: D1Database,
  appId: string,
  value: string | undefined,
): Promise<TenantRow | null> {
  if (value === undefined || value.trim() === "") return null;
  const tenantId = value.trim();
  const tenant = isValidId(tenantId) ? await findTenantById(db, appId, tenantId) : undefined;
  if (!tenant) throw new HttpError(400, "invalid_request", "No tenant with this id in this app.", "tenantId");
  return tenant;
}

/** The tenant's external id for webhook payloads; null for app-wide emoji. */
async function tenantExternalId(db: D1Database, row: CustomEmojiRow): Promise<string | null> {
  if (row.tenant_id === "") return null;
  return (await findTenantById(db, row.app_id, row.tenant_id))?.external_id ?? null;
}

const emojiNotFound = () => new HttpError(404, "not_found", "No custom emoji with this id in this app.");

/**
 * GET /api/apps/:id/emoji[?tenantId=] → `{ emoji, used, limit }`. Every role may list. `used`
 * counts what the limit counts: every emoji of every app of the owning account.
 */
export async function listEmoji({ url, env, account, params }: AuthedContext): Promise<Response> {
  const { app, plan } = await requireAppAccess(env.DB, account.id, params.id, "view");
  const tenantId = url.searchParams.get("tenantId");
  const [rows, used] = await Promise.all([
    listCustomEmoji(env.DB, app.id, tenantId ? { tenantId } : {}),
    countAccountCustomEmoji(env.DB, app.account_id),
  ]);
  const apiUrl = apiUrlOf(env);
  const body: CustomEmojiListResponse = {
    emoji: rows.map((row) => toCustomEmoji(row, apiUrl)),
    used,
    limit: limitOf(plan),
  };
  return json(body);
}

/** POST /api/apps/:id/emoji (multipart: file, shortcode, aliases, tenantId?) → CustomEmoji. */
export async function uploadEmoji(ctx: AuthedContext): Promise<Response> {
  const { env, deps, account, params } = ctx;
  const { app, plan } = await requireAppAccess(env.DB, account.id, params.id, "edit");
  requirePlan(plan, hasCustomEmoji, "Custom emoji");
  const bucket = requireBucket(env);
  const form = await readUploadForm(ctx.request);

  const shortcode = valid(parseShortcode(form.get("shortcode")));
  const aliases = valid(parseAliases(textField(form, "aliases")));
  const tenant = await parseTenant(env.DB, app.id, textField(form, "tenantId"));
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    throw new HttpError(400, "invalid_request", "Choose an image file to upload.", "file");
  }
  const image = checkedImage(new Uint8Array(await file.arrayBuffer()));

  const result = await createCustomEmoji(env.DB, bucket, {
    appId: app.id,
    accountId: app.account_id,
    tenantId: tenant?.id ?? null,
    shortcode,
    aliases,
    image,
    source: "upload",
    limit: plan.limits.custom_emoji,
    now: deps.now(),
    id: randomId(),
  });
  if (result.status === "shortcode_taken") throw shortcodeTaken(shortcode);
  if (result.status === "limit_reached") throw limitReached(plan);
  const apiUrl = apiUrlOf(env);
  emitEmojiEvent(
    ctx,
    "custom_emoji.created",
    app.id,
    toCustomEmoji(result.row, apiUrl, tenant?.external_id ?? null),
  );
  const body: CustomEmoji = toCustomEmoji(result.row, apiUrl);
  return json(body, 201);
}

/**
 * PATCH /api/apps/:id/emoji/:emojiId `{ shortcode?, aliases? }` → CustomEmoji. Not plan-gated:
 * after a downgrade, existing emoji can still be fixed.
 */
export async function updateEmoji({ request, env, account, params }: AuthedContext): Promise<Response> {
  const { app } = await requireAppAccess(env.DB, account.id, params.id, "edit");
  const emojiId = params.emojiId;
  if (!isValidId(emojiId)) throw emojiNotFound();
  const body = await readJsonObject(request);
  const changes: { shortcode?: string; aliases?: string[] } = {};
  if ("shortcode" in body) changes.shortcode = valid(parseShortcode(body.shortcode));
  if ("aliases" in body) changes.aliases = valid(parseAliases(body.aliases));
  if (changes.shortcode === undefined && changes.aliases === undefined) {
    throw new HttpError(400, "invalid_request", "Send a new shortcode, new aliases, or both.");
  }
  const result = await updateCustomEmoji(env.DB, app.id, emojiId, changes);
  if (result.status === "not_found") throw emojiNotFound();
  if (result.status === "shortcode_taken") throw shortcodeTaken(changes.shortcode ?? "");
  const updated: CustomEmoji = toCustomEmoji(result.row, apiUrlOf(env));
  return json(updated);
}

/** DELETE /api/apps/:id/emoji/:emojiId → `{ ok: true }`. Allowed on every plan, so a downgrade can clean up. */
export async function deleteEmoji(ctx: AuthedContext): Promise<Response> {
  const { env, account, params } = ctx;
  const { app } = await requireAppAccess(env.DB, account.id, params.id, "edit");
  const emojiId = params.emojiId;
  if (!isValidId(emojiId)) throw emojiNotFound();
  const deleted = await deleteCustomEmoji(env.DB, requireBucket(env), app.id, emojiId);
  if (!deleted) throw emojiNotFound();
  emitEmojiEvent(
    ctx,
    "custom_emoji.deleted",
    app.id,
    toCustomEmoji(deleted, apiUrlOf(env), await tenantExternalId(env.DB, deleted)),
  );
  const body: OkResponse = { ok: true };
  return json(body);
}
