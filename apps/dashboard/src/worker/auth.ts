/**
 * Who is calling. Two ways in, never mixed:
 * - a Clerk session token in `Authorization: Bearer` (src/worker/clerk.ts), and
 * - on localhost with ENVIRONMENT=development only, the dev sign-in cookie.
 * The first Clerk sign-in creates the account. Name and email then follow the token's claims.
 */
import { type AccountRow, randomId } from "@emojisense/platform";
import { authorizedParties, bearerToken, type ClerkGateway, type ClerkIdentity } from "./clerk";
import { isLocalhost, readCookie, serializeCookie } from "./cookies";
import type { D1Database, D1PreparedStatement } from "./d1";
import type { RequestContext } from "./env";
import { HttpError } from "./http";
import { isValidId } from "./validate";

/** Holds the dev account's id. Read only where dev sign-in is allowed, and never for a Clerk account. */
export const DEV_COOKIE = "es_dev_account";
export const DEV_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const DEV_LOGIN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface Caller {
  account: AccountRow;
  verifiedEmail: string | null;
}

/** Both the flag and a localhost URL, so one wrong production var cannot open dev sign-in. */
export function devSignInAllowed({ env, url }: Pick<RequestContext, "env" | "url">): boolean {
  return env.ENVIRONMENT === "development" && isLocalhost(url);
}

export function devEmail(login: string): string {
  return `${login}@dev.localhost`;
}

export function devCookie(url: URL, accountId: string, maxAgeSeconds = DEV_COOKIE_MAX_AGE_SECONDS): string {
  return serializeCookie(DEV_COOKIE, accountId, { maxAgeSeconds, path: "/", url });
}

export function clearDevCookie(url: URL): string {
  return devCookie(url, "", 0);
}

export function clerkGateway(ctx: RequestContext): ClerkGateway | null {
  return ctx.deps.clerk?.(ctx.env) ?? null;
}

const clerkUnconfigured = () =>
  new HttpError(
    503,
    "clerk_unconfigured",
    "Sign-in is not set up on this server. Set CLERK_PUBLISHABLE_KEY and CLERK_JWT_KEY (see the dashboard README).",
  );

export async function findCaller(ctx: RequestContext): Promise<Caller | null> {
  const token = bearerToken(ctx.request);
  return token ? clerkCaller(ctx, token) : devCaller(ctx);
}

async function clerkCaller(ctx: RequestContext, token: string): Promise<Caller | null> {
  const clerk = clerkGateway(ctx);
  if (!clerk) throw clerkUnconfigured();
  const check = await clerk.verifySession(token, authorizedParties(ctx.env, ctx.url));
  if (!check.ok) {
    // A reason code only: never the token or its claims.
    console.warn(JSON.stringify({ level: "warn", event: "clerk_session_rejected", reason: check.reason }));
    return null;
  }
  const { identity } = check;
  const db = ctx.env.DB;
  const existing = await findByClerkUser(db, identity.userId);
  const account = existing
    ? await syncProfile(db, existing, identity)
    : await createClerkAccount(db, identity, ctx.deps.now());
  return { account, verifiedEmail: identity.email };
}

async function devCaller(ctx: RequestContext): Promise<Caller | null> {
  if (!devSignInAllowed(ctx)) return null;
  const accountId = readCookie(ctx.request, DEV_COOKIE);
  if (!isValidId(accountId)) return null;
  const account = await ctx.env.DB.prepare("SELECT * FROM accounts WHERE id = ? AND clerk_user_id IS NULL")
    .bind(accountId)
    .first<AccountRow>();
  return account ? { account, verifiedEmail: account.email } : null;
}

function findByClerkUser(db: D1Database, userId: string): Promise<AccountRow | null> {
  return db.prepare("SELECT * FROM accounts WHERE clerk_user_id = ?").bind(userId).first<AccountRow>();
}

/**
 * An account from the GitHub sign-in (before migration 0003) moves to Clerk once, when the
 * Clerk user's verified email equals the verified GitHub email it stored. Dev accounts never do.
 */
function linkLegacyAccount(db: D1Database, identity: ClerkIdentity): Promise<AccountRow | null> {
  return db
    .prepare(
      `UPDATE accounts SET clerk_user_id = ?, name = COALESCE(?, name)
       WHERE email = ? AND clerk_user_id IS NULL AND github_id IS NOT NULL
       RETURNING *`,
    )
    .bind(identity.userId, identity.name, identity.email)
    .first<AccountRow>();
}

/**
 * Parallel first requests are safe: ON CONFLICT DO NOTHING covers both the Clerk user id and the
 * email. When another account already uses the email, the account starts without one, as the
 * GitHub sign-in did.
 */
async function createClerkAccount(db: D1Database, identity: ClerkIdentity, now: number): Promise<AccountRow> {
  const linked = identity.email ? await linkLegacyAccount(db, identity) : null;
  if (linked) return linked;
  const insert = (email: string | null) =>
    db
      .prepare(
        `INSERT INTO accounts (id, email, clerk_user_id, name, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(randomId(), email, identity.userId, identity.name, now)
      .run();
  await insert(identity.email);
  let account = await findByClerkUser(db, identity.userId);
  if (!account && identity.email) {
    await insert(null);
    account = await findByClerkUser(db, identity.userId);
  }
  if (!account) throw new Error("account insert returned no row");
  // A missing email usually means the session token lacks the custom claims (README).
  console.log(JSON.stringify({ event: "account_created", verifiedEmail: account.email !== null }));
  return account;
}

/** Writes only on a change. A claim that is missing keeps the stored value. */
async function syncProfile(
  db: D1Database,
  account: AccountRow,
  identity: ClerkIdentity,
): Promise<AccountRow> {
  const changes: D1PreparedStatement[] = [];
  if (identity.name !== null && identity.name !== account.name) {
    changes.push(db.prepare("UPDATE accounts SET name = ? WHERE id = ?").bind(identity.name, account.id));
  }
  if (identity.email !== null && identity.email !== account.email) {
    // An email that another account uses stays out (UNIQUE): the account keeps its old one.
    changes.push(
      db.prepare("UPDATE OR IGNORE accounts SET email = ? WHERE id = ?").bind(identity.email, account.id),
    );
  }
  if (changes.length === 0) return account;
  await db.batch(changes);
  return (
    (await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(account.id).first<AccountRow>()) ?? account
  );
}
