import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEngine } from "emojisense";
import type { EmojiSuggestion } from "emojisense/autocomplete";
import { describe, expect, it, vi } from "vitest";
import {
  createEmojisense,
  customEmojiPack,
  type DiscourseEmojiData,
  findEmojiQuery,
  mergeCodes,
  packLocale,
  toDiscourseCodes,
} from "../src/index.js";

const PACKS = join(__dirname, "..", "..", "..", "packages", "data", "dist", "packs", "0.1.0");
const CULTURE = join(__dirname, "..", "..", "..", "packages", "data", "dist", "culture", "0.1.0");

/** A slice of Discourse's `replacements` (pretty-text/emoji/data). */
const data: DiscourseEmojiData = {
  replacements: {
    "🚀": "rocket",
    "🍕": "pizza",
    "❤": "heart",
    "👍": "+1",
    "👋": "wave",
    "🐐": "goat",
    "⚽": "soccer",
    "🚢": "ship",
  },
  isSkinTonable: (code) => ["+1", "wave"].includes(code),
};

const suggestion = (emoji: string, source: EmojiSuggestion["source"] = "alias"): EmojiSuggestion => ({
  emoji,
  id: emoji,
  label: emoji,
  source,
});

/** Serves the data files by URL: "https://site.test/assets/<file>". */
function assetFetch() {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const file = url.slice(url.lastIndexOf("/") + 1);
    try {
      const dir = file.startsWith("culture.") ? CULTURE : PACKS;
      return new Response(readFileSync(join(dir, file), "utf8"));
    } catch {
      return new Response("missing", { status: 404 });
    }
  }) as typeof fetch;
  const files = Object.fromEntries(
    ["en", "tr"].flatMap((locale) =>
      [`pack.${locale}.json`, `pack.${locale}.ext.json`, `culture.${locale}.json`].map((file) => [
        file,
        `https://site.test/assets/${file}`,
      ]),
    ),
  );
  return { fetchImpl, requests, files };
}

describe("toDiscourseCodes", () => {
  it("maps emoji to Discourse names, also without the variation selector", () => {
    expect(toDiscourseCodes([suggestion("🚀"), suggestion("❤️"), suggestion("🦕")], { data })).toEqual([
      "rocket",
      "heart",
    ]);
  });

  it("adds the skin tone to tonable emoji only, and leaves out denied ones", () => {
    const list = [suggestion("👍"), suggestion("🚀"), suggestion("🍕")];
    expect(toDiscourseCodes(list, { data, diversity: 4, denied: ["pizza"] })).toEqual(["+1:t4", "rocket"]);
  });

  it("keeps custom emoji by name, without duplicates, up to the limit", () => {
    const custom: EmojiSuggestion = { ...suggestion(":party_parrot:", "custom"), shortcode: "party_parrot" };
    const list = [custom, suggestion("🚀"), suggestion("🚀"), suggestion("🍕")];
    expect(toDiscourseCodes(list, { data, limit: 2 })).toEqual(["party_parrot", "rocket"]);
  });
});

describe("mergeCodes", () => {
  it("puts ours first and fills up with Discourse's own matches", () => {
    expect(mergeCodes(["rocket"], ["ship", "rocket", "boat", "anchor"], 3)).toEqual([
      "rocket",
      "ship",
      "boat",
    ]);
    expect(mergeCodes(["a", "b", "c"], ["d"], 2)).toEqual(["a", "b"]);
  });
});

describe("findEmojiQuery", () => {
  it.each([
    ["Let's :ship it", [":ship it"]],
    ["çok güzel :çay", [":çay"]],
    ["line one\n(:pizza", [":pizza"]],
  ])("finds the query in %j", (text, expected) => {
    expect(findEmojiQuery(text, text.length)).toEqual(expected);
  });

  it.each(["at 12:30", "https://x", ":", ": pizza", ":one two three four five"])(
    "finds none in %j",
    (text) => {
      expect(findEmojiQuery(text, text.length)).toBeUndefined();
    },
  );

  it("stays closed when a word follows the caret", () => {
    expect(findEmojiQuery(":pizzeria", 4)).toBeUndefined();
  });
});

describe("customEmojiPack", () => {
  it("makes the site's custom emoji searchable by their names", () => {
    const pack = customEmojiPack([
      { name: "party_parrot", url: "/uploads/parrot.gif" },
      { name: "", url: "/x.png" },
    ]);
    expect(pack?.emoji).toHaveLength(1);
    const engine = createEngine(pack ? [pack] : []);
    expect(engine.search("party parrot").results[0]).toMatchObject({
      emoji: ":party_parrot:",
      source: "custom",
      shortcode: "party_parrot",
      imageUrl: "/uploads/parrot.gif",
    });
    expect(customEmojiPack([])).toBeUndefined();
  });
});

describe("packLocale", () => {
  it.each([
    ["pt_BR", "pt"],
    ["tr_TR", "tr"],
    ["zh_CN", "zh"],
    ["de", "en"],
    ["", "en"],
  ])("%s → %s", (discourse, expected) => {
    expect(packLocale(discourse)).toBe(expected);
  });
});

describe("createEmojisense", () => {
  it("loads the theme's data files and answers with Discourse names", async () => {
    const { fetchImpl, requests, files } = assetFetch();
    const sense = createEmojisense({ files, locale: "en", data, fetch: fetchImpl, whenIdle: () => {} });
    await expect(sense.search("ship it", { limit: 5, use: "autocomplete" })).resolves.toBeUndefined();
    sense.load();
    await vi.waitFor(() => expect(sense.isReady()).toBe(true));
    expect(requests).toContain("https://site.test/assets/pack.en.json");
    expect(requests).toContain("https://site.test/assets/culture.en.json");
    const codes = await sense.search("ship it", { limit: 5, use: "autocomplete" });
    expect(codes?.[0]).toBe("rocket");
    expect(await sense.search("pizza", { limit: 5, use: "picker" })).toContain("pizza");
  });

  it("searches in the site's language and finds custom emoji", async () => {
    const { fetchImpl, files } = assetFetch();
    const sense = createEmojisense({
      files,
      locale: "tr",
      data,
      customEmoji: [{ name: "party_parrot", url: "/uploads/parrot.gif" }],
      fetch: fetchImpl,
      whenIdle: () => {},
    });
    sense.load();
    await vi.waitFor(() => expect(sense.isReady()).toBe(true));
    expect(await sense.search("roket", { limit: 5, use: "autocomplete" })).toContain("rocket");
    expect((await sense.search("party parrot", { limit: 5, use: "autocomplete" }))?.[0]).toBe("party_parrot");
  });

  it("uses English when the site's language has no pack file", async () => {
    const { fetchImpl, files } = assetFetch();
    const sense = createEmojisense({
      files,
      locale: "id",
      culture: false,
      data,
      fetch: fetchImpl,
      whenIdle: () => {},
    });
    sense.load();
    await vi.waitFor(() => expect(sense.isReady()).toBe(true));
    expect(await sense.search("pizza", { limit: 5, use: "autocomplete" })).toContain("pizza");
  });
});
