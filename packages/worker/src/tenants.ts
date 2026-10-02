/**
 * Tenants API (Scale, docs/API.md "Tenants"): the app owner's server manages its own customers
 * and their custom emoji with a secret key (`Authorization: Bearer sk_live_…`).
 *
 *   GET    /v1/tenants                              list (cursor pages, with emojiCount)
 *   POST   /v1/tenants                              create, or return the existing tenant
 *   DELETE /v1/tenants/:externalId                  delete, with its custom emoji
 *   GET    /v1/tenants/:externalId/emoji            list the tenant's custom emoji
 *   POST   /v1/tenants/:externalId/emoji            multipart upload: file, shortcode, aliases
 *   DELETE /v1/tenants/:externalId/emoji/:shortcode delete one
 *
 * Tenant writes emit tenant.* and custom_emoji.* webhook events.
 */
import {
  type AppOwner,
  CUSTOM_EMOJI_MAX_BYTES,
  countAccountCustomEmoji,
  countTenantEmoji,
  createCustomEmoji,
  createTenant,
  deleteCustomEmojiByShortcode,
  deleteTenant,
  emitWebhookEvent as emit,
  findTenantByExternalId,
  inspectEmojiImage,
  listCustomEmoji,
  listTenants,
  loadAppOwner,
  lowestPlanFor,
  type Parsed,
  parseAliases,
  parseExternalId,
  parsePageLimit,
  parseShortcode,
  parseTenantName,
  planAllows,
  planRequiredMessage,
  randomId,
  type TenantRow,
  toCustomEmoji,
  toTenant,
  type WebhookRuntime,
} from "@emojisense/platform";
import type { Principal } from "./auth.ts";
import type { Env } from "./env.ts";
import { json, readBodyCapped } from "./http.ts";

const MAX_JSON_BYTES = 16 * 1024;
/** One image plus the multipart framing and the text fields. */
const MAX_UPLOAD_BYTES = CUSTOM_EMOJI_MAX_BYTES + 16 * 1024;

export function isTenantsPath(pathname: string): boolean {
  return pathname === "/v1/tenants" || pathname.startsWith("/v1/tenants/");
}

export interface TenantsContext {
  request: Request;
  url: URL;
  env: Env;
  principal: Principal;
  /** Undefined without a database; events are then not sent. */
  webhooks: WebhookRuntime | undefined;
  now: () => number;
}

/** Structured error: `{ error: "<code>", message, …extra }`. */
function apiError(status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  return json({ error, message, ...extra }, status, { "Cache-Control": "no-store" });
}

function invalid(parsed: Extract<Parsed<unknown>, { ok: false }>) {
  return apiError(400, "invalid_request", parsed.message, { field: parsed.field });
}

type RouteName = "list" | "create" | "delete" | "listEmoji" | "uploadEmoji" | "deleteEmoji";

/** Matches the path and method; a Response means 404 or 405. */
function matchRoute(request: Request, url: URL): { name: RouteName; params: string[] } | Response {
  let params: string[];
  try {
    params = url.pathname.split("/").slice(3).map(decodeURIComponent);
  } catch {
    return apiError(404, "not_found", "No API route matches this path.");
  }
  const shape = params.map((p, i) => (i === 1 && p === "emoji" ? "emoji" : p === "" ? "" : ":")).join("/");
  const routes: Record<string, Partial<Record<string, RouteName>>> = {
    "": { GET: "list", POST: "create" },
    ":": { DELETE: "delete" },
    ":/emoji": { GET: "listEmoji", POST: "uploadEmoji" },
    ":/emoji/:": { DELETE: "deleteEmoji" },
  };
  const methods = routes[shape];
  if (!methods) return apiError(404, "not_found", "No API route matches this path.");
  const name = methods[request.method];
  if (!name) {
    const allow = Object.keys(methods).join(", ");
    return json({ error: "method_not_allowed", message: `Use ${allow} for this path.` }, 405, {
      Allow: allow,
      "Cache-Control": "no-store",
    });
  }
  return { name, params };
}

export async function handleTenants(context: TenantsContext): Promise<Response> {
  const { request, url, env, principal } = context;
  const route = matchRoute(request, url);
  if (route instanceof Response) return route;

  if (principal.kind === "anonymous") {
    // A key was sent but could not be checked: the key store is down.
    if (request.headers.has("Authorization")) {
      return apiError(503, "unavailable", "The key store is unavailable. Retry in a few seconds.");
    }
    return apiError(401, "unauthorized", "Send a secret key: Authorization: Bearer sk_live_…");
  }
  if (principal.key.kind !== "secret") {
    return apiError(403, "secret_key_required", "The tenants API needs a secret key, sent from a server.");
  }
  const db = env.DB;
  if (!db) return apiError(503, "unavailable", "The database is unavailable.");
  const owner = await loadAppOwner(db, principal.key.appId);
  if (!owner) {
    return apiError(
      403,
      "development_key",
      "Development keys cannot manage tenants. Create a secret key in the dashboard.",
    );
  }
  if (!planAllows(owner.plan, "tenants")) {
    return apiError(402, "plan_required", planRequiredMessage("tenants"), {
      plan: lowestPlanFor("tenants"),
    });
  }

  // The custom emoji limit counts the account the key belongs to (every app it owns).
  const scoped: Scoped = { ...context, db, owner, accountId: principal.key.accountId };
  const [externalId = "", , shortcode = ""] = route.params;
  switch (route.name) {
    case "list":
      return list(scoped);
    case "create":
      return create(scoped);
    case "delete":
      return withTenant(scoped, externalId, (tenant) => remove(scoped, tenant));
    case "listEmoji":
      return withTenant(scoped, externalId, (tenant) => listEmoji(scoped, tenant));
    case "uploadEmoji":
      return withTenant(scoped, externalId, (tenant) => uploadEmoji(scoped, tenant));
    case "deleteEmoji":
      return withTenant(scoped, externalId, (tenant) => deleteEmoji(scoped, tenant, shortcode));
  }
}

type Scoped = TenantsContext & { db: D1Database; owner: AppOwner; accountId: string };

async function withTenant(
  scoped: Scoped,
  externalId: string,
  handler: (tenant: TenantRow) => Promise<Response>,
): Promise<Response> {
  const tenant = parseExternalId(externalId).ok
    ? await findTenantByExternalId(scoped.db, scoped.owner.appId, externalId)
    : undefined;
  if (!tenant) return apiError(404, "tenant_not_found", "No tenant with this externalId in this app.");
  return handler(tenant);
}

function emitEvent(scoped: Scoped, type: Parameters<typeof emit>[1]["type"], data: unknown): void {
  if (scoped.webhooks) emit(scoped.webhooks, { type, appId: scoped.owner.appId, data });
}

async function list({ db, owner, url }: Scoped): Promise<Response> {
  const cursor = url.searchParams.get("cursor");
  const page = await listTenants(db, owner.appId, {
    limit: parsePageLimit(url.searchParams.get("limit")),
    cursor: cursor || null,
  });
  return json(page, 200, { "Cache-Control": "no-store" });
}

async function create(scoped: Scoped): Promise<Response> {
  const body = await readJsonObject(scoped.request);
  if (body instanceof Response) return body;
  const externalId = parseExternalId(body.externalId);
  if (!externalId.ok) return invalid(externalId);
  const name = parseTenantName(body.name);
  if (!name.ok) return invalid(name);

  const { tenant, created } = await createTenant(scoped.db, {
    appId: scoped.owner.appId,
    externalId: externalId.value,
    name: name.value,
    now: scoped.now(),
  });
  if (created) emitEvent(scoped, "tenant.created", toTenant(tenant));
  const emojiCount = created ? 0 : await countTenantEmoji(scoped.db, tenant);
  return json(toTenant(tenant, emojiCount), created ? 201 : 200, { "Cache-Control": "no-store" });
}

async function remove(scoped: Scoped, tenant: TenantRow): Promise<Response> {
  const { emojiDeleted } = await deleteTenant(scoped.db, scoped.env.EMOJI, tenant);
  emitEvent(scoped, "tenant.deleted", { ...toTenant(tenant), emojiDeleted });
  return json({ tenant: toTenant(tenant), emojiDeleted }, 200, { "Cache-Control": "no-store" });
}

const storageUnavailable = () =>
  apiError(503, "storage_unavailable", "Custom emoji storage is not configured.");

const apiUrl = (scoped: Scoped) => scoped.env.API_URL || scoped.url.origin;

async function listEmoji(scoped: Scoped, tenant: TenantRow): Promise<Response> {
  if (!scoped.env.EMOJI) return storageUnavailable();
  const rows = await listCustomEmoji(scoped.db, tenant.app_id, { tenantId: tenant.id, order: "shortcode" });
  const used = await countAccountCustomEmoji(scoped.db, scoped.accountId);
  return json(
    {
      emoji: rows.map((row) => toCustomEmoji(row, apiUrl(scoped), tenant.external_id)),
      used,
      limit: scoped.owner.plan.limits.custom_emoji,
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function uploadEmoji(scoped: Scoped, tenant: TenantRow): Promise<Response> {
  const bucket = scoped.env.EMOJI;
  if (!bucket) return storageUnavailable();
  const form = await readMultipart(scoped.request);
  if (form instanceof Response) return form;

  const file = form.get("file");
  if (file === null || typeof file === "string") {
    return apiError(400, "invalid_request", "Add the image as the multipart field `file`.", {
      field: "file",
    });
  }
  const shortcode = parseShortcode(form.get("shortcode"));
  if (!shortcode.ok) return invalid(shortcode);
  const aliases = parseAliases(form.get("aliases") ?? undefined);
  if (!aliases.ok) return invalid(aliases);
  const checked = inspectEmojiImage(new Uint8Array(await file.arrayBuffer()));
  if (!checked.ok) {
    return apiError(checked.status, checked.error, checked.message, { field: checked.field });
  }

  const result = await createCustomEmoji(scoped.db, bucket, {
    appId: tenant.app_id,
    accountId: scoped.accountId,
    limit: scoped.owner.plan.limits.custom_emoji,
    tenantId: tenant.id,
    shortcode: shortcode.value,
    aliases: aliases.value,
    image: checked.image,
    source: "api",
    now: scoped.now(),
    id: randomId(),
  });
  if (result.status === "shortcode_taken") {
    return apiError(409, "shortcode_taken", `This tenant already has :${shortcode.value}:.`, {
      field: "shortcode",
    });
  }
  if (result.status === "limit_reached") {
    return apiError(
      403,
      "plan_limit",
      `Your ${scoped.owner.plan.name} plan allows ${result.limit} custom emoji across all apps, and all are used.`,
      { used: result.used, limit: result.limit },
    );
  }
  const emoji = toCustomEmoji(result.row, apiUrl(scoped), tenant.external_id);
  emitEvent(scoped, "custom_emoji.created", emoji);
  return json(emoji, 201, { "Cache-Control": "no-store" });
}

async function deleteEmoji(scoped: Scoped, tenant: TenantRow, rawShortcode: string): Promise<Response> {
  if (!scoped.env.EMOJI) return storageUnavailable();
  const shortcode = parseShortcode(rawShortcode);
  const deleted = shortcode.ok
    ? await deleteCustomEmojiByShortcode(
        scoped.db,
        scoped.env.EMOJI,
        tenant.app_id,
        tenant.id,
        shortcode.value,
      )
    : undefined;
  if (!deleted)
    return apiError(404, "emoji_not_found", "This tenant has no custom emoji with this shortcode.");
  const emoji = toCustomEmoji(deleted, apiUrl(scoped), tenant.external_id);
  emitEvent(scoped, "custom_emoji.deleted", emoji);
  return json(emoji, 200, { "Cache-Control": "no-store" });
}

// --- Bodies -----------------------------------------------------------------------------------

async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
    return apiError(415, "unsupported_media_type", "Send a JSON body with Content-Type: application/json.");
  }
  const bytes = await readBodyCapped(request, MAX_JSON_BYTES);
  if (!bytes) return apiError(413, "body_too_large", "The request body is larger than 16 KB.");
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return apiError(400, "invalid_json", "The request body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError(400, "invalid_request", "The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

/** Reads at most MAX_UPLOAD_BYTES before parsing, so a huge upload is refused without buffering it. */
async function readMultipart(request: Request): Promise<FormData | Response> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(type)) {
    return apiError(415, "unsupported_media_type", "Send the image as multipart/form-data.");
  }
  const bytes = await readBodyCapped(request, MAX_UPLOAD_BYTES);
  if (!bytes) return apiError(413, "image_too_large", "The image is larger than 256 KB.", { field: "file" });
  try {
    return await new Response(bytes, { headers: { "content-type": type } }).formData();
  } catch {
    return apiError(400, "invalid_multipart", "The multipart body could not be read.");
  }
}
