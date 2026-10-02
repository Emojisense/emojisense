import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine.js";
import { fuseResults } from "../src/fusion.js";
import { groupLabel } from "../src/groups.js";
import { loadCustomPack } from "../src/loader.js";
import { custom, en, tr } from "./fixture.js";

describe("custom packs in the engine", () => {
  const engine = createEngine([en, tr, custom]);

  it("adds custom rows after the catalog, with their image and shortcode", () => {
    expect(engine.entries).toHaveLength(en.emoji.length + 2);
    expect(engine.get("C-e1")).toMatchObject({
      emoji: ":party_parrot:",
      group: "custom",
      imageUrl: "https://api.test/v1/custom/app1/e1",
      shortcode: "party_parrot",
      hasSkinTones: false,
    });
    expect(engine.locales).toEqual(["en", "tr"]);
    expect(engine.packVersion).toBe("test");
  });

  it("finds custom emoji by shortcode words and aliases, with source custom", () => {
    const [first] = engine.search("party parrot").results;
    expect(first).toMatchObject({
      emoji: ":party_parrot:",
      id: "C-e1",
      source: "custom",
      imageUrl: "https://api.test/v1/custom/app1/e1",
      shortcode: "party_parrot",
      label: "party_parrot",
    });
    expect(engine.search("squirrel").results[0]?.id).toBe("C-e2");
  });

  it("ranks custom and catalog emoji together", () => {
    const ids = engine.search("ship it").results.map((r) => r.id);
    expect(ids).toContain("C-e2");
    expect(ids).toContain("1F680");
  });

  it("does not penalize custom phrases in any locale", () => {
    const inTurkish = engine.search("celebrate", { locale: "tr" }).results[0];
    const inEnglish = engine.search("celebrate", { locale: "en" }).results[0];
    expect(inTurkish?.score).toBe(inEnglish?.score);
  });

  it("keeps catalog results unchanged in shape", () => {
    const [rocket] = engine.search("rocket").results;
    expect(rocket?.source).toBe("alias");
    expect(rocket).not.toHaveProperty("imageUrl");
    expect(rocket).not.toHaveProperty("shortcode");
  });

  it("works with a custom pack alone, e.g. on the server", () => {
    const only = createEngine(custom);
    expect(only.search("dance").results[0]).toMatchObject({ id: "C-e1", source: "custom" });
    expect(only.locales).toEqual([]);
  });

  it("keeps imageUrl through fusion", () => {
    const alias = engine.search("shipit").results;
    const fused = fuseResults(alias, [{ emoji: "🚀", id: "1F680", score: 0.8, source: "semantic" }]);
    expect(fused.find((r) => r.id === "C-e2")?.imageUrl).toBe("https://api.test/v1/custom/app1/e2");
  });

  it("labels the custom group", () => {
    expect(groupLabel("custom")).toBe("Custom");
    expect(groupLabel("custom", "tr")).toBe("Özel");
  });
});

describe("loadCustomPack", () => {
  it("asks the API for the key's custom pack, with the tenant", async () => {
    const urls: string[] = [];
    const fetch = async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify(custom));
    };
    const pack = await loadCustomPack({
      endpoint: "https://api.test/",
      key: "pk_live_x",
      tenant: "acme 1",
      fetch,
    });
    expect(pack.images?.["C-e1"]).toBe("https://api.test/v1/custom/app1/e1");
    expect(urls).toEqual(["https://api.test/v1/custom-pack?key=pk_live_x&tenant=acme+1"]);
  });

  it("rejects failed requests and packs that are not custom", async () => {
    const status = async () => new Response("{}", { status: 401 });
    await expect(loadCustomPack({ endpoint: "https://api.test", key: "k", fetch: status })).rejects.toThrow(
      /HTTP 401/,
    );
    const regular = async () => new Response(JSON.stringify(en));
    await expect(loadCustomPack({ endpoint: "https://api.test", key: "k", fetch: regular })).rejects.toThrow(
      /not a custom emoji pack/,
    );
  });
});
