import { describe, expect, it } from "vitest";
import { assetHeaders, IMMUTABLE, MAX_HEADER_RULES, PACK_MISS } from "../scripts/asset-headers.ts";

const files = ["pack.en.json", "pack.en.ext.json", "vectors.bge-m3.1024.bin", "manifest.json"];
const text = assetHeaders("0.1.0", files);

/**
 * The headers Cloudflare's asset layer sends for `path` (workers-shared asset-worker): every
 * matching rule in file order detaches its `! Name` headers, then sets its headers; a header that
 * an earlier rule set is appended to (comma-joined).
 */
function served(path: string, base: Record<string, string> = {}): Record<string, string> {
  const headers = new Headers(base);
  const setByRules = new Set<string>();
  for (const block of text.trim().split(/\n(?=\S)/)) {
    const [pattern = "", ...lines] = block.split("\n").map((line) => line.trim());
    const regex = new RegExp(
      `^${pattern
        .split("*")
        .map((s) => s.replace(/[.?+^$()[\]{}|\\/-]/g, "\\$&"))
        .join(".*")}$`,
    );
    if (!regex.test(path)) continue;
    for (const line of lines.filter((l) => l.startsWith("! "))) headers.delete(line.slice(2));
    for (const line of lines.filter((l) => !l.startsWith("! "))) {
      const [name = "", value = ""] = line.split(/:\s*/, 2);
      if (setByRules.has(name.toLowerCase())) headers.append(name, value);
      else headers.set(name, value);
      setByRules.add(name.toLowerCase());
    }
  }
  return Object.fromEntries(headers);
}

describe("asset _headers", () => {
  it("lists every published pack file after the /v1/pack/* rule", () => {
    expect(text).toBe(
      [
        "/v1/pack/*",
        "  Cache-Control: no-store",
        "  Access-Control-Allow-Origin: *",
        ...files.flatMap((file) => [
          `/v1/pack/0.1.0/${file}`,
          "  ! Cache-Control",
          "  Cache-Control: public, max-age=31536000, immutable",
        ]),
        "/p/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "  Access-Control-Allow-Origin: *",
        "/v1/culture/*",
        "  Cache-Control: public, max-age=3600",
        "  Access-Control-Allow-Origin: *",
        "",
      ].join("\n"),
    );
  });

  it("makes a published pack file immutable, with one CORS header", () => {
    const assetDefault = { "Cache-Control": "public, max-age=0, must-revalidate" };
    for (const file of files) {
      expect(served(`/v1/pack/0.1.0/${file}`, assetDefault)).toEqual({
        "access-control-allow-origin": "*",
        "cache-control": IMMUTABLE,
      });
    }
  });

  it("never lets a browser keep a 404 for a missing pack file or another version", () => {
    for (const path of ["/v1/pack/0.1.0/pack.xx.json", "/v1/pack/0.0.9/manifest.json", "/v1/pack/0.1.0/"]) {
      expect(served(path)).toEqual({ "access-control-allow-origin": "*", "cache-control": PACK_MISS });
    }
  });

  it("keeps the shard and culture rules", () => {
    expect(served("/p/0.1.0/en/ab.json")["cache-control"]).toBe(IMMUTABLE);
    expect(served("/v1/culture/0.1.0/culture.en.json")["cache-control"]).toBe("public, max-age=3600");
  });

  it("fails instead of writing more rules than Cloudflare reads", () => {
    const many = Array.from({ length: MAX_HEADER_RULES }, (_, i) => `pack.${i}.json`);
    expect(() => assetHeaders("0.1.0", many)).toThrow(/Cloudflare reads only 100/);
  });
});
