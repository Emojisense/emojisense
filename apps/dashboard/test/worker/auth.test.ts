import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../../src/shared/contract";
import { body, createHarness, devCookieFrom, type Harness, setCookies } from "./harness";

afterEach(() => {
  vi.restoreAllMocks();
});

const accounts = (h: Harness) =>
  h.db.rows<{ id: string; email: string | null; name: string | null; clerk_user_id: string | null }>(
    "SELECT id, email, name, clerk_user_id FROM accounts ORDER BY created_at, clerk_user_id",
  );

function clerkOf(h: Harness) {
  if (!h.clerk) throw new Error("the harness runs without Clerk");
  return h.clerk;
}

describe("dev sign-in", () => {
  it("sets a dev cookie and creates <login>@dev.localhost", async () => {
    const h = createHarness();
    const response = await h.call("GET", "/api/auth/dev?login=ada");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/apps");
    const [ada] = accounts(h);
    expect(ada).toMatchObject({ email: "ada@dev.localhost", name: "ada", clerk_user_id: null });
    expect(setCookies(response)).toEqual([
      `es_dev_account=${ada?.id}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
    ]);
    expect(h.db.rows("SELECT id FROM sessions")).toEqual([]);
  });

  it("reuses the account for the same login", async () => {
    const h = createHarness();
    await h.signIn("ada");
    await h.signIn("ada");
    expect(accounts(h)).toHaveLength(1);
  });

  it("is off outside development and outside localhost, for the route and the cookie", async () => {
    const production = createHarness({ ENVIRONMENT: "production" });
    expect((await production.call("GET", "/api/auth/dev")).status).toBe(404);

    const remote = createHarness();
    const response = await remote.call("GET", "/api/auth/dev", { base: "https://dash.emojisense.example" });
    expect(response.status).toBe(404);
    expect(accounts(remote)).toHaveLength(0);

    // A cookie made by hand does not work on a real host either.
    const h = createHarness();
    const cookie = await h.signIn("ada");
    const elsewhere = await h.call("GET", "/api/me", { cookie, base: "https://app.emojisense.dev" });
    expect(elsewhere.status).toBe(401);
    h.env.ENVIRONMENT = "staging";
    expect((await h.call("GET", "/api/me", { cookie })).status).toBe(401);
  });

  it("rejects a login name that is not a simple handle", async () => {
    const h = createHarness();
    const response = await h.call("GET", "/api/auth/dev?login=a%20b");
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "invalid_request", field: "login" } });
  });

  it("returns the account for the dev cookie and works without Clerk", async () => {
    const h = createHarness({}, { clerk: null });
    const cookie = await h.signIn("ada");
    const me = await body<MeResponse>(await h.call("GET", "/api/me", { cookie }));
    expect(me.account).toMatchObject({ name: "ada", email: "ada@dev.localhost", signIn: "dev" });
    expect(me.plan).toMatchObject({ id: "free", maxApps: 1, limits: { semantic_calls: 100_000 } });
    expect(me.appCount).toBe(0);
    expect(me.waitlistPlan).toBeNull();
  });

  it("signs out: clears the dev cookie", async () => {
    const h = createHarness();
    await h.signIn();
    const response = await h.call("POST", "/api/auth/logout");
    expect(response.status).toBe(200);
    expect(setCookies(response)).toEqual(["es_dev_account=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"]);
  });

  it("refuses a sign-out posted from another origin", async () => {
    const h = createHarness();
    const response = await h.call("POST", "/api/auth/logout", { origin: "https://evil.example" });
    expect(response.status).toBe(403);
  });

  it("ignores malformed and unknown dev cookies, and never opens a Clerk account", async () => {
    const h = createHarness();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await h.clerkSignIn("cleo");
    const [cleo] = accounts(h);
    for (const value of ["", "../ada", "nobody", cleo?.id]) {
      expect((await h.call("GET", "/api/me", { cookie: `es_dev_account=${value}` })).status).toBe(401);
    }
    // The login is case-insensitive: "Ada" signs in to ada's account.
    const ada = await h.signIn("ada");
    expect(devCookieFrom(await h.call("GET", "/api/auth/dev?login=Ada"))).toBe(ada);
  });
});

describe("Clerk sessions", () => {
  it("answers 401 when signed out", async () => {
    const h = createHarness();
    const anonymous = await h.call("GET", "/api/me");
    expect(anonymous.status).toBe(401);
    expect(await body(anonymous)).toEqual({
      error: { code: "unauthorized", message: "Sign in to continue." },
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await h.call("GET", "/api/me", { token: "not.a.token" })).status).toBe(401);
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({ level: "warn", event: "clerk_session_rejected", reason: "token-invalid" }),
    );
  });

  it("creates the account at the first sign-in, from the verified claims", async () => {
    const h = createHarness();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const token = clerkOf(h).token({ userId: "user_ada", email: "Ada@Example.com", name: "Ada Lovelace" });

    const response = await h.call("GET", "/api/me", { token });
    expect(response.status).toBe(200);
    const me = await body<MeResponse>(response);
    expect(me.account).toMatchObject({ name: "Ada Lovelace", email: "ada@example.com", signIn: "clerk" });
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: "account_created", verifiedEmail: true }));

    // Later requests find the same account by the Clerk user id.
    expect((await h.call("GET", "/api/apps", { token })).status).toBe(200);
    expect(accounts(h)).toEqual([
      expect.objectContaining({ clerk_user_id: "user_ada", email: "ada@example.com", name: "Ada Lovelace" }),
    ]);
  });

  it("accepts only the authorized parties", async () => {
    const h = createHarness();
    const clerk = clerkOf(h);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const foreign = clerk.token({ userId: "user_ada", azp: "https://evil.example" });
    expect((await h.call("GET", "/api/me", { token: foreign })).status).toBe(401);
    expect(accounts(h)).toEqual([]);

    // CLERK_AUTHORIZED_PARTIES replaces the default (the dashboard's own origin).
    const dev = createHarness({
      CLERK_AUTHORIZED_PARTIES: "https://app.emojisense.dev/, http://localhost:8790",
    });
    const devClerk = clerkOf(dev);
    for (const azp of ["https://app.emojisense.dev", "http://localhost:8790"]) {
      const token = devClerk.token({ userId: "user_ada", azp });
      expect((await dev.call("GET", "/api/me", { token, base: "https://app.emojisense.dev" })).status).toBe(
        200,
      );
    }
    const production = devClerk.token({ userId: "user_ada", azp: "https://app.emojisense.com" });
    expect((await dev.call("GET", "/api/me", { token: production })).status).toBe(401);
  });

  it("treats pending sessions, other issuers and non-session tokens as signed out", async () => {
    const h = createHarness();
    const clerk = clerkOf(h);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tokens = [
      clerk.token({ userId: "user_ada", claims: { sts: "pending" } }),
      clerk.token({ userId: "user_ada", claims: { iss: "https://clerk.other.example" } }),
      clerk.token({ userId: "user_ada", claims: { sid: undefined } }),
    ];
    for (const token of tokens) expect((await h.call("GET", "/api/me", { token })).status).toBe(401);
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)).reason)).toEqual([
      "session_pending",
      "issuer_mismatch",
      "not_a_session_token",
    ]);
    expect(accounts(h)).toEqual([]);
  });

  it("keeps an unverified or missing email out of the account", async () => {
    const h = createHarness();
    const clerk = clerkOf(h);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const unverified = clerk.token({ userId: "user_a", email: "a@example.com", emailVerified: false });
    await h.call("GET", "/api/me", { token: unverified });
    // No custom claims at all: the Clerk session token was not customized.
    await h.call("GET", "/api/me", { token: clerk.token({ userId: "user_b" }) });
    expect(accounts(h)).toEqual([
      expect.objectContaining({ clerk_user_id: "user_a", email: null, name: null }),
      expect.objectContaining({ clerk_user_id: "user_b", email: null, name: null }),
    ]);
  });

  it("follows name and email changes in the claims, but never takes another account's email", async () => {
    const h = createHarness();
    const clerk = clerkOf(h);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await h.call("GET", "/api/me", { token: clerk.token({ userId: "user_ada", email: "ada@example.com" }) });
    await h.call("GET", "/api/me", { token: clerk.token({ userId: "user_bob", email: "bob@example.com" }) });

    const renamed = clerk.token({ userId: "user_ada", email: "ada@lovelace.dev", name: "Ada" });
    expect(
      (await body<MeResponse>(await h.call("GET", "/api/me", { token: renamed }))).account,
    ).toMatchObject({
      name: "Ada",
      email: "ada@lovelace.dev",
    });
    const taken = clerk.token({ userId: "user_ada", email: "bob@example.com", name: "Ada L." });
    expect((await body<MeResponse>(await h.call("GET", "/api/me", { token: taken }))).account).toMatchObject({
      name: "Ada L.",
      email: "ada@lovelace.dev",
    });
  });

  it("starts without an email when another account already has it", async () => {
    const h = createHarness();
    const clerk = clerkOf(h);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await h.call("GET", "/api/me", { token: clerk.token({ userId: "user_old", email: "ada@example.com" }) });
    await h.call("GET", "/api/me", { token: clerk.token({ userId: "user_new", email: "ada@example.com" }) });
    expect(accounts(h).map((row) => [row.clerk_user_id, row.email])).toEqual([
      ["user_new", null],
      ["user_old", "ada@example.com"],
    ]);
    expect(log).toHaveBeenLastCalledWith(JSON.stringify({ event: "account_created", verifiedEmail: false }));
  });

  it("moves a legacy GitHub account to Clerk once, by its verified email", async () => {
    const h = createHarness();
    const clerk = clerkOf(h);
    h.db.exec(
      `INSERT INTO accounts (id, email, github_id, name, plan, created_at)
       VALUES ('legacy', 'octo@example.com', '42', 'Octo Cat', 'pro', 1)`,
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    // An unverified email does not link.
    const unverified = clerk.token({ userId: "user_x", email: "octo@example.com", emailVerified: false });
    await h.call("GET", "/api/me", { token: unverified });
    const token = clerk.token({ userId: "user_octo", email: "Octo@Example.com" });
    const me = await body<MeResponse>(await h.call("GET", "/api/me", { token }));
    expect(me.account).toMatchObject({ id: "legacy", name: "Octo Cat", email: "octo@example.com" });
    expect(me.plan.id).toBe("pro");
    expect(accounts(h).map((row) => row.clerk_user_id)).toEqual(["user_octo", "user_x"]);
  });

  it("creates one account when the first requests run in parallel", async () => {
    const h = createHarness();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const token = clerkOf(h).token({ userId: "user_ada", email: "ada@example.com" });
    const responses = await Promise.all(Array.from({ length: 4 }, () => h.call("GET", "/api/me", { token })));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(accounts(h)).toHaveLength(1);
  });

  it("uses the bearer token only: a bad token is not rescued by a dev cookie", async () => {
    const h = createHarness();
    const cookie = await h.signIn("ada");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await h.call("GET", "/api/me", { cookie, token: "forged" })).status).toBe(401);
  });

  it("answers 503 to a bearer token when Clerk is not configured", async () => {
    const h = createHarness({}, { clerk: null });
    const response = await h.call("GET", "/api/me", { token: "some.session.token" });
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ error: { code: "clerk_unconfigured" } });
  });

  it("still blocks writes from another origin", async () => {
    const h = createHarness();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const token = clerkOf(h).token({ userId: "user_ada", email: "ada@example.com" });
    const response = await h.call("POST", "/api/apps", {
      token,
      origin: "https://evil.example",
      body: { name: "App", environment: "prod" },
    });
    expect(response.status).toBe(403);
  });
});
