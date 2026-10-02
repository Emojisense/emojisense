/**
 * A Clerk stand-in for Worker tests. A token is an opaque string that maps to session claims.
 * Like @clerk/backend's verifyToken, it rejects unknown tokens and an `azp` outside the
 * authorized parties; then the real `identityFromClaims` checks issuer, session and claims.
 */
import { type ClerkGateway, identityFromClaims, type SessionCheck } from "../../src/worker/clerk";

export const FAKE_ISSUER = "https://clerk.emojisense.example";

export interface FakeSession {
  userId: string;
  email?: string;
  /** Defaults to true. */
  emailVerified?: boolean;
  name?: string;
  /** Defaults to the harness origin, http://localhost:8790. */
  azp?: string;
  /** Any other claims, e.g. `{ sts: "pending" }` or `{ iss: "https://other.example" }`. */
  claims?: Record<string, unknown>;
}

export class FakeClerk implements ClerkGateway {
  readonly deletedUsers: string[] = [];
  /** Set to make server-side deletion fail. */
  deleteError: Error | null = null;
  private readonly tokens = new Map<string, Record<string, unknown>>();
  deleteUser?: (userId: string) => Promise<void>;

  /** `secretKey: true` gives the gateway `deleteUser`, as CLERK_SECRET_KEY does. */
  constructor(options: { secretKey?: boolean } = {}) {
    if (options.secretKey) {
      this.deleteUser = async (userId) => {
        if (this.deleteError) throw this.deleteError;
        this.deletedUsers.push(userId);
      };
    }
  }

  /** A session token for these claims. */
  token(session: FakeSession): string {
    const token = `fake.${this.tokens.size + 1}.token`;
    this.tokens.set(token, {
      iss: FAKE_ISSUER,
      sub: session.userId,
      sid: `sess_${session.userId}`,
      azp: session.azp ?? "http://localhost:8790",
      ...(session.email === undefined ? {} : { email: session.email }),
      email_verified: session.emailVerified ?? true,
      ...(session.name === undefined ? {} : { name: session.name }),
      ...session.claims,
    });
    return token;
  }

  async verifySession(token: string, authorizedParties: readonly string[]): Promise<SessionCheck> {
    const claims = this.tokens.get(token);
    if (!claims) return { ok: false, reason: "token-invalid" };
    if (!authorizedParties.includes(String(claims.azp))) {
      return { ok: false, reason: "token-invalid-authorized-parties" };
    }
    return identityFromClaims(claims, FAKE_ISSUER);
  }
}
