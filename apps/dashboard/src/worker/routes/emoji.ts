/**
 * Custom emoji of an app: list (every role), upload, edit, delete (developer and up). Uploads are
 * multipart forms; images go to R2 and are served by the API Worker at `imageUrl`.
 */
import {
  CUSTOM_EMOJI_MAX_BYTES,
  type CustomEmoji,
  countCustomEmoji,
  createCustomEmoji,
  deleteCustomEmoji,
  hasCustomEmoji,
  listCustomEmoji,
  parseAliases,
  parseShortcode,
  randomId,
  toCustomEmoji,
  updateCustomEmoji,
  validateEmojiImage,
} from "@emojisense/platform";
import type { CustomEmojiListResponse, OkResponse } from "../../shared/contract";
import { requireAppAccess } from "../access";
import {
  apiUrlOf,
  limitOf,
  limitReached,
  readCapped,
  requireBucket,
  shortcodeTaken,
  validated,
} from "../custom-emoji";
import type { D1Database } from "../d1";
import type { AuthedContext } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { requirePlan } from "../plans";
import { isValidId } from "../validate";

/** The image plus the text fields of the form. */
const MAX_FORM_BYTES = CUSTOM_EMOJI_MAX_BYTES + 16 * 1024;

const tooLarge = () =>
  new HttpError(
    413,
    "file_too_large",
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
async function parseTenantId(
  db: D1Database,
  appId: string,
  value: string | undefined,
): Promise<string | null> {
  if (value === undefined || value.trim() === "") return null;
  const tenantId = value.trim();
  const tenant = isValidId(tenantId)
    ? await db.prepare("SELECT id FROM tenants WHERE id = ? AND app_id = ?").bind(tenantId, appId).first()
    : null;
  if (!tenant) throw new HttpError(400, "invalid_request", "No tenant with this id in this app.", "tenantId");
  return tenantId;
}

const emojiNotFound = () => new HttpError(404, "not_found", "No custom emoji with this id in this app.");

/** GET /api/apps/:id/emoji[?tenantId=] → `{ emoji, used, limit }`. Every role may list. */
export async function listEmoji({ url, env, account, params }: AuthedContext): Promise<Response> {
  const { app, plan } = await requireAppAccess(env.DB, account.id, params.id, "view");
  const tenantId = url.searchParams.get("tenantId");
  const [rows, used] = await Promise.all([
    listCustomEmoji(env.DB, app.id, tenantId ? { tenantId } : {}),
    countCustomEmoji(env.DB, app.id),
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

  const shortcode = validated(() => parseShortcode(form.get("shortcode")));
  const aliases = validated(() => parseAliases(textField(form, "aliases")));
  const tenantId = await parseTenantId(env.DB, app.id, textField(form, "tenantId"));
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    throw new HttpError(400, "invalid_request", "Choose an image file to upload.", "file");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = validated(() => validateEmojiImage(bytes));

  const result = await createCustomEmoji(env.DB, bucket, {
    appId: app.id,
    tenantId,
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
  const body: CustomEmoji = toCustomEmoji(result.row, apiUrlOf(env));
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
  if ("shortcode" in body) changes.shortcode = validated(() => parseShortcode(body.shortcode));
  if ("aliases" in body) changes.aliases = validated(() => parseAliases(body.aliases));
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
export async function deleteEmoji({ env, account, params }: AuthedContext): Promise<Response> {
  const { app } = await requireAppAccess(env.DB, account.id, params.id, "edit");
  const emojiId = params.emojiId;
  if (!isValidId(emojiId)) throw emojiNotFound();
  const deleted = await deleteCustomEmoji(env.DB, requireBucket(env), app.id, emojiId);
  if (!deleted) throw emojiNotFound();
  const body: OkResponse = { ok: true };
  return json(body);
}
