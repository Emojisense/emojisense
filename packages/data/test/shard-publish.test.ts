import { describe, expect, it } from "vitest";
import { buildShards } from "../src/shards/build.ts";
import { contentFile, hashLayer, relativeTo, resolveFrom } from "../src/shards/publish.ts";
import { createFakeResolver } from "../src/shards/resolvers.ts";
import { catalog } from "./fixture.ts";

describe("published shard layout", () => {
  it("names a file by the first 16 hex digits of its SHA-256", async () => {
    const file = await contentFile('{"key":"a","entries":{}}');
    expect(file.path).toMatch(/^f\/[0-9a-f]{16}\.json$/);
    expect((await contentFile('{"key":"a","entries":{}}')).path).toBe(file.path);
    expect((await contentFile('{"key":"b","entries":{}}')).path).not.toBe(file.path);
  });

  it("writes file URLs relative to the index that names them, and reads them back", () => {
    expect(relativeTo("", "f/abc.json")).toBe("f/abc.json");
    expect(relativeTo("tr/", "f/abc.json")).toBe("../f/abc.json");
    expect(relativeTo("f/", "f/abc.json")).toBe("abc.json");
    for (const dir of ["", "tr/", "f/"])
      expect(resolveFrom(dir, relativeTo(dir, "f/abc.json"))).toBe("f/abc.json");
    // The same rule as a browser's URL resolution.
    expect(new URL("../f/abc.json", "https://cdn.test/p/1/tr/index.json").pathname).toBe("/p/1/f/abc.json");
  });

  it("hashes a build's shards and names them in its index", async () => {
    const built = await buildShards({
      queries: ["ship it", "sad dog", "so tired"].map((q) => ({ q, n: 5, locales: ["en"] })),
      reachesWorker: () => true,
      resolver: createFakeResolver(catalog),
      packVersion: "t",
      maxShardBytes: 10_000,
    });
    const layer = await hashLayer(built, "tr/");
    expect(Object.keys(layer.index.files ?? {})).toEqual(built.index.keys);
    for (const key of built.index.keys) {
      const path = layer.paths[key] as string;
      expect(layer.index.files?.[key]).toBe(`../${path}`);
      const file = layer.files.find((f) => f.path === path);
      expect(JSON.parse(file?.json ?? "{}").key).toBe(key);
      expect((await contentFile(file?.json ?? "")).path).toBe(path);
    }
  });
});
