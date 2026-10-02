import { describe, expect, it } from "vitest";
import { codepointKey, createEmojiMartIndex, toEmojiMart, toSelection } from "../src/map.js";
import { emojiMartData, engine } from "./fixture.js";

describe("codepointKey", () => {
  it("ignores U+FE0F placement, leading zeros and case", () => {
    expect(codepointKey("0023-FE0F-20E3")).toBe(codepointKey("23-fe0f-20e3"));
    expect(codepointKey("2764")).toBe(codepointKey("2764-fe0f"));
    expect(codepointKey("1F441-FE0F-200D-1F5E8-FE0F")).toBe(codepointKey("1f441-200d-1f5e8"));
  });
});

describe("createEmojiMartIndex", () => {
  const index = createEmojiMartIndex(emojiMartData);

  it("maps Emojibase hexcodes to emoji-mart ids", () => {
    const ids = {
      "1F44D": "+1",
      "2764": "heart",
      "263A": "relaxed",
      "0023-FE0F-20E3": "hash",
      "1F441-FE0F-200D-1F5E8-FE0F": "eye-in-speech-bubble",
      "1F1F9-1F1F7": "flag-tr",
      "1F468-200D-1F4BB": "male-technologist",
    };
    for (const [hexcode, id] of Object.entries(ids)) expect(index.get(hexcode)?.id, hexcode).toBe(id);
  });

  it("has no entry for emoji newer than emoji-mart's data", () => {
    expect(index.get("1FAE9")).toBeUndefined();
  });
});

describe("toEmojiMart", () => {
  it("keeps the Emojisense order and drops emoji emoji-mart does not have", () => {
    const index = createEmojiMartIndex(emojiMartData);
    const ranked = engine.search("exhausted").results;
    expect(ranked.map((r) => r.id)).toEqual(["1FAE9"]);
    expect(toEmojiMart(ranked, index)).toEqual([]);
    const results = [...engine.search("rocket").results, ...engine.search("rocket").results];
    expect(toEmojiMart(results, index).map((e) => e.id)).toEqual(["rocket"]);
  });
});

describe("toSelection", () => {
  it("builds emoji-mart's onEmojiSelect payload for a skin", () => {
    const thumbsUp = emojiMartData.emojis["+1"];
    if (!thumbsUp) throw new Error("fixture: +1 missing");
    expect(toSelection(thumbsUp, 4)).toMatchObject({
      id: "+1",
      native: "👍🏽",
      unified: "1f44d-1f3fd",
      shortcodes: ":+1::skin-tone-4:",
      skin: 4,
    });
    expect(toSelection(thumbsUp).native).toBe("👍");
    const heart = emojiMartData.emojis.heart;
    if (!heart) throw new Error("fixture: heart missing");
    // No skins: the skin is ignored and left out, like emoji-mart does.
    expect(toSelection(heart, 3)).toMatchObject({ native: "❤️", shortcodes: ":heart:", emoticons: ["<3"] });
    expect(toSelection(heart, 3).skin).toBeUndefined();
  });
});
