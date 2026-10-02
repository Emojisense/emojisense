/**
 * Clerk session verification. The SPA sends the Clerk session token from `getToken()` as
 * `Authorization: Bearer <token>`; the `__session` cookie is never read, so a browser cannot
 * attach a session to a cross-site request.
 *
 * Verification is networkless and needs only public values: @clerk/backend's `verifyJwt` checks
 * the signature with the instance's JWT public key (CLERK_JWT_KEY) and `azp`, `exp`, `nbf`, `iat`;
 * `identityFromClaims` checks the issuer (from CLERK_PUBLISHABLE_KEY) and the session. The email
 * and name come from custom session token claims (see the dashboard README), so the request path
 * never calls Clerk's Backend API and needs no secret key. Only the `/jwt` entry point is
 * imported: the full SDK would add about 350 KB to the Worker for one DELETE request.
 */
import { verifyJwt } from "@clerk/backend/jwt";
import { clerkFrontendApi } from "../shared/clerk";
import type { Env } from "./env";

export interface ClerkIdentity {
  userId: string;
  /** The primary email in lower case, only when the token says it is verified. */
  email: string | null;
  name: string | null;
  /** When Clerk issued the token (`iat`), in epoch milliseconds; 0 when it has none. */
  issuedAt: number;
}

export type SessionCheck = { ok: true; identity: ClerkIdentity } | { ok: false; reason: string };

export interface ClerkGateway {
  verifySession(token: string, authorizedParties: readonly string[]): Promise<SessionCheck>;
  /** Only with CLERK_SECRET_KEY. Without it the SPA deletes the Clerk user with Clerk JS. */
  deleteUser?: (userId: string) => Promise<void>;
}

/** `null` when Clerk is not configured (dev sign-in and mock mode still work). */
export type ClerkFactory = (env: Env) => ClerkGateway | null;

const CLERK_BACKEND_API = "https://api.clerk.com/v1";

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 200;

function claimEmail(claims: Record<string, unknown>): string | null {
  // Shortcodes keep their type, so `{{user.email_verified}}` arrives as a boolean.
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!verified || typeof claims.email !== "string") return null;
  const email = claims.email.trim().toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

function claimName(claims: Record<string, unknown>): string | null {
  const name = typeof claims.name === "string" ? claims.name.trim() : "";
  return name ? name.slice(0, MAX_NAME_LENGTH) : null;
}

/**
 * The checks that @clerk/backend's `verifyToken` leaves to the caller: the issuer is this
 * instance, the token is a session token (it has a session id), and the session is not pending
 * (Clerk treats pending sessions as signed out).
 */
export function identityFromClaims(claims: Record<string, unknown>, issuer: string): SessionCheck {
  if (claims.iss !== issuer) return { ok: false, reason: "issuer_mismatch" };
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.sid !== "string") {
    return { ok: false, reason: "not_a_session_token" };
  }
  if (claims.sts === "pending") return { ok: false, reason: "session_pending" };
  const issuedAt = typeof claims.iat === "number" ? claims.iat * 1000 : 0;
  return {
    ok: true,
    identity: { userId: claims.sub, email: claimEmail(claims), name: claimName(claims), issuedAt },
  };
}

function reasonOf(error: unknown): string {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" ? reason : "token_invalid";
}

/** CLERK_AUTHORIZED_PARTIES, or the dashboard's own origin when it is empty. */
export function authorizedParties(env: Env, url: URL): string[] {
  const listed = (env.CLERK_AUTHORIZED_PARTIES ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return listed.length > 0 ? listed : [url.origin];
}

export function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(request.headers.get("authorization")?.trim() ?? "");
  return match?.[1] ?? null;
}

/** Clerk Backend API `DELETE /users/{id}`. A 404 means the user is already gone. */
async function deleteClerkUser(secretKey: string, userId: string): Promise<void> {
  const response = await fetch(`${CLERK_BACKEND_API}/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok && response.status !== 404) {
    throw Object.assign(new Error(`Clerk answered HTTP ${response.status}`), { status: response.status });
  }
}

export const createClerkGateway: ClerkFactory = (env) => {
  const frontendApi = clerkFrontendApi(env.CLERK_PUBLISHABLE_KEY);
  // A PEM pasted into a one-line var may keep its newlines as literal "\n".
  const jwtKey = env.CLERK_JWT_KEY?.replace(/\\n/g, "\n").trim();
  if (!frontendApi || !jwtKey) return null;
  const issuer = `https://${frontendApi}`;
  const secretKey = env.CLERK_SECRET_KEY?.trim();

  return {
    async verifySession(token, parties) {
      let claims: Record<string, unknown>;
      try {
        claims = await verifyJwt(token, { key: jwtKey, authorizedParties: [...parties] });
      } catch (error) {
        return { ok: false, reason: reasonOf(error) };
      }
      return identityFromClaims(claims, issuer);
    },
    deleteUser: secretKey ? (userId) => deleteClerkUser(secretKey, userId) : undefined,
  };
};
