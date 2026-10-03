import { getEmojiDataFromNative, init, SearchIndex } from "emoji-mart";
import { createEngine } from "emojisense";
import { beforeAll, describe, expect, it } from "vitest";
import { toSelection } from "../src/map.js";
import { overrideSearchIndex, type SearchIndexLike } from "../src/search.js";
import { emojiMartData, en, engine, pt } from "./fixture.js";

// Contract tests against the real emoji-mart 5 module. `init` runs once per test file and
// marks the emoji its picker lists; "goat" is excluded like a picker's `exceptEmojis` would.
beforeAll(async () => {
  await init({ data: emojiMartData, exceptEmojis: ["goat"] });
});

const searchIndex = SearchIndex as unknown as SearchIndexLike;
const ids = (emojis: unknown) => (emojis as { id: string }[] | null | undefined)?.map((e) => e.id);

describe("toSelection", () => {
  it("matches the payload emoji-mart gives onEmojiSelect", async () => {
    for (const [native, id, skin] of [
      ["👍🏽", "+1", 4],
      ["👍", "+1", 1],
      ["❤️", "heart", 1],
    ] as const) {
      const emoji = emojiMartData.emojis[id];
      if (!emoji) throw new Error(`fixture: ${id} missing`);
      expect(toSelection(emoji, skin)).toEqual(await getEmojiDataFromNative(native));
    }
  });
});

describe("overrideSearchIndex", () => {
  it("ranks emoji-mart's own search with the Emojisense dictionary, then restores it", async () => {
    expect(ids(await SearchIndex.search("jurassic park"))).toEqual([]);
    const restore = overrideSearchIndex(searchIndex, { data: emojiMartData, engine });
    expect(ids(await SearchIndex.search("jurassic park"))).toEqual(["t-rex"]);
    expect(ids(await SearchIndex.search("ship it"))?.[0]).toBe("rocket");
    restore();
    expect(ids(await SearchIndex.search("jurassic park"))).toEqual([]);
  });

  it("matches only phrases of the user's languages", async () => {
    const multilingual = createEngine([en, pt]);
    const restore = overrideSearchIndex(searchIndex, {
      data: emojiMartData,
      engine: multilingual,
      locales: ["tr", "en"],
    });
    try {
      expect(ids(await SearchIndex.search("foguete"))).toEqual([]);
      expect(ids(await SearchIndex.search("ship it"))?.[0]).toBe("rocket");
    } finally {
      restore();
    }
  });

  it("leaves emoji lookups to emoji-mart and hides emoji its picker does not list", async () => {
    const restore = overrideSearchIndex(searchIndex, { data: emojiMartData, engine });
    try {
      expect((await getEmojiDataFromNative("🚀"))?.id).toBe("rocket");
      expect(ids(await SearchIndex.search("greatest of all time"))).toEqual([]);
    } finally {
      restore();
    }
  });
});
