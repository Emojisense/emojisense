import { describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../../src/shared/contract";
import { sha256Hex } from "../../src/worker/crypto";
import { SESSION_TTL_MS } from "../../src/worker/session";
import { BASE, body, createHarness, NOW, sessionCookieFrom, setCookies } from "./harness";

const GITHUB_ENV = { GITHUB_CLIENT_ID: "client-id", GITHUB_CLIENT_SECRET: "client-secret" };

describe("dev sign-in", () => {
  it("creates a session cookie and stores only the token's SHA-256", async () => {
    const h = createHarness();
    const response = await h.call("GET", "/api/auth/dev?login=ada");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/apps");
    const [cookie] = setCookies(response);
    expect(cookie).toMatch(
      /^es_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/,
    );

    const token = sessionCookieFrom(response).split("=")[1] ?? "";
    const sessions = h.db.rows<{ id: string; expires_at: number }>("SELECT id, expires_at FROM sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(await sha256Hex(token));
    expect(sessions[0]?.id).not.toContain(token);
    expect(sessions[0]?.expires_at).toBe(NOW + SESSION_TTL_MS);
  });

  it("reuses the account for the same login", async () => {
    const h = createHarness();
    await h.signIn("ada");
    await h.signIn("ada");
    expect(h.db.rows("SELECT id FROM accounts")).toHaveLength(1);
    expect(h.db.rows("SELECT id FROM sessions")).toHaveLength(2);
  });

  it("is off outside development and outside localhost", async () => {
    const production = createHarness({ ENVIRONMENT: "production" });
    expect((await production.call("GET", "/api/auth/dev")).status).toBe(404);

    const remote = createHarness();
    const response = await remote.call("GET", "/api/auth/dev", { base: "https://dash.emojisense.example" });
    expect(response.status).toBe(404);
    expect(remote.db.rows("SELECT id FROM accounts")).toHaveLength(0);
  });

  it("rejects a login name that is not a simple handle", async () => {
    const h = createHarness();
    const response = await h.call("GET", "/api/auth/dev?login=a%20b");
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "invalid_request", field: "login" } });
  });
});

describe("sessions", () => {
  it("answers 401 without a valid session", async () => {
    const h = createHarness();
    const anonymous = await h.call("GET", "/api/me");
    expect(anonymous.status).toBe(401);
    expect(await body(anonymous)).toEqual({
      error: { code: "unauthorized", message: "Sign in to continue." },
    });
    expect((await h.call("GET", "/api/me", { cookie: "es_session=forged" })).status).toBe(401);
    expect((await h.call("GET", "/api/me", { cookie: `es_session=${"a".repeat(43)}` })).status).toBe(401);
  });

  it("returns the account and plan for a valid session", async () => {
    const h = createHarness();
    const cookie = await h.signIn("ada");
    const response = await h.call("GET", "/api/me", { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const me = await body<MeResponse>(response);
    expect(me.account).toMatchObject({ name: "ada", email: "ada@dev.localhost", githubLinked: false });
    expect(me.plan).toMatchObject({ id: "free", maxApps: 1, limits: { semantic_calls: 100_000 } });
    expect(me.appCount).toBe(0);
    expect(me.waitlistPlan).toBeNull();
  });

  it("expires after 30 days", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    h.clock.now = NOW + SESSION_TTL_MS - 1;
    expect((await h.call("GET", "/api/me", { cookie })).status).toBe(200);
    h.clock.now = NOW + SESSION_TTL_MS;
    expect((await h.call("GET", "/api/me", { cookie })).status).toBe(401);
  });

  it("logs out: deletes the session and clears the cookie", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    const response = await h.call("POST", "/api/auth/logout", { cookie });
    expect(response.status).toBe(200);
    expect(setCookies(response)[0]).toMatch(/^es_session=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax$/);
    expect(h.db.rows("SELECT id FROM sessions")).toHaveLength(0);
    expect((await h.call("GET", "/api/me", { cookie })).status).toBe(401);
  });

  it("refuses a logout posted from another origin", async () => {
    const h = createHarness();
    const cookie = await h.signIn();
    const response = await h.call("POST", "/api/auth/logout", { cookie, origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(h.db.rows("SELECT id FROM sessions")).toHaveLength(1);
  });
});

describe("GitHub OAuth", () => {
  function githubFetch(options: { emails?: unknown; tokenBody?: unknown } = {}) {
    return async (input: string, init?: RequestInit): Promise<Response> => {
      if (input === "https://github.com/login/oauth/access_token") {
        const sent = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(sent).toMatchObject({
          client_id: "client-id",
          client_secret: "client-secret",
          code: "the-code",
        });
        return Response.json(options.tokenBody ?? { access_token: "gho_secret_token", token_type: "bearer" });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer gho_secret_token");
      if (input === "https://api.github.com/user")
        return Response.json({ id: 42, login: "octo", name: "Octo Cat" });
      if (input === "https://api.github.com/user/emails") {
        return Response.json(
          options.emails ?? [
            { email: "old@example.com", primary: false, verified: true },
            { email: "Octo@Example.com", primary: true, verified: true },
          ],
        );
      }
      throw new Error(`unexpected fetch ${input}`);
    };
  }

  async function start(h: ReturnType<typeof createHarness>, base = BASE) {
    const response = await h.call("GET", "/api/auth/github", { base });
    const location = new URL(response.headers.get("location") ?? "");
    const state = location.searchParams.get("state") ?? "";
    return { response, location, state, cookie: `es_oauth_state=${state}` };
  }

  it("explains when GitHub is not configured", async () => {
    const h = createHarness();
    const response = await h.call("GET", "/api/auth/github");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/?error=github_unconfigured");
  });

  it("redirects to GitHub with a state bound to a short-lived cookie", async () => {
    const h = createHarness(GITHUB_ENV);
    const { response, location, state } = await start(h, "https://dash.emojisense.example");
    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://dash.emojisense.example/api/auth/github/callback",
    );
    expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(setCookies(response)[0]).toBe(
      `es_oauth_state=${state}; Path=/api/auth/github; Max-Age=600; HttpOnly; SameSite=Lax; Secure`,
    );
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const h = createHarness(GITHUB_ENV);
    const { state } = await start(h);
    for (const cookie of [undefined, "es_oauth_state=other"]) {
      const response = await h.call("GET", `/api/auth/github/callback?code=the-code&state=${state}`, {
        cookie,
      });
      expect(response.headers.get("location")).toBe("/?error=github_state");
      expect(setCookies(response)[0]).toMatch(/^es_oauth_state=; Path=\/api\/auth\/github; Max-Age=0/);
    }
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.db.rows("SELECT id FROM accounts")).toHaveLength(0);
  });

  it("reports a cancelled authorization", async () => {
    const h = createHarness(GITHUB_ENV);
    const { state, cookie } = await start(h);
    const response = await h.call("GET", `/api/auth/github/callback?error=access_denied&state=${state}`, {
      cookie,
    });
    expect(response.headers.get("location")).toBe("/?error=github_denied");
  });

  it("signs in, stores the verified primary email and never the access token", async () => {
    const h = createHarness(GITHUB_ENV);
    h.fetchMock.mockImplementation(githubFetch());
    const { state, cookie } = await start(h);
    const response = await h.call("GET", `/api/auth/github/callback?code=the-code&state=${state}`, {
      cookie,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/apps");
    const session = sessionCookieFrom(response);
    const accounts = h.db.rows<{ github_id: string; email: string; name: string }>("SELECT * FROM accounts");
    expect(accounts).toEqual([
      expect.objectContaining({ github_id: "42", email: "octo@example.com", name: "Octo Cat" }),
    ]);
    const dump = JSON.stringify([h.db.rows("SELECT * FROM accounts"), h.db.rows("SELECT * FROM sessions")]);
    expect(dump).not.toContain("gho_secret_token");

    const me = await body<MeResponse>(await h.call("GET", "/api/me", { cookie: session }));
    expect(me.account).toMatchObject({ name: "Octo Cat", githubLinked: true });

    // A second sign-in finds the same account by GitHub id.
    const again = await start(h);
    await h.call("GET", `/api/auth/github/callback?code=the-code&state=${again.state}`, {
      cookie: again.cookie,
    });
    expect(h.db.rows("SELECT id FROM accounts")).toHaveLength(1);
  });

  it("leaves out an unverified email", async () => {
    const h = createHarness(GITHUB_ENV);
    h.fetchMock.mockImplementation(
      githubFetch({ emails: [{ email: "x@example.com", primary: true, verified: false }] }),
    );
    const { state, cookie } = await start(h);
    await h.call("GET", `/api/auth/github/callback?code=the-code&state=${state}`, { cookie });
    expect(h.db.rows<{ email: string | null }>("SELECT email FROM accounts")).toEqual([{ email: null }]);
  });

  it("redirects with an error when GitHub rejects the code", async () => {
    const h = createHarness(GITHUB_ENV);
    h.fetchMock.mockImplementation(githubFetch({ tokenBody: { error: "bad_verification_code" } }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { state, cookie } = await start(h);
    const response = await h.call("GET", `/api/auth/github/callback?code=the-code&state=${state}`, {
      cookie,
    });
    expect(response.headers.get("location")).toBe("/?error=github_failed");
    expect(h.db.rows("SELECT id FROM sessions")).toHaveLength(0);
    expect(log.mock.calls[0]?.[0]).toContain("bad_verification_code");
    expect(log.mock.calls[0]?.[0]).not.toContain("the-code");
    log.mockRestore();
  });
});
