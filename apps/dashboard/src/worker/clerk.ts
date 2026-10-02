/**
 * Clerk session verification. The SPA sends the Clerk session token from `getToken()` as
 * `Authorization: Bearer <token>`; the `__session` cookie is never read, so a browser cannot
 * attach a session to a cross-site request.
 *
 * Verification is networkless: the instance's JWT public key (CLERK_JWT_KEY) checks the
 * signature, and the Worker checks `azp`, `iss`, `exp`/`nbf` and the session status. The email and
 * name come from custom session token claims (see the dashboard README), so the request path
 * never calls Clerk's Backend API and needs no secret key.
 */
import { createClerkClient, verifyToken } from "@clerk/backend";
import { clerkFrontendApi } from "../shared/clerk";
import type { Env } from "./env";

export interface ClerkIdentity {
  userId: string;
  /** The primary email in lower case, only when the token says it is verified. */
  email: string | null;
  name: string | null;
}

export type SessionCheck = { ok: true; identity: ClerkIdentity } | { ok: false; reason: string };

export interface ClerkGateway {
  verifySession(token: string, authorizedParties: readonly string[]): Promise<SessionCheck>;
  /** Only with CLERK_SECRET_KEY. Without it the SPA deletes the Clerk user with Clerk JS. */
  deleteUser?: (userId: string) => Promise<void>;
}

/** `null` when Clerk is not configured (dev sign-in and mock mode still work). */
export type ClerkFactory = (env: Env) => ClerkGateway | null;

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
  return { ok: true, identity: { userId: claims.sub, email: claimEmail(claims), name: claimName(claims) } };
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

export const createClerkGateway: ClerkFactory = (env) => {
  const frontendApi = clerkFrontendApi(env.CLERK_PUBLISHABLE_KEY);
  const jwtKey = env.CLERK_JWT_KEY?.trim() || undefined;
  const secretKey = env.CLERK_SECRET_KEY?.trim() || undefined;
  if (!frontendApi || (!jwtKey && !secretKey)) return null;
  const issuer = `https://${frontendApi}`;

  return {
    async verifySession(token, parties) {
      let claims: Record<string, unknown>;
      try {
        // With jwtKey this makes no network call; with only secretKey it fetches the JWKS once.
        claims = await verifyToken(token, { jwtKey, secretKey, authorizedParties: [...parties] });
      } catch (error) {
        return { ok: false, reason: reasonOf(error) };
      }
      return identityFromClaims(claims, issuer);
    },
    deleteUser: secretKey
      ? async (userId) => {
          await createClerkClient({ secretKey }).users.deleteUser(userId);
        }
      : undefined,
  };
};
