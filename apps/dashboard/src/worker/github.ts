/**
 * GitHub OAuth (web application flow). The access token is used once to read the profile and
 * is never stored: the dashboard needs an identity, not GitHub API access.
 */
import type { Deps } from "./env";

export const STATE_COOKIE = "es_oauth_state";
export const STATE_COOKIE_PATH = "/api/auth/github";
export const STATE_TTL_SECONDS = 600;

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_URL = "https://api.github.com";
// GitHub rejects API requests without a User-Agent.
const API_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "emojisense-dashboard",
  "x-github-api-version": "2022-11-28",
};

export interface GitHubProfile {
  id: string;
  name: string;
  /** Primary email, only when GitHub says it is verified. */
  email: string | null;
}

export class GitHubError extends Error {}

export function callbackUrl(url: URL): string {
  return `${url.origin}/api/auth/github/callback`;
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
    allow_signup: "true",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

interface ExchangeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

/** Exchanges the callback code for a token and reads the profile. Messages never hold secrets. */
export async function fetchGitHubProfile(
  fetchFn: Deps["fetch"],
  input: ExchangeInput,
): Promise<GitHubProfile> {
  const tokenResponse = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": API_HEADERS["user-agent"],
    },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  if (!tokenResponse.ok) throw new GitHubError(`token exchange returned HTTP ${tokenResponse.status}`);
  // GitHub reports a bad code with HTTP 200 and an `error` field.
  const token = (await tokenResponse.json()) as { access_token?: unknown; error?: unknown };
  if (typeof token.access_token !== "string") {
    throw new GitHubError(
      `token exchange failed: ${typeof token.error === "string" ? token.error : "no token"}`,
    );
  }

  const headers = { ...API_HEADERS, authorization: `Bearer ${token.access_token}` };
  const userResponse = await fetchFn(`${API_URL}/user`, { headers });
  if (!userResponse.ok) throw new GitHubError(`GET /user returned HTTP ${userResponse.status}`);
  const user = (await userResponse.json()) as { id?: unknown; login?: unknown; name?: unknown };
  if (typeof user.id !== "number" || typeof user.login !== "string") {
    throw new GitHubError("GET /user returned an unexpected body");
  }

  return {
    id: String(user.id),
    name: typeof user.name === "string" && user.name.trim() ? user.name.trim() : user.login,
    email: await fetchVerifiedEmail(fetchFn, headers),
  };
}

/** Without the user:email grant the endpoint fails; the user then signs in without an email. */
async function fetchVerifiedEmail(
  fetchFn: Deps["fetch"],
  headers: Record<string, string>,
): Promise<string | null> {
  const response = await fetchFn(`${API_URL}/user/emails`, { headers });
  if (!response.ok) return null;
  const emails = (await response.json()) as unknown;
  if (!Array.isArray(emails)) return null;
  const primary = emails.find(
    (entry): entry is { email: string } =>
      typeof entry === "object" &&
      entry !== null &&
      entry.primary === true &&
      entry.verified === true &&
      typeof entry.email === "string",
  );
  return primary ? primary.email.toLowerCase() : null;
}
