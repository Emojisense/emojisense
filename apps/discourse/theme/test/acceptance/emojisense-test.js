import { isSkinTonableEmoji } from "pretty-text/emoji";
import { replacements } from "pretty-text/emoji/data";
import { module, test } from "qunit";
import { findEmojiQuery, mergeCodes, toDiscourseCodes } from "../../discourse/lib/emojisense";

const suggestion = (emoji) => ({ emoji, id: emoji, label: emoji, source: "alias" });

module("Emojisense | Discourse emoji data", () => {
  test("ranked emoji become this Discourse's emoji names", (assert) => {
    const data = { replacements, isSkinTonable: isSkinTonableEmoji };
    assert.deepEqual(toDiscourseCodes([suggestion("🚀"), suggestion("❤️"), suggestion("🍕")], { data }), [
      "rocket",
      "heart",
      "pizza",
    ]);
    assert.deepEqual(toDiscourseCodes([suggestion("👍"), suggestion("👋")], { data, diversity: 3 }), [
      "+1:t3",
      "waving_hand:t3",
    ]);
  });

  test("the trigger finds phrases that Discourse's own pattern misses", (assert) => {
    const text = "Ready to :ship it";
    assert.deepEqual(findEmojiQuery(text, text.length), [":ship it"]);
    assert.strictEqual(findEmojiQuery("at 12:30", 8), undefined);
  });

  test("Emojisense results come first, Discourse's fill the list", (assert) => {
    assert.deepEqual(mergeCodes(["rocket"], ["ship", "rocket"], 5), ["rocket", "ship"]);
  });
});
