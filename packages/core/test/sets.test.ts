import { describe, expect, it } from "vitest";
import { baseId, hexcodeOf } from "../src/ids.js";
import { EMOJI_SETS, emojiImageUrl, isEmojiSet } from "../src/sets.js";
import { applySkinTone } from "../src/skin.js";

describe("hexcodeOf", () => {
  it.each([
    ["👍", "1F44D"],
    ["❤️", "2764"],
    ["😐️", "1F610"],
    ["❤️‍🔥", "2764-FE0F-200D-1F525"],
    ["🏳️‍🌈", "1F3F3-FE0F-200D-1F308"],
    ["🧑‍🤝‍🧑", "1F9D1-200D-1F91D-200D-1F9D1"],
    ["#️⃣", "0023-FE0F-20E3"],
    ["🇺🇸", "1F1FA-1F1F8"],
    ["🏴󠁧󠁢󠁥󠁮󠁧󠁿", "1F3F4-E0067-E0062-E0065-E006E-E0067-E007F"],
  ])("%s → %s (the Emojibase hexcode)", (emoji, hexcode) => {
    expect(hexcodeOf(emoji)).toBe(hexcode);
  });

  it("matches Emojibase for skin-tone variants made by applySkinTone", () => {
    expect(hexcodeOf(applySkinTone("👍", "medium"))).toBe("1F44D-1F3FD");
    expect(hexcodeOf(applySkinTone("🏌️", "light"))).toBe("1F3CC-1F3FB");
    expect(hexcodeOf(applySkinTone("🏌️‍♂️", "dark"))).toBe("1F3CC-1F3FF-200D-2642-FE0F");
    expect(hexcodeOf(applySkinTone("🧑‍🤝‍🧑", "medium-dark"))).toBe("1F9D1-1F3FE-200D-1F91D-200D-1F9D1-1F3FE");
    expect(baseId(hexcodeOf(applySkinTone("👩‍💻", "light")))).toBe("1F469-200D-1F4BB");
  });
});

describe("emojiImageUrl", () => {
  const endpoint = "https://api.emojisense.com/";

  it("points hosted sets at /v1/sets/<set>/<hexcode>.svg", () => {
    expect(emojiImageUrl("👍🏽", { endpoint, emojiSet: "twemoji" })).toBe(
      "https://api.emojisense.com/v1/sets/twemoji/1F44D-1F3FD.svg",
    );
    expect(emojiImageUrl("#️⃣", { endpoint: "https://api.test", emojiSet: "fluent" })).toBe(
      "https://api.test/v1/sets/fluent/0023-FE0F-20E3.svg",
    );
  });

  it("returns undefined for native emoji or without an endpoint", () => {
    expect(emojiImageUrl("👍", { endpoint, emojiSet: "native" })).toBeUndefined();
    expect(emojiImageUrl("👍", { endpoint })).toBeUndefined();
    expect(emojiImageUrl("👍", { endpoint: undefined, emojiSet: "noto" })).toBeUndefined();
  });
});

describe("isEmojiSet", () => {
  it("accepts the known sets only", () => {
    expect(EMOJI_SETS.every(isEmojiSet)).toBe(true);
    expect(isEmojiSet("openmoji")).toBe(false);
    expect(isEmojiSet(undefined)).toBe(false);
  });
});
