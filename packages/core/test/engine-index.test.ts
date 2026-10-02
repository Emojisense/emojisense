import { describe, expect, it } from "vitest";
import { type AliasEngine, createEngine } from "../src/engine.js";
import { buildEngineIndex, readEngineIndex } from "../src/engine-index.js";
import type { Pack } from "../src/pack.js";
import { custom, en, row, tr } from "./fixture.js";

const zh: Pack = {
  ...en,
  locale: "zh",
  emoji: [
    row("🎂", "1F382", "生日蛋糕", { keyword: "生日|蛋糕", alias: "生日快乐" }),
    row("🔥", "1F525", "火", { alias: "火锅|太火了" }),
  ],
};
const enExt: Pack = { ...en, part: "ext", emoji: [row("🐐", "1F410", "", { alias: "the goat|g.o.a.t" })] };
const weighted: Pack = { ...tr, weights: { keyword: 0, alias: 0.95 } };

const QUERIES = [
  "fire",
  "fir",
  "on fire",
  "ship it",
  "ship",
  "dinasour",
  "dinosuar",
  "jurasic park",
  "happy birthday",
  "birthday ",
  "goat",
  "the goat",
  "greatest",
  "lgtm",
  "thumbs",
  "tamam",
  "iyi ki dogdun",
  "dogum",
  "生日快乐",
  "我生日",
  "太火了",
  "party parrot",
  "celebrate",
  "squirrel",
  "kendrick lamar",
  "",
  "!!!",
];
const LOCALES = [undefined, "en", "tr", "zh"];

/** Every search the tests compare: queries × locales × prefix on/off × two limits. */
function outputs(engine: AliasEngine) {
  return QUERIES.flatMap((q) =>
    LOCALES.flatMap((locale) =>
      [true, false].flatMap((prefix) =>
        [3, 24].map((limit) =>
          engine.search(q, { culture: false, prefix, limit, ...(locale ? { locale } : {}) }),
        ),
      ),
    ),
  );
}

describe("prebuilt engine index", () => {
  const sets: [string, Pack[]][] = [
    ["en", [en]],
    ["en + ext", [en, enExt]],
    ["en + tr", [en, tr]],
    ["en + zh + tr + ext", [en, zh, tr, enExt]],
    ["custom first", [custom, en, tr]],
    ["pack weights", [en, weighted]],
  ];

  it.each(sets)("searches like a fresh build (%s)", (_name, packs) => {
    const prebuilt = readEngineIndex(buildEngineIndex(packs), packs);
    expect(prebuilt).toBeDefined();
    const loaded = createEngine(packs, { prebuilt });
    const built = createEngine(packs);
    expect(outputs(loaded)).toEqual(outputs(built));
    expect(loaded.entries).toEqual(built.entries);
    expect(loaded.locales).toEqual(built.locales);
    expect(built.entries.map((e) => loaded.popularity(e.id))).toEqual(
      built.entries.map((e) => built.popularity(e.id)),
    );
  });

  it("writes the same bytes for the same packs", () => {
    expect(buildEngineIndex([en, tr])).toEqual(buildEngineIndex([en, tr]));
  });

  it("reads a file at any byte offset and from an ArrayBuffer", () => {
    const bytes = buildEngineIndex([en, tr]);
    const shifted = new Uint8Array(bytes.length + 1);
    shifted.set(bytes, 1);
    const engine = createEngine([en, tr], { prebuilt: readEngineIndex(shifted.subarray(1), [en, tr]) });
    expect(outputs(engine)).toEqual(outputs(createEngine([en, tr])));
    expect(readEngineIndex(bytes.slice().buffer, [en, tr])).toBeDefined();
  });

  it("refuses a file made from other packs, in another order, or damaged", () => {
    const bytes = buildEngineIndex([en, tr]);
    expect(readEngineIndex(bytes, [tr, en])).toBeUndefined();
    expect(readEngineIndex(bytes, [en])).toBeUndefined();
    expect(readEngineIndex(bytes, [en, { ...tr, packVersion: "other" }])).toBeUndefined();
    expect(readEngineIndex(bytes, [en, { ...tr, emoji: tr.emoji.slice(1) }])).toBeUndefined();
    const edited = {
      ...tr,
      emoji: [row("👍", "1F44D", "baş parmak yukarıda", { keyword: "tamam|onay|evet" })],
    };
    expect(
      readEngineIndex(bytes, [en, { ...tr, emoji: [...edited.emoji, ...tr.emoji.slice(1)] }]),
    ).toBeUndefined();
    expect(readEngineIndex(bytes, [en, weighted])).toBeUndefined();
    expect(readEngineIndex(bytes.subarray(0, bytes.length - 8), [en, tr])).toBeUndefined();
    expect(readEngineIndex(new Uint8Array([1, 2, 3]), [en, tr])).toBeUndefined();
    expect(readEngineIndex(new TextEncoder().encode("\u0004\0\0\0oops"), [en, tr])).toBeUndefined();
  });
});
