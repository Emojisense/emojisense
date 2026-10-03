import { describe, expect, it, vi } from "vitest";
import { parsePlan, submitWaitlist, validateEmail } from "../src/lib/waitlist";

const ENDPOINT = "https://dashboard.test/api/waitlist";

function respond(status: number, body: unknown = {}) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe("validateEmail", () => {
  it.each(["name@example.com", "  first.last+tag@sub.example.co  ", "a@b.io"])("accepts %s", (email) => {
    expect(validateEmail(email)).toBeUndefined();
  });

  it("asks for an address when the field is empty", () => {
    expect(validateEmail("   ")).toBe("Enter your email address.");
  });

  it.each(["name", "name@", "@example.com", "name@example", "a b@example.com", `${"a".repeat(250)}@x.io`])(
    "rejects %s",
    (email) => {
      expect(validateEmail(email)).toMatch(/valid email/);
    },
  );
});

describe("parsePlan", () => {
  it("keeps paid plans and falls back to pro", () => {
    expect(parsePlan("solo")).toBe("solo");
    expect(parsePlan("scale")).toBe("pro");
    expect(parsePlan("free")).toBe("pro");
    expect(parsePlan("enterprise")).toBe("pro");
    expect(parsePlan(null)).toBe("pro");
  });
});

describe("submitWaitlist", () => {
  it("posts { email, plan } as JSON with a trimmed address and no credentials", async () => {
    const fetch = respond(201);
    const result = await submitWaitlist(
      { email: "  ada@example.com ", plan: "pro" },
      { endpoint: ENDPOINT, fetch },
    );
    expect(result).toEqual({ ok: true, alreadyJoined: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "ada@example.com", plan: "pro" });
  });

  it("does not call the server for an invalid address", async () => {
    const fetch = respond(201);
    const result = await submitWaitlist({ email: "ada@", plan: "pro" }, { endpoint: ENDPOINT, fetch });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats an address that is already on the list as joined", async () => {
    const result = await submitWaitlist(
      { email: "ada@example.com", plan: "solo" },
      { endpoint: ENDPOINT, fetch: respond(409) },
    );
    expect(result).toEqual({ ok: true, alreadyJoined: true });
  });

  it.each([
    [400, "invalid"],
    [422, "invalid"],
    [429, "rate_limited"],
    [500, "server"],
    [503, "server"],
  ] as const)("maps HTTP %i to %s with a message for the person", async (status, reason) => {
    const result = await submitWaitlist(
      { email: "ada@example.com", plan: "pro" },
      { endpoint: ENDPOINT, fetch: respond(status, { error: "internal detail" }) },
    );
    expect(result).toMatchObject({ ok: false, reason });
    if (!result.ok) {
      expect(result.message).not.toContain("internal detail");
      expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it("reports a network failure instead of throwing", async () => {
    const fakeFetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await submitWaitlist(
      { email: "ada@example.com", plan: "pro" },
      { endpoint: ENDPOINT, fetch: fakeFetch },
    );
    expect(result).toMatchObject({ ok: false, reason: "network" });
  });

  it("gives up after the timeout", async () => {
    const fakeFetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const result = await submitWaitlist(
      { email: "ada@example.com", plan: "pro" },
      { endpoint: ENDPOINT, fetch: fakeFetch, timeoutMs: 10 },
    );
    expect(result).toMatchObject({ ok: false, reason: "network" });
  });
});
