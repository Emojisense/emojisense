import type { KeyKind } from "@emojisense/platform";
import type {
  ApiErrorBody,
  AppDetailResponse,
  AppResponse,
  AppsResponse,
  CreatedKeyResponse,
  Environment,
  KeyResponse,
  MeResponse,
  UsageResponse,
  WaitlistResponse,
} from "../shared/contract";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** Fired on any 401, so the app can show the sign-in page when a session ends mid-use. */
export const UNAUTHORIZED_EVENT = "emojisense:unauthorized";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers:
        body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "http_error",
      error?.message ?? `The request failed with HTTP ${response.status}.`,
      error?.field,
    );
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

const segment = encodeURIComponent;

export const api = {
  me: () => request<MeResponse>("GET", "/api/me"),
  listApps: () => request<AppsResponse>("GET", "/api/apps"),
  createApp: (input: { name: string; environment: Environment }) =>
    request<AppResponse>("POST", "/api/apps", input),
  getApp: (appId: string) => request<AppDetailResponse>("GET", `/api/apps/${segment(appId)}`),
  createKey: (appId: string, input: { kind: KeyKind; allowedOrigins?: string[] }) =>
    request<CreatedKeyResponse>("POST", `/api/apps/${segment(appId)}/keys`, input),
  updateKeyOrigins: (keyId: string, allowedOrigins: string[]) =>
    request<KeyResponse>("PATCH", `/api/keys/${segment(keyId)}`, { allowedOrigins }),
  revokeKey: (keyId: string) => request<KeyResponse>("DELETE", `/api/keys/${segment(keyId)}`),
  usage: (appId: string, period: string) =>
    request<UsageResponse>("GET", `/api/apps/${segment(appId)}/usage?period=${segment(period)}`),
  joinWaitlist: (email: string, plan: string) =>
    request<WaitlistResponse>("POST", "/api/waitlist", { email, plan }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
};
