/**
 * The internal Culture page's API (culture Phase 2). Only accounts whose verified email is in
 * ADMIN_EMAILS get past `requireAdmin`; everyone else sees 404, as if the routes did not exist.
 * The API Worker does the work (validation, gate, previews, R2 publishing) behind its
 * `CultureAdmin` RPC entrypoint, reached through the CULTURE_ADMIN service binding.
 */
import {
  CULTURE_PROPOSAL_STATUSES,
  type CultureAdminResult,
  type CultureAdminRpc,
  type CultureEntryRecord,
  type CultureProposalStatus,
  type CultureReviewer,
} from "@emojisense/platform";
import type { AdminStatusResponse } from "../../shared/contract";
import type { AuthedContext, Env } from "../env";
import { HttpError, json, readJsonObject } from "../http";

/** ADMIN_EMAILS: comma-separated, compared in lower case with the verified email claim. */
export function adminEmails(env: Pick<Env, "ADMIN_EMAILS">): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes("@")),
  );
}

export function isAdmin(ctx: Pick<AuthedContext, "env" | "verifiedEmail">): boolean {
  return ctx.verifiedEmail !== null && adminEmails(ctx.env).has(ctx.verifiedEmail.toLowerCase());
}

const notFound = () => new HttpError(404, "not_found", "No API route matches this request.");

/** The culture service, for an admin only. Logs the refusal reason, never the email. */
function requireAdmin(ctx: AuthedContext): CultureAdminRpc {
  if (!isAdmin(ctx)) {
    console.warn(
      JSON.stringify({ level: "warn", event: "admin_refused", verifiedEmail: ctx.verifiedEmail !== null }),
    );
    throw notFound();
  }
  const service = ctx.env.CULTURE_ADMIN;
  if (!service) {
    throw new HttpError(
      503,
      "culture_unavailable",
      "The culture service is not bound. Add the CULTURE_ADMIN service binding (dashboard README).",
    );
  }
  return service;
}

/** The editor as entries record them: the account's name, else the local part of its email. */
function reviewerOf({ account, verifiedEmail }: AuthedContext): CultureReviewer {
  const name = account.name?.trim() || (verifiedEmail ?? account.email ?? "editor").split("@")[0] || "editor";
  return { accountId: account.id, name };
}

const STATUS_OF: Record<string, number> = { not_found: 404, conflict: 409, invalid: 422, unavailable: 503 };

function unwrap<T>(result: CultureAdminResult<T>): T {
  if (result.ok) return result.value;
  throw new HttpError(STATUS_OF[result.code] ?? 400, result.code, result.message);
}

function readRecord(body: Record<string, unknown>, required: boolean): CultureEntryRecord | undefined {
  const record = body.record;
  if (record === undefined && !required) return undefined;
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    throw new HttpError(400, "invalid_request", "record must be a culture entry object.", "record");
  }
  return record as CultureEntryRecord;
}

function readReason(body: Record<string, unknown>): string | undefined {
  if (body.reason === undefined || body.reason === null) return undefined;
  if (typeof body.reason !== "string")
    throw new HttpError(400, "invalid_request", "reason must be text.", "reason");
  return body.reason;
}

/** GET /api/admin: whether the Culture page shows. Always 200 for a signed-in account. */
export async function getAdminStatus(ctx: AuthedContext): Promise<Response> {
  const admin = isAdmin(ctx);
  const body: AdminStatusResponse = { admin, culture: admin && Boolean(ctx.env.CULTURE_ADMIN) };
  return json(body);
}

export async function getCultureOverview(ctx: AuthedContext): Promise<Response> {
  const service = requireAdmin(ctx);
  const raw = ctx.url.searchParams.get("status");
  const status = (CULTURE_PROPOSAL_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as CultureProposalStatus)
    : undefined;
  return json(await service.overview(status ? { status } : {}));
}

export async function getCultureProposal(ctx: AuthedContext): Promise<Response> {
  return json(unwrap(await requireAdmin(ctx).proposal(ctx.params.id ?? "")));
}

export async function previewCultureEntry(ctx: AuthedContext): Promise<Response> {
  const service = requireAdmin(ctx);
  const record = readRecord(await readJsonObject(ctx.request), true) as CultureEntryRecord;
  return json(await service.preview(record));
}

export async function updateCultureProposal(ctx: AuthedContext): Promise<Response> {
  const service = requireAdmin(ctx);
  const record = readRecord(await readJsonObject(ctx.request), true) as CultureEntryRecord;
  return json(unwrap(await service.update(ctx.params.id ?? "", record, reviewerOf(ctx))));
}

export async function approveCultureProposal(ctx: AuthedContext): Promise<Response> {
  const service = requireAdmin(ctx);
  const body = await readJsonObject(ctx.request);
  const record = readRecord(body, false);
  const reason = readReason(body);
  const result = await service.approve(ctx.params.id ?? "", {
    reviewer: reviewerOf(ctx),
    ...(reason ? { reason } : {}),
    ...(record ? { record } : {}),
  });
  return json(unwrap(result));
}

export async function rejectCultureProposal(ctx: AuthedContext): Promise<Response> {
  const service = requireAdmin(ctx);
  const reason = readReason(await readJsonObject(ctx.request)) ?? "";
  return json(unwrap(await service.reject(ctx.params.id ?? "", { reviewer: reviewerOf(ctx), reason })));
}

export async function retireCultureEntry(ctx: AuthedContext): Promise<Response> {
  const service = requireAdmin(ctx);
  const reason = readReason(await readJsonObject(ctx.request)) ?? "";
  return json(unwrap(await service.retire(ctx.params.id ?? "", { reviewer: reviewerOf(ctx), reason })));
}

export async function publishCulture(ctx: AuthedContext): Promise<Response> {
  const report = await requireAdmin(ctx).publish();
  console.log(JSON.stringify({ event: "culture_publish_requested", status: report.status }));
  return json(report, report.status === "failed" ? 502 : 200);
}

/** The approved live entries for `culture:import-live`, which writes them to git. */
export async function exportCulture(ctx: AuthedContext): Promise<Response> {
  const service = requireAdmin(ctx);
  const body = await readJsonObject(ctx.request);
  const exported = await service.exportLive({ markExported: body.markExported === true });
  return json(exported, 200, { "content-disposition": 'attachment; filename="culture-live-export.json"' });
}
