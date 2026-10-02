/**
 * The real gateway (@clerk/backend's verifyToken) with a key pair made here: proves networkless
 * verification with only public values (publishable key + JWT public key, no secret key).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clerkFrontendApi } from "../../src/shared/clerk";
import type { MeResponse } from "../../src/shared/contract";
import { createClerkGateway } from "../../src/worker/clerk";
import type { Env } from "../../src/worker/env";
import { BASE, body, createHarness } from "./harness";

const FRONTEND_API = "clerk.emojisense.example";
const PUBLISHABLE_KEY = `pk_live_${btoa(`${FRONTEND_API}$`)}`;
const ISSUER = `https://${FRONTEND_API}`;

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

async function keyPair() {
  const pair = await crypto.subtle.generateKey(
    { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  const spki = Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString("base64");
  const pem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;
  return { privateKey: pair.privateKey, pem };
}

async function sign(privateKey: CryptoKey, claims: Record<string, unknown>): Promise<string> {
  const header = base64url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "ins_1" })),
  );
  const payload = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    RSA,
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(signature)}`;
}

function sessionClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    sub: "user_ada",
    sid: "sess_1",
    azp: "https://app.emojisense.com",
    iat: now,
    nbf: now - 5,
    exp: now + 60,
    v: 2,
    email: "Ada@Example.com",
    email_verified: true,
    name: "Ada Lovelace",
    ...overrides,
  };
}

let instance: Awaited<ReturnType<typeof keyPair>>;
let other: Awaited<ReturnType<typeof keyPair>>;

beforeAll(async () => {
  [instance, other] = await Promise.all([keyPair(), keyPair()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const publicEnv = (): Partial<Env> => ({
  CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
  CLERK_JWT_KEY: instance.pem,
});

describe("clerkFrontendApi", () => {
  it("reads the Frontend API host from a publishable key", () => {
    expect(clerkFrontendApi(PUBLISHABLE_KEY)).toBe(FRONTEND_API);
    // The emojisense development instance.
    expect(clerkFrontendApi("pk_test_ZmVhc2libGUtYmxvd2Zpc2gtOTY4MC5jbGVyay5hY2NvdW50cy5kZXYk")).toBe(
      "feasible-blowfish-9680.clerk.accounts.dev",
    );
    expect(clerkFrontendApi(`pk_live_${btoa("clerk.emojisense.com$")}`)).toBe("clerk.emojisense.com");
  });

  it("rejects anything else", () => {
    for (const key of [undefined, "", "sk_live_abc", `pk_live_${btoa("no-dollar.example")}`, "pk_live_@@@"]) {
      expect(clerkFrontendApi(key)).toBeNull();
    }
    expect(clerkFrontendApi(`pk_live_${btoa("evil.example/path$")}`)).toBeNull();
  });
});

describe("createClerkGateway (networkless, no secret key)", () => {
  it("is off without the publishable key, or without both the JWT key and the secret key", () => {
    expect(createClerkGateway({ CLERK_JWT_KEY: instance.pem } as Env)).toBeNull();
    expect(createClerkGateway({ CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY } as Env)).toBeNull();
    const gateway = createClerkGateway(publicEnv() as Env);
    expect(gateway).not.toBeNull();
    expect(gateway?.deleteUser).toBeUndefined();
    expect(
      createClerkGateway({ ...publicEnv(), CLERK_SECRET_KEY: "sk_live_x" } as Env)?.deleteUser,
    ).toBeTypeOf("function");
  });

  it("verifies a session token and reads the claims without any network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const gateway = createClerkGateway(publicEnv() as Env);
    const token = await sign(instance.privateKey, sessionClaims());
    expect(await gateway?.verifySession(token, ["https://app.emojisense.com"])).toEqual({
      ok: true,
      identity: { userId: "user_ada", email: "ada@example.com", name: "Ada Lovelace" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "another authorized party",
      sessionClaims({ azp: "https://evil.example" }),
      "token-invalid-authorized-parties",
    ],
    ["an expired token", sessionClaims({ exp: Math.floor(Date.now() / 1000) - 60 }), "token-expired"],
    ["another issuer", sessionClaims({ iss: "https://clerk.other.example" }), "issuer_mismatch"],
    ["a pending session", sessionClaims({ sts: "pending" }), "session_pending"],
  ])("rejects %s", async (_, claims, reason) => {
    const gateway = createClerkGateway(publicEnv() as Env);
    const token = await sign(instance.privateKey, claims);
    expect(await gateway?.verifySession(token, ["https://app.emojisense.com"])).toEqual({
      ok: false,
      reason,
    });
  });

  it("rejects a token signed by another key, and garbage", async () => {
    const gateway = createClerkGateway(publicEnv() as Env);
    const forged = await sign(other.privateKey, sessionClaims());
    expect(await gateway?.verifySession(forged, ["https://app.emojisense.com"])).toEqual({
      ok: false,
      reason: "token-invalid-signature",
    });
    expect((await gateway?.verifySession("a.b.c", ["https://app.emojisense.com"]))?.ok).toBe(false);
  });

  it("signs in through the Worker with the real gateway", async () => {
    const h = createHarness(publicEnv(), { clerk: createClerkGateway });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const token = await sign(instance.privateKey, sessionClaims({ azp: BASE }));
    const response = await h.call("GET", "/api/me", { token });
    expect(response.status).toBe(200);
    expect((await body<MeResponse>(response)).account).toMatchObject({
      email: "ada@example.com",
      name: "Ada Lovelace",
      signIn: "clerk",
    });
  });
});
