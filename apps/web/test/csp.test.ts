import { describe, expect, it } from "vitest";
import {
  addToAllPaths,
  buildContentSecurityPolicy,
  hashSource,
  scanInlineContent,
} from "../src/integrations/csp";

const EMPTY_HASH = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

describe("scanInlineContent", () => {
  it("hashes classic and module inline scripts, and skips external scripts and data blocks", () => {
    const html = [
      "<script>a()</script>",
      '<script type="module">b()</script>',
      '<script type="module" src="/_astro/c.js"></script>',
      '<script type="application/ld+json">{"@type":"WebSite"}</script>',
    ].join("");
    expect(scanInlineContent(html).scripts).toEqual([hashSource("a()"), hashSource("b()")]);
  });

  it("hashes <style> elements, empty ones included", () => {
    expect(scanInlineContent("<style>.a{color:red}</style><style></style>").styles).toEqual([
      hashSource(".a{color:red}"),
      EMPTY_HASH,
    ]);
  });

  it("matches the browser's hash: SHA-256 of the UTF-8 text, base64", () => {
    expect(hashSource("")).toBe(EMPTY_HASH);
  });

  it("reports inline event handlers and javascript: URLs", () => {
    const html =
      '<link rel="stylesheet" href="/a.css" media="print" onload="this.media=\'all\'">' +
      '<a href=" javascript:alert(1)">x</a><button onClick=go()>y</button>';
    expect(scanInlineContent(html).blocked).toHaveLength(3);
  });

  it("ignores look-alikes in attribute values, script bodies and comments", () => {
    const html = [
      '<p data-note="turn onload=x on" title="javascript: the language">a</p>',
      "<script>if (a<b && c>d) x()</script>",
      '<!-- <img onerror="x()"> -->',
      "<code>&lt;img onerror=&quot;x()&quot;&gt;</code>",
    ].join("");
    expect(scanInlineContent(html).blocked).toEqual([]);
  });
});

describe("buildContentSecurityPolicy", () => {
  const policy = buildContentSecurityPolicy({
    apiUrl: "https://api.example.com/",
    dashboardUrl: "https://app.example.com/some/path",
    scriptHashes: [hashSource("b"), hashSource("a"), hashSource("a")],
    styleHashes: [EMPTY_HASH],
  });
  const directive = (name: string) => policy.split("; ").find((d) => d.startsWith(`${name} `));

  it("allows the API and the dashboard by origin", () => {
    expect(directive("connect-src")).toBe(
      "connect-src 'self' https://api.example.com https://app.example.com",
    );
    expect(directive("form-action")).toBe("form-action 'self' https://app.example.com");
  });

  it("adds the shard and stats hosts when the pages use them", () => {
    const withHosts = buildContentSecurityPolicy({
      apiUrl: "https://api.example.com",
      dashboardUrl: "https://app.example.com",
      shardsUrl: "https://cdn.example.com/p/0.1.0",
      statsUrl: "https://stats.example.com",
      scriptHashes: [],
      styleHashes: [],
    });
    expect(withHosts.split("; ").find((d) => d.startsWith("connect-src "))).toBe(
      "connect-src 'self' https://api.example.com https://app.example.com https://cdn.example.com https://stats.example.com",
    );
    // Shards on the API host (the default) add nothing.
    const sameHost = buildContentSecurityPolicy({
      apiUrl: "https://api.example.com",
      dashboardUrl: "https://app.example.com",
      shardsUrl: "https://api.example.com/p/0.1.0",
      scriptHashes: [],
      styleHashes: [],
    });
    expect(sameHost).toContain("connect-src 'self' https://api.example.com https://app.example.com;");
  });

  it("allows the analytics tags only when the pages load them", () => {
    expect(policy).not.toMatch(/cloudflareinsights|google/);
    const withAnalytics = buildContentSecurityPolicy({
      apiUrl: "https://api.example.com",
      dashboardUrl: "https://app.example.com",
      cloudflareAnalytics: true,
      googleAnalytics: true,
      scriptHashes: [hashSource("a")],
      styleHashes: [],
    });
    const find = (name: string) => withAnalytics.split("; ").find((d) => d.startsWith(`${name} `));
    expect(find("script-src")).toBe(
      `script-src 'self' https://static.cloudflareinsights.com https://*.googletagmanager.com ${hashSource("a")}`,
    );
    expect(find("connect-src")).toBe(
      "connect-src 'self' https://api.example.com https://app.example.com https://cloudflareinsights.com " +
        "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    );
    expect(find("img-src")).toBe(
      "img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com",
    );
  });

  it("allows inline scripts and styles only by hash, sorted and without duplicates", () => {
    expect(directive("script-src")).toBe(
      `script-src 'self' ${[hashSource("a"), hashSource("b")].sort().join(" ")}`,
    );
    expect(directive("style-src")).toBe(`style-src 'self' ${EMPTY_HASH}`);
    expect(policy).not.toMatch(/(?:^|; )(?:script|style)-src [^;]*'unsafe-/);
  });

  it("forbids framing, plugins and <base>", () => {
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'none'");
  });

  it("stops on a URL that has no origin", () => {
    expect(() =>
      buildContentSecurityPolicy({
        apiUrl: "/api",
        dashboardUrl: "https://a.test",
        scriptHashes: [],
        styleHashes: [],
      }),
    ).toThrow(/PUBLIC_API_URL must be an absolute URL/);
  });
});

describe("addToAllPaths", () => {
  it("adds the header to the existing /* rule, so there is one rule per path", () => {
    const file = "# comment\n/*\n  X-A: 1\n\n/_astro/*\n  X-B: 2\n";
    expect(addToAllPaths(file, "X-C: 3")).toBe("# comment\n/*\n  X-C: 3\n  X-A: 1\n\n/_astro/*\n  X-B: 2\n");
  });

  it("starts a /* rule when there is none", () => {
    expect(addToAllPaths("", "X-C: 3")).toBe("/*\n  X-C: 3\n");
    expect(addToAllPaths("/a\n  X-A: 1\n", "X-C: 3")).toBe("/a\n  X-A: 1\n\n/*\n  X-C: 3\n");
  });
});
