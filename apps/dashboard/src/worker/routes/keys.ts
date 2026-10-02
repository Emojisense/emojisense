import { displayPrefix, generateKey, hashKey, randomId } from "@emojisense/platform";
import type { CreatedKeyResponse, KeyResponse } from "../../shared/contract";
import { requireAppAccess, requireKeyAccess } from "../access";
import type { AuthedContext } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { assertOriginPolicy, parseAllowedOrigins } from "../origins";
import { toKeySummary } from "../records";
import { parseKeyKind } from "../validate";

/** The response is the only place the full key ever appears. Only its hash is stored. */
export async function createKey({ request, env, deps, account, params }: AuthedContext): Promise<Response> {
  const { app } = await requireAppAccess(env.DB, account.id, params.id, "edit");
  const body = await readJsonObject(request);
  const kind = parseKeyKind(body.kind);
  const allowedOrigins = parseAllowedOrigins(body.allowedOrigins);
  assertOriginPolicy(kind, app.environment, allowedOrigins);

  const fullKey = generateKey(kind);
  const row = {
    id: randomId(),
    app_id: app.id,
    kind,
    prefix: displayPrefix(fullKey),
    hash: await hashKey(fullKey),
    allowed_origins: JSON.stringify(allowedOrigins),
    created_at: deps.now(),
    revoked_at: null,
  };
  await env.DB.prepare(
    `INSERT INTO api_keys (id, app_id, kind, prefix, hash, allowed_origins, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.app_id, row.kind, row.prefix, row.hash, row.allowed_origins, row.created_at)
    .run();

  const response: CreatedKeyResponse = { key: toKeySummary(row), fullKey };
  return json(response, 201);
}

/** Only the allowed origins of an active publishable key can change. */
export async function updateKey({ request, env, account, params }: AuthedContext): Promise<Response> {
  const { key, access } = await requireKeyAccess(env.DB, account.id, params.id, "edit");
  const body = await readJsonObject(request);
  if (!("allowedOrigins" in body)) {
    throw new HttpError(400, "invalid_request", "allowedOrigins is required.", "allowedOrigins");
  }
  if (key.revoked_at !== null)
    throw new HttpError(409, "key_revoked", "This key is revoked and cannot change.");
  if (key.kind === "secret") {
    throw new HttpError(400, "invalid_request", "Secret keys have no allowed origins.", "allowedOrigins");
  }
  const allowedOrigins = parseAllowedOrigins(body.allowedOrigins);
  assertOriginPolicy(key.kind, access.app.environment, allowedOrigins);

  const encoded = JSON.stringify(allowedOrigins);
  await env.DB.prepare("UPDATE api_keys SET allowed_origins = ? WHERE id = ?").bind(encoded, key.id).run();
  const response: KeyResponse = { key: toKeySummary({ ...key, allowed_origins: encoded }) };
  return json(response);
}

/** Revoking twice is harmless and keeps the first revocation time. */
export async function revokeKey({ env, deps, account, params }: AuthedContext): Promise<Response> {
  const { key } = await requireKeyAccess(env.DB, account.id, params.id, "edit");
  const revokedAt = key.revoked_at ?? deps.now();
  if (key.revoked_at === null) {
    await env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(revokedAt, key.id)
      .run();
  }
  const response: KeyResponse = { key: toKeySummary({ ...key, revoked_at: revokedAt }) };
  return json(response);
}
