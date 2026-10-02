import { describe, expect, it } from "vitest";
import { embeddingText, MAX_QUERY_LENGTH, normalize } from "../src/normalize.js";

describe("normalize", () => {
  it.each([
    ["  Thumbs   UP ", "thumbs up"],
    ["doğum günü", "dogum gunu"],
    ["İYİ Kİ DOĞDUN", "iyi ki dogdun"],
    ["IŞIK", "isik"],
    ["Pokémon", "pokemon"],
    ["i'm exhausted", "im exhausted"],
    ["ship-it!!!", "ship it"],
    [":rocket:", "rocket"],
    ["+1", "+1"],
    ["c++ rocks", "c rocks"],
    ["🚀 launch 👍🏽", "launch"],
    ["👩\u200D🚀", ""],
    ["ｆｕｌｌｗｉｄｔｈ", "fullwidth"],
    ["¡Feliz cumpleaños!", "feliz cumpleanos"],
    ["Joyeux Noël", "joyeux noel"],
    ["Straße", "strasse"],
    ["Ёлка", "елка"],
    ["Chúc mừng sinh nhật", "chuc mung sinh nhat"],
    ["Đà Lạt", "da lat"],
    ["مَرْحَبًا", "مرحبا"],
    ["नमस्ते", "नमस्ते"],
    ["শুভ জন্মদিন", "শুভ জন্মদিন"],
    ["がんばって", "がんばって"],
    ["축하해요", "축하해요"],
    ["生日快乐", "生日快乐"],
    ["สุขสันต์วันเกิด", "สุขสันต์วันเกิด"],
  ])("%j → %j", (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  it("caps length", () => {
    expect(normalize("a ".repeat(100)).length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
  });

  it("is idempotent", () => {
    for (const s of ["Doğum Günü!", "i'm so tired", "T-Rex"]) {
      expect(normalize(normalize(s))).toBe(normalize(s));
    }
  });
});

describe("embeddingText", () => {
  it.each([
    ["  Thumbs   UP ", "thumbs up"],
    ["doğum günü", "doğum günü"],
    ["¡Feliz cumpleaños!", "¡feliz cumpleaños!"],
    ["Ёлка", "ёлка"],
    ["i'm exhausted", "i'm exhausted"],
    ["ｆｕｌｌｗｉｄｔｈ", "fullwidth"],
    ["🚀 launch 👍🏽", "🚀 launch 👍🏽"],
    ["tab\there\nnewline\r\nend", "tab here newline end"],
    ["zero\u00a0nbsp\u3000ideographic\u2028line\ufeffbom", "zero nbsp ideographic line bom"],
    ["مَرْحَبًا", "مَرْحَبًا"],
    ["生日快乐", "生日快乐"],
  ])("%j → %j", (input, expected) => {
    expect(embeddingText(input)).toBe(expected);
  });

  it("caps length without splitting a surrogate pair", () => {
    expect(embeddingText("a ".repeat(100)).length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
    expect(embeddingText(`${"x".repeat(63)}𠀀𠀁`)).toBe("x".repeat(63));
    expect(embeddingText(`${"x".repeat(62)}😀😀`)).toBe(`${"x".repeat(62)}😀`);
  });

  it("is idempotent, also for every BMP character between letters", () => {
    for (const s of ["Doğum Günü!", "ΟΔΟΣ ΣΑΣ", "Straße STRASSE ẞ", "İstanbul", `${"a ".repeat(40)}😀😀`]) {
      expect(embeddingText(embeddingText(s))).toBe(embeddingText(s));
    }
    for (let point = 0; point <= 0xffff; point++) {
      if (point >= 0xd800 && point <= 0xdfff) continue;
      const s = `A${String.fromCodePoint(point)}Σ`;
      expect(embeddingText(embeddingText(s))).toBe(embeddingText(s));
    }
    // About 1 s alone; the whole workspace's tests in parallel can take several times longer.
  }, 30_000);

  it("normalizes to what normalize() gives for the raw query", () => {
    for (const s of [
      "Doğum Günü!",
      "🚀 Launch 👍🏽",
      "  ship-it!!! ",
      "ｆｕｌｌｗｉｄｔｈ",
      "c++ rocks",
      "İYİ Kİ",
    ]) {
      expect(normalize(embeddingText(s))).toBe(normalize(s));
    }
  });
});
