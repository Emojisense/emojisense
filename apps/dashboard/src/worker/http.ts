import type { ApiErrorBody } from "../shared/contract";

/** An error with a status, a stable code and a message that is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const merged = new Headers(JSON_HEADERS);
  new Headers(headers).forEach((value, name) => {
    merged.append(name, value);
  });
  return new Response(JSON.stringify(data), { status, headers: merged });
}

export function errorJson(error: HttpError, headers: HeadersInit = {}): Response {
  const body: ApiErrorBody = {
    error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) },
  };
  const extra = new Headers(headers);
  if (error.status === 429) extra.set("retry-after", "60");
  return json(body, error.status, extra);
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

const MAX_BODY_BYTES = 16 * 1024;

/** Reads a JSON object body. Requiring the JSON content type also forces a CORS preflight. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "Send a JSON body with Content-Type: application/json.",
    );
  }
  const tooLarge = new HttpError(413, "body_too_large", "The request body is larger than 16 KB.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw tooLarge;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw tooLarge;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "invalid_request", "The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Blocks writes from other origins. SameSite=Lax already keeps the session cookie off
 * cross-site requests; this check also covers sibling subdomains, which count as same-site.
 * Browsers send Origin on every POST, PATCH and DELETE, so a missing header means a non-browser
 * client, which cannot ride on a victim's cookie.
 */
export function assertSameOrigin(request: Request, url: URL): void {
  if (SAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin) {
    throw new HttpError(403, "forbidden_origin", "Changes must come from the dashboard itself.");
  }
}
