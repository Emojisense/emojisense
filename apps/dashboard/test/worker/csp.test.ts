/** The SPA's Content-Security-Policy (static-headers.ts), with and without Clerk. */
import { describe, expect, it } from "vitest";
import { clerkFrontendApi } from "../../src/shared/clerk";
import { headersFor } from "../../static-headers";

function csp(headers: string): Map<string, string[]> {
  const line = headers.split("\n").find((row) => row.trim().startsWith("Content-Security-Policy:")) ?? "";
  const value = line.slice(line.indexOf(":") + 1).trim();
  return new Map(
    value.split("; ").map((part) => {
      const [name = "", ...values] = part.split(" ");
      return [name, values];
    }),
  );
}

const API = "https://api.emojisense.com";

describe("static headers", () => {
  it("stays strict without Clerk", () => {
    const policy = csp(headersFor(API));
    expect(policy.get("script-src")).toEqual(["'self'"]);
    expect(policy.get("style-src")).toEqual(["'self'"]);
    expect(policy.get("connect-src")).toEqual(["'self'", API]);
    expect(policy.get("img-src")).toEqual(["'self'", "data:", "blob:", API]);
    expect(policy.has("frame-src")).toBe(false);
    expect(policy.has("worker-src")).toBe(false);
  });

  it("adds exactly Clerk's hosts for the instance in the publishable key", () => {
    const host = clerkFrontendApi("pk_test_ZmVhc2libGUtYmxvd2Zpc2gtOTY4MC5jbGVyay5hY2NvdW50cy5kZXYk");
    const policy = csp(headersFor(API, host));
    const clerk = "https://feasible-blowfish-9680.clerk.accounts.dev";
    expect(policy.get("script-src")).toEqual([
      "'self'",
      clerk,
      "https://challenges.cloudflare.com",
      "https://*.protect.clerk.com",
    ]);
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("connect-src")).toEqual(["'self'", API, clerk, "https://*.protect.clerk.com:*"]);
    expect(policy.get("img-src")).toEqual(["'self'", "data:", "blob:", API, "https://img.clerk.com"]);
    expect(policy.get("frame-src")).toEqual([
      "https://challenges.cloudflare.com",
      "https://*.protect.clerk.com",
    ]);
    expect(policy.get("worker-src")).toEqual(["'self'", "blob:"]);
    // The rest stays as strict as before.
    for (const [name, value] of [
      ["default-src", ["'self'"]],
      ["font-src", ["'self'"]],
      ["form-action", ["'self'"]],
      ["frame-ancestors", ["'none'"]],
      ["base-uri", ["'none'"]],
      ["object-src", ["'none'"]],
    ] as const) {
      expect(policy.get(name)).toEqual(value);
    }
  });
});
