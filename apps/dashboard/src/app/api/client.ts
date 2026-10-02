import { PLAN_IDS, type PlanId } from "@emojisense/platform";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * `402 { error: "plan_required", plan }`: the feature exists on `plan` and above. Pages show an
 * upsell for it, never an error.
 */
export class PlanRequiredError extends ApiError {
  constructor(
    readonly plan: PlanId,
    message: string,
  ) {
    super(402, "plan_required", message);
    this.name = "PlanRequiredError";
  }
}

export function isPlanRequired(error: unknown): error is PlanRequiredError {
  return error instanceof PlanRequiredError;
}

/** Fired on any 401, so the app can show the sign-in page when a session ends mid-use. */
export const UNAUTHORIZED_EVENT = "emojisense:unauthorized";

type TokenSource = () => Promise<string | null>;
let tokenSource: TokenSource | null = null;

/**
 * Clerk's `getToken` while ClerkProvider is mounted (auth/ClerkAuth.tsx): every request then
 * carries `Authorization: Bearer <session token>`. `null` for the dev sign-in and mock mode.
 */
export function setTokenSource(source: TokenSource | null): void {
  tokenSource = source;
}

async function authorization(): Promise<string | null> {
  if (!tokenSource) return null;
  try {
    const token = await tokenSource();
    return token ? `Bearer ${token}` : null;
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "Cannot reach the sign-in service. Check your connection and try again.",
    );
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

function planIdOf(value: unknown): PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value)
    ? (value as PlanId)
    : "pro";
}

const STATUS_MESSAGES: Record<number, string> = {
  403: "You do not have access to this. Ask the app owner for a role with more rights.",
  404: "This item does not exist, or it belongs to another account.",
  413: "The upload is too large.",
  429: "Too many requests. Wait a minute, then try again.",
};

function fallbackMessage(status: number): string {
  if (status >= 500) return "The dashboard API had a problem. Try again in a moment.";
  return STATUS_MESSAGES[status] ?? `The request failed with HTTP ${status}.`;
}

/**
 * Reads `ApiErrorBody` (`{ error: { code, message, field?, plan? } }`). A body that is not JSON,
 * e.g. a proxy's HTML error page, still gives a readable message.
 */
export function toApiError(status: number, body: unknown): ApiError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const code = text(error.code) ?? "http_error";
  const message = text(error.message) ?? fallbackMessage(status);
  if (status === 402 || code === "plan_required") return new PlanRequiredError(planIdOf(error.plan), message);
  return new ApiError(status, code, message, text(error.field));
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined && !isForm) headers["content-type"] = "application/json";
  const auth = await authorization();
  if (auth) headers.authorization = auth;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "Cannot reach the dashboard API. Check your connection and try again.",
    );
  }
  const data = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw toApiError(response.status, data);
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}
