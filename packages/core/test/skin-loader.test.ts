import { describe, expect, it } from "vitest";
import { loadPacks } from "../src/loader.js";
import { applySkinTone } from "../src/skin.js";
import { en, tr } from "./fixture.js";

describe("applySkinTone", () => {
  it.each([
    ["👍", "medium", "👍🏽"],
    ["🧑‍💻", "dark", "🧑🏿‍💻"],
    ["✌️", "light", "✌🏻"],
    ["🧑‍🤝‍🧑", "medium-dark", "🧑🏾‍🤝‍🧑🏾"],
    ["🚀", "dark", "🚀"],
    ["👍", "none", "👍"],
  ] as const)("%s + %s → %s", (emoji, tone, expected) => {
    expect(applySkinTone(emoji, tone)).toBe(expected);
  });
});

describe("loadPacks", () => {
  it("loads English first, then the requested locale", async () => {
    const urls: string[] = [];
    const fetch = async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify(String(url).endsWith("tr.json") ? tr : en));
    };
    const packs = await loadPacks({ baseUrl: "https://x.test/v1/pack/0.1.0/", locales: ["tr"], fetch });
    expect(packs.map((p) => p.locale)).toEqual(["en", "tr"]);
    expect(urls[0]).toBe("https://x.test/v1/pack/0.1.0/pack.en.json");
  });

  it("rejects non-packs", async () => {
    const fetch = async () => new Response("{}");
    await expect(loadPacks({ baseUrl: "https://x.test", fetch })).rejects.toThrow("not an emojisense pack");
  });
});
