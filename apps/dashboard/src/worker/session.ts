import type { AccountRow } from "@emojisense/platform";
import { readCookie, serializeCookie } from "./cookies";
import { randomToken, sha256Hex } from "./crypto";
import type { D1Database } from "./d1";

export const SESSION_COOKIE = "es_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Creates a session and returns the cookie value. The database stores only the SHA-256 of the
 * token, so a leaked `sessions` table cannot be replayed as cookies.
 */
export async function createSession(db: D1Database, accountId: string, now: number): Promise<string> {
  const token = randomToken(32);
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE account_id = ? AND expires_at <= ?").bind(accountId, now),
    db
      .prepare("INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256Hex(token), accountId, now + SESSION_TTL_MS),
  ]);
  return token;
}

export async function findSessionAccount(
  db: D1Database,
  request: Request,
  now: number,
): Promise<AccountRow | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  return db
    .prepare(
      `SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(await sha256Hex(token), now)
    .first<AccountRow>();
}

export async function deleteSession(db: D1Database, request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !TOKEN_PATTERN.test(token)) return;
  await db
    .prepare("DELETE FROM sessions WHERE id = ?")
    .bind(await sha256Hex(token))
    .run();
}

export function sessionCookie(token: string, url: URL): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: SESSION_TTL_MS / 1000, path: "/", url });
}

export function clearSessionCookie(url: URL): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, path: "/", url });
}
