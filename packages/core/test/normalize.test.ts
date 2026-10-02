import { describe, expect, it } from "vitest";
import { MAX_QUERY_LENGTH, normalize } from "../src/normalize.js";

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
    ["👩‍🚀", ""],
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
