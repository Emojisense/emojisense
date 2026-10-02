import { encodeVectors, type VectorIndex } from "emojisense/vectors";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";
import { assetVectorReader, createLocaleVectors, type VectorReader } from "../src/locale-vectors.ts";
import type { SearchBody } from "../src/search.ts";
import { catalog, EMBEDDING_MODEL, fixtureVectors, harness, keyedSearch, unit } from "./fixtures.ts";

const shared = catalog.index();
/** Spanish vectors: the dog row sits where the fake embedding of `embedTo: 4` lands. */
const spanish = fixtureVectors([unit(0), unit(1), unit(2), unit(4)]);
const file = (locale: string) => `vectors.bge-m3.8.${locale}.bin`;

function localeVectors(options: { read?: VectorReader; maxResident?: number; locales?: string[] } = {}) {
  const read = vi.fn(options.read ?? (async () => spanish));
  const vectors = createLocaleVectors({
    shared: () => shared,
    locales: options.locales ?? ["es", "fr", "tr"],
    fileOf: file,
    read,
    maxResident: options.maxResident ?? 2,
  });
  return { read, vectors };
}

describe("createLocaleVectors", () => {
  it("searches the shared vectors alone for a locale without its own file", async () => {
    const { read, vectors } = localeVectors();
    expect(await vectors.get("en", {})).toEqual({ indexes: [shared], complete: true });
    expect(await vectors.get("hi", {})).toEqual({ indexes: [shared], complete: true });
    expect(read).not.toHaveBeenCalled();
  });

  it("adds the locale's own vectors, loaded once and shared between concurrent requests", async () => {
    const { read, vectors } = localeVectors();
    const env: Env = {};
    const [first] = await Promise.all([1, 2, 3].map(() => vectors.get("es", env)));
    await vectors.get("es", env);
    expect(first).toEqual({ indexes: [shared, spanish], complete: true });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("vectors.bge-m3.8.es.bin", env);
  });

  it("keeps the most recently used locales only", async () => {
    const { read, vectors } = localeVectors();
    for (const locale of ["es", "fr", "es", "tr"]) await vectors.get(locale, {});
    expect(vectors.resident).toEqual(["es", "tr"]);
    expect(read).toHaveBeenCalledTimes(3);
    await vectors.get("fr", {});
    expect(vectors.resident).toEqual(["tr", "fr"]);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("falls back to the shared vectors when a file cannot be read, and retries next time", async () => {
    let available = false;
    const { read, vectors } = localeVectors({
      read: async (name) => {
        if (!available) throw new Error(`${name}: HTTP 404`);
        return spanish;
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await vectors.get("es", {})).toEqual({ indexes: [shared], complete: false });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "locale_vectors_unavailable",
      locale: "es",
    });
    warn.mockRestore();
    expect(vectors.resident).toEqual([]);
    available = true;
    expect(await vectors.get("es", {})).toEqual({ indexes: [shared, spanish], complete: true });
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("semantic search with locale vectors", () => {
  function localeHarness(read?: VectorReader) {
    const { vectors } = localeVectors(read ? { read } : {});
    return harness({ catalog: { ...catalog, vectors: (l, env) => vectors.get(l, env) }, embedTo: 4 });
  }

  it("ranks with the shared vectors and the locale's own, best row per emoji", async () => {
    const h = localeHarness();
    const es = (await (await h.call(keyedSearch("perro", "&locale=es&mode=semantic"))).json()) as SearchBody;
    expect(es.results[0]).toMatchObject({ emoji: "🐶", source: "semantic" });
    expect(es.results.filter((r) => r.emoji === "🐶")).toHaveLength(1);
    const en = (await (await h.call(keyedSearch("perro", "&locale=en&mode=semantic"))).json()) as SearchBody;
    expect(en.results[0]?.emoji).not.toBe("🐶");
  });

  it("never caches an answer ranked without the locale's own vectors", async () => {
    const h = localeHarness(async (name) => Promise.reject(new Error(`${name}: HTTP 404`)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await h.call(keyedSearch("perro", "&locale=es&mode=semantic"));
    await h.ctx.settle();
    warn.mockRestore();
    const body = (await res.json()) as SearchBody;
    expect(body.degraded).toBe(false);
    expect(body.results.length).toBeGreaterThan(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The concept tier may cache its own answer; the search answer is not cached.
    expect(h.cache.puts.filter((url) => new URL(url).pathname === "/v1/search")).toHaveLength(0);
  });
});

describe("assetVectorReader", () => {
  const assets = (respond: (url: string) => Response) => {
    const fetch = vi.fn(async (url: string) => respond(url));
    return { env: { ASSETS: { fetch } } satisfies Env, fetch };
  };
  const bytes = (index: VectorIndex, model = EMBEDDING_MODEL) =>
    encodeVectors(
      model,
      index.ids,
      index.ids.map((_, r) => index.data.slice(r * index.dims, (r + 1) * index.dims)),
    );

  it("reads a published vector file of the Worker's pack version through the ASSETS binding", async () => {
    const { env, fetch } = assets(() => new Response(bytes(spanish)));
    const index = await assetVectorReader("0.1.0", { model: EMBEDDING_MODEL, dims: 8 })(file("es"), env);
    expect(index.ids).toEqual(spanish.ids);
    expect(new URL(fetch.mock.calls[0]?.[0] as string).pathname).toBe(
      "/v1/pack/0.1.0/vectors.bge-m3.8.es.bin",
    );
  });

  it("refuses a missing file, another model or dims, and a missing binding", async () => {
    const read = assetVectorReader("0.1.0", { model: EMBEDDING_MODEL, dims: 8 });
    await expect(read(file("es"), assets(() => new Response("", { status: 404 })).env)).rejects.toThrow(
      "HTTP 404",
    );
    await expect(
      read(file("es"), assets(() => new Response(bytes(spanish, "@cf/other/model"))).env),
    ).rejects.toThrow("expected @cf/baai/bge-m3@8");
    await expect(
      assetVectorReader("0.1.0", { model: EMBEDDING_MODEL, dims: 16 })(
        file("es"),
        assets(() => new Response(bytes(spanish))).env,
      ),
    ).rejects.toThrow("expected @cf/baai/bge-m3@16");
    await expect(read(file("es"), {})).rejects.toThrow("ASSETS binding missing");
  });
});
