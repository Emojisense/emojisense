import { originAllowed } from "@emojisense/platform";
import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/worker/http";
import { MAX_ORIGINS, normalizeOrigin, OriginError, parseAllowedOrigins } from "../../src/worker/origins";

describe("normalizeOrigin", () => {
  it.each([
    ["https://app.example.com", "https://app.example.com"],
    ["  HTTPS://App.Example.COM/  ", "https://app.example.com"],
    ["https://app.example.com:443", "https://app.example.com"],
    ["https://app.example.com:8443", "https://app.example.com:8443"],
    ["https://*.example.com", "https://*.example.com"],
    ["https://*.Example.com:8443/", "https://*.example.com:8443"],
    ["http://localhost:5173", "http://localhost:5173"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["http://[::1]:3000", "http://[::1]:3000"],
    ["https://bücher.example", "https://xn--bcher-kva.example"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });

  it.each([
    ["example.com", "must start with https://"],
    ["ftp://example.com", "must start with https://"],
    ["chrome-extension://abcdef", "must start with https://"],
    ["https://example.com/app", "is not an origin"],
    ["https://example.com?x=1", "is not an origin"],
    ["https://example.com#top", "is not an origin"],
    ["https://user@example.com", "is not an origin"],
    ["https://a.*.example.com", "only as the first label"],
    ["https://*example.com", "only as the first label"],
    ["https://*.com", "too broad"],
    ["https://*.localhost", "too broad"],
    ["http://example.com", "uses http://"],
    ["http://*.example.com", "uses http://"],
    ["https://exa mple.com", "is not an origin"],
    ["https://", "is not an origin"],
  ])("rejects %s", (input, message) => {
    expect(() => normalizeOrigin(input)).toThrowError(OriginError);
    expect(() => normalizeOrigin(input)).toThrowError(message);
  });

  it("produces patterns that the API Worker's originAllowed understands", () => {
    const allowed = ["https://*.example.com", "http://localhost:5173"].map(normalizeOrigin);
    expect(originAllowed("https://chat.example.com", allowed)).toBe(true);
    expect(originAllowed("http://localhost:5173", allowed)).toBe(true);
    expect(originAllowed("https://example.com", allowed)).toBe(false);
  });
});

describe("parseAllowedOrigins", () => {
  it("treats a missing field as an empty list and skips blank lines", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins(["", "  ", "https://a.example.com"])).toEqual(["https://a.example.com"]);
  });

  it("deduplicates after normalizing", () => {
    expect(parseAllowedOrigins(["https://A.example.com", "https://a.example.com/"])).toEqual([
      "https://a.example.com",
    ]);
  });

  it("rejects non-arrays, non-strings and long lists", () => {
    expect(() => parseAllowedOrigins("https://a.example.com")).toThrowError(HttpError);
    expect(() => parseAllowedOrigins([42])).toThrowError("array of strings");
    const many = Array.from({ length: MAX_ORIGINS + 1 }, (_, i) => `https://a${i}.example.com`);
    expect(() => parseAllowedOrigins(many)).toThrowError(`at most ${MAX_ORIGINS}`);
  });
});
