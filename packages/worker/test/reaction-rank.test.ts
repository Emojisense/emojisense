import { createEngine, decodeVectors, encodeVectors, l2normalize, normalize, type Pack } from "emojisense";
import { describe, expect, it } from "vitest";
import { resolveEmoji } from "../src/emoji-lookup.ts";
import productionPack from "../src/generated/pack.en.json";
import { detectIntents, INTENTS } from "../src/reaction-intents.ts";
import { CLOSE_NEIGHBOUR, clausesOf, REACTION_VOCABULARY, rankReactions } from "../src/reaction-rank.ts";

const row = (emoji: string, hexcode: string, label: string, keyword = ""): Pack["emoji"][number] => [
  emoji,
  hexcode,
  0,
  1,
  0,
  label,
  "",
  keyword,
  "",
  "",
  "",
];
const ROWS = [
  row("🎉", "1F389", "party popper", "party|celebrate|tada"),
  row("🙏", "1F64F", "folded hands", "please|pray"),
  row("❤️", "2764", "red heart", "love"),
  row("😂", "1F602", "face with tears of joy", "laughing"),
  row("😢", "1F622", "crying face", "sad"),
  row("🫂", "1FAC2", "people hugging", "hug"),
  row("👍", "1F44D", "thumbs up", "agree|ok"),
  row("😩", "1F629", "weary face", "tired"),
  row("🙌", "1F64C", "raising hands", "hooray"),
  row("🚬", "1F6AC", "cigarette", "smoke|smoking"),
  row("🍕", "1F355", "pizza", "pizza"),
  row("🧪", "1F9EA", "test tube", "test|tests"),
];
const engine = createEngine({
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "t",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["g"],
  emoji: ROWS,
});
const DIMS = 16;
const axis = (i: number, weight = 1) =>
  Float32Array.from({ length: DIMS }, (_, d) => (d === i ? weight : d === DIMS - 1 ? 0.2 : 0));
const ids = ROWS.map((r) => r[1]);
const index = decodeVectors(
  encodeVectors(
    "test",
    ids,
    ids.map((_, i) => l2normalize(axis(i))),
  ),
);
/** A message vector at `cosine` from one emoji row. */
function near(hexcode: string, cosine: number): Float32Array {
  const i = ids.indexOf(hexcode);
  const target = index.data.slice(i * DIMS, (i + 1) * DIMS);
  const other = l2normalize(Float32Array.from({ length: DIMS }, (_, d) => (d === DIMS - 2 ? 1 : 0)));
  return l2normalize(target.map((v, d) => cosine * v + Math.sqrt(1 - cosine ** 2) * (other[d] as number)));
}
const top = (text: string, vector?: Float32Array, limit = 4) =>
  rankReactions(engine, { text, locale: "en", limit, semantic: vector ? { index, vector } : undefined })
    .results;
const emoji = (results: { emoji: string }[]) => results.map((r) => r.emoji);

describe("rankReactions", () => {
  it("follows intent cues in several languages without the embedding", () => {
    expect(emoji(top("çok teşekkür ederim"))[0]).toBe("🙏");
    expect(emoji(top("jajaja no puedo más"))[0]).toBe("😂");
    expect(emoji(top("félicitations à toute l'équipe !"))[0]).toBe("🎉");
    expect(emoji(top("başınız sağ olsun"))[0]).toBe("😢");
    expect(emoji(top("kesinlikle katılıyorum"))[0]).toBe("👍");
  });

  it("puts an emoji the writer used first", () => {
    expect(emoji(top("lunch is here 🍕"))[0]).toBe("🍕");
  });

  it("ranks what two cues agree on above either one", () => {
    expect(emoji(top("shipped the new onboarding 🎉 thanks team")).slice(0, 2)).toEqual(["🎉", "🙌"]);
  });

  it("keeps literal-noun traps out: a weak neighbour alone does not show", () => {
    const vector = near("1F6AC", CLOSE_NEIGHBOUR - 0.08);
    const results = emoji(top("smoke tests are failing again", vector, 8));
    expect(results).not.toContain("🚬");
    expect(results).not.toContain("🧪");
    expect(results[0]).toBe("😩");
  });

  it("lets a close neighbour stand on its own", () => {
    expect(emoji(top("anyone up for lunch?", near("1F355", 0.7)))).toContain("🍕");
  });

  it("fills the list with reaction emoji below the floor, never with topical ones", () => {
    const results = top("a message with no cue at all", near("1F6AC", 0.5), 20);
    // The embedding ranks the 8 nearest reaction emoji; 🚬 is nearer but only a weak neighbour.
    expect(results).toHaveLength(8);
    expect(emoji(results).some((e) => ["🚬", "🍕", "🧪"].includes(e))).toBe(false);
  });

  it("over the plan limit (no embedding) uses only dictionary evidence", () => {
    const results = top("thanks so much, great job!", undefined, 8);
    expect(emoji(results)[0]).toBe("🙌");
    expect(emoji(results).slice(1, 3).sort()).toEqual(["🎉", "🙏"].sort());
    expect(results.every((r) => r.source === "alias")).toBe(true);
    expect(top("zzzz qqqq")).toEqual([]);
  });
});

describe("intent cues", () => {
  const names = (text: string) => detectIntents(normalize(text)).map((intent) => intent.name);

  it("recognise laughter in several spellings and languages", () => {
    for (const text of ["hahaha", "ahahah", "lol", "LMAO", "jajaja", "kkkkk", "mdr", "rsrsrs", "xD"]) {
      expect(names(text)).toContain("humor");
    }
    expect(names("kk")).not.toContain("humor");
  });

  it("match whole words on folded text", () => {
    expect(names("Doğum günün kutlu olsun!")).toContain("birthday");
    expect(names("herzlichen Glückwunsch zum Geburtstag!")).toEqual(["birthday", "celebration"]);
    expect(names("we just hit 10k users")).toEqual(["celebration"]);
    expect(names("+1 from me")).toEqual(["agreement"]);
    expect(names("party")).toEqual([]);
    // Substrings are not words: "ty" is thanks, "pretty" is not.
    expect(names("pretty sure")).toEqual([]);
  });

  it("are written in normalized form, so they can match at all", () => {
    for (const intent of INTENTS) {
      for (const phrase of intent.phrases.split("|")) expect(normalize(phrase), intent.name).toBe(phrase);
    }
  });

  it("do not read 'again' or a lone 'encore' as frustration", () => {
    expect(names("lets try again tomorrow")).toEqual([]);
    expect(names("encore une fois")).toEqual([]);
  });
});

describe("clausesOf", () => {
  it("splits on punctuation, emoji and conjunctions and skips one-word clauses", () => {
    expect(clausesOf("shipped the new onboarding 🎉 thanks team")).toEqual([
      "shipped the new onboarding 🎉 thanks team",
      "shipped the new onboarding",
      "thanks team",
    ]);
    expect(clausesOf("v2.14.0 is out, great")).toEqual(["v2.14.0 is out, great", "v2.14.0 is out"]);
  });
});

describe("reaction emoji lists", () => {
  it("name only emoji that exist in the production catalog", () => {
    const catalog = createEngine(productionPack as unknown as Pack);
    const lists = [REACTION_VOCABULARY, ...INTENTS.map((intent) => intent.reactions)];
    for (const list of lists) {
      const items = list.split(" ");
      expect(resolveEmoji(catalog, items.join("")), list).toHaveLength(items.length);
    }
  });
});
