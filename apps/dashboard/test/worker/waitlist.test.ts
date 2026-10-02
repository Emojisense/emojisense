import { waitlistReturnUrl } from "@emojisense/platform";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../../src/worker/app";
import { BASE, body, createHarness, NOW, WEBSITE } from "./harness";

const join = (h: ReturnType<typeof createHarness>, payload: unknown, origin: string | null = WEBSITE) =>
  h.call("POST", "/api/waitlist", { body: payload, origin });

/** What a browser sends for a form submit without JavaScript. */
const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

const postForm = (
  h: ReturnType<typeof createHarness>,
  form: Record<string, string>,
  options: { origin?: string | null; accept?: string } = {},
) =>
  h.call("POST", "/api/waitlist", {
    urlencoded: form,
    origin: options.origin === undefined ? WEBSITE : options.origin,
    headers: { accept: options.accept ?? BROWSER_ACCEPT },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/waitlist", () => {
  it("stores a normalized email and is idempotent", async () => {
    const h = createHarness();
    const first = await join(h, { email: " Ada@Example.com ", plan: "pro" });
    expect(first.status).toBe(200);
    expect(await body(first)).toEqual({ ok: true, plan: "pro" });

    h.clock.now = NOW + 60_000;
    const again = await join(h, { email: "ada@example.com", plan: "scale" });
    expect(again.status).toBe(200);
    expect(h.db.rows("SELECT * FROM waitlist")).toEqual([
      { email: "ada@example.com", plan: "scale", created_at: NOW },
    ]);
  });

  it("defaults the plan to pro", async () => {
    const h = createHarness();
    expect(await body(await join(h, { email: "a@example.com" }))).toEqual({ ok: true, plan: "pro" });
  });

  it.each([
    [{}, "email"],
    [{ email: "not-an-email" }, "email"],
    [{ email: "a@b" }, "email"],
    [{ email: `${"a".repeat(250)}@example.com` }, "email"],
    [{ email: "a@example.com", plan: "free" }, "plan"],
  ])("rejects %j", async (payload, field) => {
    const h = createHarness();
    const response = await join(h, payload);
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "invalid_request", field } });
    expect(response.headers.get("access-control-allow-origin")).toBe(WEBSITE);
  });

  it("needs no session and works from the dashboard itself", async () => {
    const h = createHarness();
    const response = await join(h, { email: "a@example.com" }, BASE);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("is rate limited", async () => {
    const h = createHarness({ WAITLIST_LIMITER: { limit: async () => ({ success: false }) } });
    const response = await join(h, { email: "a@example.com" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(h.db.rows("SELECT * FROM waitlist")).toHaveLength(0);
  });

  it("stops reading a chunked body at 16 KB instead of buffering all of it", async () => {
    const h = createHarness();
    let chunksRead = 0;
    // 10 MB in 1 KB chunks, without a Content-Length (Transfer-Encoding: chunked).
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead++;
        if (chunksRead > 10_240) controller.close();
        else controller.enqueue(new Uint8Array(1024).fill(0x20));
      },
    });
    const request = new Request(`${BASE}/api/waitlist`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEBSITE },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const response = await handleRequest(request, h.env, { fetch: vi.fn(), now: () => NOW });
    expect(response.status).toBe(413);
    expect(await body(response)).toMatchObject({ error: { code: "body_too_large" } });
    expect(chunksRead).toBeLessThan(40);
  });
});

describe("waitlist CORS", () => {
  it("answers the preflight of the website origin only", async () => {
    const h = createHarness({ WEBSITE_ORIGINS: `http://localhost:4321, ${WEBSITE}` });
    const allowed = await h.call("OPTIONS", "/api/waitlist", { origin: WEBSITE });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(WEBSITE);
    expect(allowed.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(allowed.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();

    const other = await h.call("OPTIONS", "/api/waitlist", { origin: "https://evil.example" });
    expect(other.status).toBe(403);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses posts from other websites", async () => {
    const h = createHarness();
    const response = await join(h, { email: "a@example.com" }, "https://evil.example");
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(h.db.rows("SELECT * FROM waitlist")).toHaveLength(0);
  });

  it("has no CORS when no website origin is configured", async () => {
    const h = createHarness({ WEBSITE_ORIGINS: "" });
    expect((await h.call("OPTIONS", "/api/waitlist", { origin: WEBSITE })).status).toBe(403);
  });
});

describe("waitlist form posts without JavaScript", () => {
  it("stores the form fields and sends the browser back to the website with status=ok", async () => {
    const h = createHarness();
    const response = await postForm(h, { email: " Ada@Example.com ", plan: "scale" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${WEBSITE}/waitlist/?status=ok#waitlist-joined`);
    expect(response.headers.get("location")).toBe(waitlistReturnUrl(WEBSITE, "ok"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).not.toContain("ada");
    expect(h.db.rows("SELECT * FROM waitlist")).toEqual([
      { email: "ada@example.com", plan: "scale", created_at: NOW },
    ]);
  });

  it("defaults the plan to pro, like the JSON body", async () => {
    const h = createHarness();
    expect((await postForm(h, { email: "a@example.com" })).status).toBe(303);
    expect(h.db.rows("SELECT plan FROM waitlist")).toEqual([{ plan: "pro" }]);
  });

  it("returns to the website that posted", async () => {
    const h = createHarness({ WEBSITE_ORIGINS: `${WEBSITE},http://localhost:4321` });
    const response = await postForm(h, { email: "a@example.com" }, { origin: "http://localhost:4321" });
    expect(response.headers.get("location")).toBe(
      "http://localhost:4321/waitlist/?status=ok#waitlist-joined",
    );
  });

  it.each([[{ email: "not-an-email" }], [{ email: "a@example.com", plan: "free" }], [{}]])(
    "sends %j back with status=error and stores nothing",
    async (form) => {
      const h = createHarness();
      const response = await postForm(h, form);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${WEBSITE}/waitlist/?status=error#waitlist-failed`);
      expect(h.db.rows("SELECT * FROM waitlist")).toHaveLength(0);
    },
  );

  it("keeps the rate limit and answers it with status=error", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const h = createHarness({ WAITLIST_LIMITER: { limit } });
    const response = await postForm(h, { email: "a@example.com" });
    expect(limit).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(waitlistReturnUrl(WEBSITE, "error"));
    expect(h.db.rows("SELECT * FROM waitlist")).toHaveLength(0);
  });

  it("refuses form posts from other websites with a 403 and no redirect", async () => {
    const h = createHarness();
    const response = await postForm(h, { email: "a@example.com" }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    expect(await body(response)).toMatchObject({ error: { code: "forbidden_origin" } });
    expect(h.db.rows("SELECT * FROM waitlist")).toHaveLength(0);
  });

  it("answers JSON when the client asks for it", async () => {
    const h = createHarness();
    const response = await postForm(h, { email: "a@example.com" }, { accept: "application/json" });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, plan: "pro" });
    expect(response.headers.get("access-control-allow-origin")).toBe(WEBSITE);
  });

  it("sends a post without Origin to the first website, or answers JSON when none is configured", async () => {
    const configured = createHarness({ WEBSITE_ORIGINS: `${WEBSITE}, http://localhost:4321` });
    const response = await postForm(configured, { email: "a@example.com" }, { origin: null });
    expect(response.headers.get("location")).toBe(waitlistReturnUrl(WEBSITE, "ok"));

    const none = createHarness({ WEBSITE_ORIGINS: "" });
    const plain = await postForm(none, { email: "b@example.com" }, { origin: null });
    expect(plain.status).toBe(200);
    expect(await body(plain)).toEqual({ ok: true, plan: "pro" });
  });

  it("logs an unexpected failure without the email and sends status=error", async () => {
    const h = createHarness();
    h.db.exec("DROP TABLE waitlist");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await postForm(h, { email: "ada@example.com" });
    expect(response.headers.get("location")).toBe(waitlistReturnUrl(WEBSITE, "error"));
    expect(error).toHaveBeenCalledTimes(1);
    const logged = String(error.mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toMatchObject({ event: "unhandled_error", route: "POST /api/waitlist" });
    expect(logged).not.toContain("ada@example.com");
  });

  it("refuses other body types", async () => {
    const h = createHarness();
    const response = await h.call("POST", "/api/waitlist", {
      origin: WEBSITE,
      headers: { "content-type": "text/plain" },
    });
    expect(response.status).toBe(415);
    expect(await body(response)).toMatchObject({ error: { code: "unsupported_media_type" } });
  });
});
