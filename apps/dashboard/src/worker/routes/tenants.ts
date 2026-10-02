/**
 * Tenants (Scale): the app owner's own customers, each with its own custom emoji. The public API
 * manages them by external id (`/v1/tenants`); the dashboard lists, creates and deletes them by id.
 * Creates and deletes emit tenant.created / tenant.deleted webhooks.
 */
import {
  countTenantEmoji,
  createTenant,
  deleteTenant,
  emitWebhookEvent,
  findTenantById,
  listTenants,
  type Parsed,
  parseExternalId,
  parsePageLimit,
  parseTenantName,
  planAllows,
  type TenantRow,
  toTenant,
} from "@emojisense/platform";
import type {
  DeletedTenantResponse,
  TenantResponse,
  TenantSummary,
  TenantsResponse,
} from "../../shared/contract";
import { type AppAccess, type Permission, requireAppAccess } from "../access";
import type { AuthedContext } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { requirePlan } from "../plans";
import { isValidId } from "../validate";
import { webhookRuntime } from "../webhook-runtime";

/** Access to the app (404 / 403), then the owner's plan (402). */
async function requireTenantsAccess(ctx: AuthedContext, permission: Permission): Promise<AppAccess> {
  const access = await requireAppAccess(ctx.env.DB, ctx.account.id, ctx.params.id, permission);
  requirePlan(access.plan, (plan) => planAllows(plan, "tenants"), "Tenants");
  return access;
}

function valid<T>(parsed: Parsed<T>): T {
  if (parsed.ok) return parsed.value;
  throw new HttpError(400, "invalid_request", parsed.message, parsed.field);
}

const tenantNotFound = () => new HttpError(404, "not_found", "No tenant with this id in this app.");

async function requireTenant(ctx: AuthedContext, appId: string): Promise<TenantRow> {
  const tenantId = ctx.params.tenantId;
  const tenant = isValidId(tenantId) ? await findTenantById(ctx.env.DB, appId, tenantId) : undefined;
  if (!tenant) throw tenantNotFound();
  return tenant;
}

const summary = (row: TenantRow, emojiCount: number): TenantSummary =>
  toTenant(row, emojiCount) as TenantSummary;

export async function listAppTenants(ctx: AuthedContext): Promise<Response> {
  const { app } = await requireTenantsAccess(ctx, "view");
  const page = await listTenants(ctx.env.DB, app.id, {
    limit: parsePageLimit(ctx.url.searchParams.get("limit")),
    cursor: ctx.url.searchParams.get("cursor") || null,
  });
  const body: TenantsResponse = { tenants: page.tenants as TenantSummary[], nextCursor: page.nextCursor };
  return json(body);
}

export async function getAppTenant(ctx: AuthedContext): Promise<Response> {
  const { app } = await requireTenantsAccess(ctx, "view");
  const tenant = await requireTenant(ctx, app.id);
  const body: TenantResponse = { tenant: summary(tenant, await countTenantEmoji(ctx.env.DB, tenant)) };
  return json(body);
}

/** `{ externalId, name? }`. Unlike the public API, a taken externalId is a 409, not the old tenant. */
export async function createAppTenant(ctx: AuthedContext): Promise<Response> {
  const { app } = await requireTenantsAccess(ctx, "edit");
  const input = await readJsonObject(ctx.request);
  const externalId = valid(parseExternalId(input.externalId));
  const name = valid(parseTenantName(input.name));
  const { tenant, created } = await createTenant(ctx.env.DB, {
    appId: app.id,
    externalId,
    name,
    now: ctx.deps.now(),
  });
  if (!created) {
    throw new HttpError(
      409,
      "tenant_exists",
      "This app already has a tenant with this externalId.",
      "externalId",
    );
  }
  emitWebhookEvent(webhookRuntime(ctx), { type: "tenant.created", appId: app.id, data: toTenant(tenant) });
  const body: TenantResponse = { tenant: summary(tenant, 0) };
  return json(body, 201);
}

/** Deletes the tenant with its custom emoji rows and images. */
export async function deleteAppTenant(ctx: AuthedContext): Promise<Response> {
  const { app } = await requireTenantsAccess(ctx, "edit");
  const tenant = await requireTenant(ctx, app.id);
  const emojiCount = await countTenantEmoji(ctx.env.DB, tenant);
  const { emojiDeleted } = await deleteTenant(ctx.env.DB, ctx.env.EMOJI, tenant);
  emitWebhookEvent(webhookRuntime(ctx), {
    type: "tenant.deleted",
    appId: app.id,
    data: { ...toTenant(tenant), emojiDeleted },
  });
  const body: DeletedTenantResponse = { tenant: summary(tenant, emojiCount), emojiDeleted };
  return json(body);
}
