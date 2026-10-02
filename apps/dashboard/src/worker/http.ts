import type { PlanId } from "@emojisense/platform";
import type { ApiErrorBody } from "../shared/contract";

/** An error with a status, a stable code and a message that is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
    readonly plan?: PlanId,
  ) {
    super(message);
  }
}

/** 402: the feature needs a higher plan. `plan` is the lowest plan that has it. */
export function planRequired(plan: PlanId, message: string): HttpError {
  return new HttpError(402, "plan_required", message, undefined, plan);
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
    error: {
      code: error.code,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
      ...(error.plan ? { plan: error.plan } : {}),
    },
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

/** 303: the browser follows with a GET, so a form post is not sent again on reload. */
export function seeOther(location: string, headers: HeadersInit = {}): Response {
  const merged = new Headers(headers);
  merged.set("location", location);
  merged.set("cache-control", "no-store");
  return new Response(null, { status: 303, headers: merged });
}

const MAX_BODY_BYTES = 16 * 1024;
const JSON_TYPE = /^application\/json\b/i;
const FORM_TYPE = /^application\/x-www-form-urlencoded\b/i;

export function isJsonBody(request: Request): boolean {
  return JSON_TYPE.test(request.headers.get("content-type") ?? "");
}

/** An HTML form post. Browsers send it without a CORS preflight. */
export function isFormBody(request: Request): boolean {
  return FORM_TYPE.test(request.headers.get("content-type") ?? "");
}

/**
 * Reads at most `max` bytes of a body; undefined when it is larger. Stops at the limit, so an
 * oversized upload or download costs no more memory than the limit.
 */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * The body as text, at most 16 KB. A chunked body has no Content-Length, so the stream is cut at
 * the limit instead of buffered whole (the public waitlist would otherwise take any size).
 */
async function readBodyText(request: Request): Promise<string> {
  const tooLarge = new HttpError(413, "body_too_large", "The request body is larger than 16 KB.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw tooLarge;
  const bytes = await readCapped(request.body, MAX_BODY_BYTES);
  if (!bytes) throw tooLarge;
  return new TextDecoder().decode(bytes);
}

/** Reads a form body (application/x-www-form-urlencoded). A repeated field keeps its last value. */
export async function readFormObject(request: Request): Promise<Record<string, string>> {
  if (!isFormBody(request)) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "Send a form body with Content-Type: application/x-www-form-urlencoded.",
    );
  }
  const fields = new Map<string, string>();
  new URLSearchParams(await readBodyText(request)).forEach((value, name) => {
    fields.set(name, value);
  });
  return Object.fromEntries(fields);
}

/** Reads a JSON object body. Requiring the JSON content type also forces a CORS preflight. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  if (!isJsonBody(request)) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "Send a JSON body with Content-Type: application/json.",
    );
  }
  const text = await readBodyText(request);

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
