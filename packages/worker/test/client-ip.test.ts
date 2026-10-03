import { describe, expect, it, vi } from "vitest";
import { rateLimitAddress } from "../src/client-ip.ts";
import type { RateLimiter } from "../src/env.ts";
import { harness, KEYS, search, seededStore } from "./fixtures.ts";

describe("rateLimitAddress", () => {
  it.each(["203.0.113.9", "0.0.0.0", "255.255.255.255"])("keeps the IPv4 address %s whole", (ip) => {
    expect(rateLimitAddress(ip)).toBe(ip);
  });

  it.each([
    "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
    "2001:db8:85a3::8a2e:370:7334",
    "2001:db8:85a3:0:ffff:ffff:ffff:ffff",
    "2001:DB8:85A3::",
    "2001:db8:85a3::1",
    "2001:db8:85a3:0::",
    "2001:db8:85a3:0:1:2:3::",
    "2001:db8:85a3:0:1:2:192.0.2.1",
  ])("counts %s by its /64", (ip) => {
    expect(rateLimitAddress(ip)).toBe("2001:db8:85a3:0::/64");
  });

  it.each([
    ["2001:db8:85a3:1::1", "2001:db8:85a3:1::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001:db8:1:2:3:4:5::", "2001:db8:1:2::/64"],
    ["fe80::1", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["::", "0:0:0:0::/64"],
    ["64:ff9b::192.0.2.1", "64:ff9b:0:0::/64"],
    ["ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "ffff:ffff:ffff:ffff::/64"],
  ])("counts %s as %s", (ip, expected) => {
    expect(rateLimitAddress(ip)).toBe(expected);
  });

  it.each([
    "::ffff:192.0.2.1",
    "::FFFF:192.0.2.1",
    "::ffff:c000:201",
    "0:0:0:0:0:ffff:c000:0201",
    "0000:0000:0000:0000:0000:ffff:192.0.2.1",
  ])("counts the IPv4-mapped %s as its IPv4 address", (ip) => {
    expect(rateLimitAddress(ip)).toBe("192.0.2.1");
  });

  it.each([
    "local",
    "",
    "256.0.0.1",
    "1.2.3",
    "1.2.3.4.5",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7:8::",
    "1::2::3",
    ":1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:",
    "12345::1",
    "2001:db8::g",
    "::ffff:300.0.2.1",
    "1:2:3:4:5:6:7:1.2.3.4",
    "fe80::1%eth0",
  ])("returns %j unchanged: not an address", (text) => {
    expect(rateLimitAddress(text)).toBe(text);
  });
});

describe("per-IP rate limits", () => {
  const limiter = () => vi.fn<RateLimiter["limit"]>(async () => ({ success: true }));
  const from = (ip: string, headers: Record<string, string> = {}) => ({
    headers: { "cf-connecting-ip": ip, ...headers },
  });

  it("count every IPv6 address of one /64 as one client", async () => {
    const [anon, keyed, site, misses] = [limiter(), limiter(), limiter(), limiter()];
    const h = harness({
      store: await seededStore(),
      env: {
        ANON_LIMITER: { limit: anon },
        SEARCH_LIMITER: { limit: keyed },
        SITE_LIMITER: { limit: site },
        KEY_MISS_LIMITER: { limit: misses },
        FIRST_PARTY_ORIGINS: "https://emojisense.example",
      },
    });
    const addresses = ["2001:db8:aa:bb::1", "2001:0db8:00aa:00bb:ffff:1:2:3"];
    for (const ip of addresses) {
      await h.call(search("rocket", "", from(ip)));
      await h.call(search("rocket", `&key=${KEYS.wildcard}`, from(ip)));
      await h.call(
        search("rocket", `&key=${KEYS.wildcard}`, from(ip, { Origin: "https://emojisense.example" })),
      );
      await h.call(search("rocket", `&key=pk_live_random_${ip}`, from(ip)));
    }
    const network = "2001:db8:aa:bb::/64";
    expect(anon.mock.calls).toEqual([[{ key: `anon:${network}` }], [{ key: `anon:${network}` }]]);
    expect(keyed.mock.calls).toEqual([[{ key: `key_any:${network}` }], [{ key: `key_any:${network}` }]]);
    expect(site.mock.calls).toEqual([[{ key: `site:${network}` }], [{ key: `site:${network}` }]]);
    expect(new Set(misses.mock.calls.map(([call]) => call.key))).toEqual(new Set([`keymiss:${network}`]));
  });

  it("keep IPv4 clients apart, and an IPv4-mapped address with its IPv4 client", async () => {
    const anon = limiter();
    const h = harness({ env: { ANON_LIMITER: { limit: anon } } });
    for (const ip of ["198.51.100.7", "198.51.100.8", "::ffff:198.51.100.7"]) {
      await h.call(search("rocket", "", from(ip)));
    }
    expect(anon.mock.calls.map(([call]) => call.key)).toEqual([
      "anon:198.51.100.7",
      "anon:198.51.100.8",
      "anon:198.51.100.7",
    ]);
  });
});
