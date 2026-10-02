/**
 * Writes Tests/EmojisenseTests/Resources/golden.json: what the TypeScript reference
 * (packages/core) returns, so the Swift conformance tests can compare against it.
 *
 *   pnpm data:build && pnpm exec tsx sdks/swift/scripts/make-golden.ts
 *   pnpm exec tsx sdks/swift/scripts/make-golden.ts --root ../other-checkout   (core, packs and
 *                                                                              queries from there)
 *
 * The Swift tests read the packs themselves from packages/data/dist/packs/<version> (they are too
 * large to copy into the SDK) and check their sha256 against the hashes stored here.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { AliasEngine, Pack } from "../../../packages/core/src/index.ts";

const THIS_REPO = fileURLToPath(new URL("../../../", import.meta.url));
const OUTPUT = fileURLToPath(new URL("../Tests/EmojisenseTests/Resources/golden.json", import.meta.url));
const { values: args } = parseArgs({ options: { root: { type: "string" } } });
/** The checkout whose reference engine, packs and queries the golden file describes. */
const REPO_ROOT = args.root ? resolve(args.root) : THIS_REPO;
const core: typeof import("../../../packages/core/src/index.ts") = await import(
  pathToFileURL(join(REPO_ROOT, "packages/core/src/index.ts")).href
);
const { createEngine, embeddingText, normalize } = core;
const { FUNCTION_WORDS }: typeof import("../../../packages/core/src/function-words.ts") = await import(
  pathToFileURL(join(REPO_ROOT, "packages/core/src/function-words.ts")).href
);
const TOP = 10;
const KEYSTROKE_TOP = 5;
/** Every n-th query is also replayed keystroke by keystroke. */
const KEYSTROKE_SAMPLE_EVERY = 5;

const packVersion: string = JSON.parse(
  readFileSync(join(REPO_ROOT, "packages/data/pack.config.json"), "utf8"),
).packVersion;
const packDir = join(REPO_ROOT, "packages/data/dist/packs", packVersion);
interface Query {
  id: string;
  q: string;
  locale: string;
}
const readQueries = (file: string): Query[] =>
  readFileSync(join(REPO_ROOT, "packages/eval/queries", file), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
const queries = readQueries("queries.jsonl");
/** Sentences with function words in the other pack locales, searched with en + that locale. */
const sentences = readQueries("sentences-dev.jsonl");
const sentenceLocales = [...new Set(sentences.map((q) => q.locale))];
/** Index order of PACK_FORMAT.md §2: every core part first (English first), then the ext parts. */
const filesFor = (locale: string) => [
  "pack.en.json",
  `pack.${locale}.json`,
  "pack.en.ext.json",
  `pack.${locale}.ext.json`,
];

const packFiles = [...new Set(["tr", ...sentenceLocales].flatMap(filesFor))];
const packBytes = new Map(packFiles.map((file) => [file, readFileSync(join(packDir, file))]));
const pack = (file: string): Pack => JSON.parse((packBytes.get(file) as Buffer).toString("utf8"));

// ── Normalization ─────────────────────────────────────────────────────────────────────────────
/** Invisible and combining characters, spelled out so the formatter cannot make them literal. */
const cp = (...points: number[]) => String.fromCodePoint(...points);

const NORMALIZATION_INPUTS = [
  // PACK_FORMAT.md §3 examples and packages/core/test/normalize.test.ts
  "İYİ Kİ DOĞDUN",
  "i'm exhausted",
  ":rocket:",
  "+1",
  "🚀 launch 👍🏽",
  "  Thumbs   UP ",
  "doğum günü",
  "IŞIK",
  "Pokémon",
  "ship-it!!!",
  "c++ rocks",
  "👩‍🚀",
  "ｆｕｌｌｗｉｄｔｈ",
  "¡Feliz cumpleaños!",
  "Joyeux Noël",
  "Straße",
  "Ёлка",
  "Chúc mừng sinh nhật",
  "Đà Lạt",
  "مَرْحَبًا",
  "नमस्ते",
  "শুভ জন্মদিন",
  "がんばって",
  "축하해요",
  "生日快乐",
  "สุขสันต์วันเกิด",
  // emoji parts, glue, keycaps, flags, tags
  "1️⃣ 2️⃣ #️⃣ *️⃣",
  "🇹🇷 bayrak 🇺🇸",
  "🏴󠁧󠁢󠁳󠁣󠁴󠁿 scotland",
  "🏳️‍🌈 pride",
  `${cp(0x2764, 0xfe0e)} text heart ❤️`,
  `x${cp(0x20e3)}y`,
  `a${cp(0x200d)}b${cp(0xfe0f)}c${cp(0xfe0e)}d`,
  "©️ ® ™ ℹ️ ‼️ ⁉️",
  "🅰️ 🄰 Ⓜ️",
  "👍🏻👍🏼👍🏽👍🏾👍🏿",
  "🔟 keycap ten",
  // NFKC
  "ﬁﬂ ﬀ",
  "㎒ ㍿ ①②③",
  "½ ¼ e=mc²",
  "ǅemal",
  `${cp(0x212b)} ${cp(0x2126)} ${cp(0x212a)}`,
  "ﷺ",
  "ｶﾞﾝﾊﾞﾚ",
  // case mapping
  "ΟΔΟΣ ΣΑΣ Σ",
  "ὈΔΥΣΣΕΎΣ",
  `Straße STRASSE ${cp(0x1e9e)}`,
  "ǈubljana",
  `ΣʰΣ aΣ${cp(0x345)}`,
  "İstanbul ISTANBUL ıstanbul",
  "ⓗⓔⓛⓛⓞ",
  // optional accents, letter folds, and marks that are part of the spelling
  "Tiếng Việt",
  "naïve café résumé",
  "Привет, мир! йод ёлка",
  "Łódź Øresund ǿ ĐẠI",
  "ありがとう ございます",
  "안녕하세요",
  `${cp(0x1112, 0x1161, 0x11ab)} jamo`,
  "नमस्ते दुनिया",
  `${cp(0x95b)}िंदगी ${cp(0x91c, 0x93c)}`,
  `a ${cp(0x94d)} b`,
  "ก่อน",
  `مَرْحَبًا ${cp(0x640, 0x640)}سلام`,
  `שָׁלוֹם מַה${cp(0x5be)}זֶּה`,
  `${cp(0x9c7)}'${cp(0x9be)}`,
  "你好，世界",
  "١٢٣ ٤٥ ۶۷",
  "Ⅻ Ⅳ",
  // apostrophes, punctuation, plus rule
  "rock’n’roll don`t it´s",
  "a ' b",
  "C++ c# f#",
  "+1 -1 ++1 1+1 a+b +a",
  "+٣ +३",
  "e-mail@example.com",
  `co${cp(0xad)}op`,
  `zero${cp(0x200b)}width${cp(0xa0)}nbsp${cp(0x3000)}ideographic`,
  "tab\there\nnewline\r\nend",
  `${cp(0xfeff)}bom`,
  // whitespace and empties
  "",
  "   ",
  "🚀🔥💯",
  "!!!???",
  // length cap
  "a ".repeat(100),
  "supercalifragilisticexpialidocious ".repeat(3),
  `${"x".repeat(63)} yz`,
  `${"x".repeat(62)}𝔞𝔟`,
  `${"ab ".repeat(20)}😀😀😀 tail words here`,
];

/** 32-bit FNV-1a over UTF-16 code units; cheap to reproduce in Swift. */
function fnv1a(hash: number, units: string): number {
  let h = hash;
  for (let i = 0; i < units.length; i++) {
    h ^= units.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const SWEEP_BLOCK = 0x400;
/** Ends each code point's output in the hash. U+FFFF never survives normalization. */
const SWEEP_SEPARATOR = cp(0xffff);
/** Planes 4–13 are unassigned and 15–16 are private use: every code point there maps to "". */
const SWEEP_RANGES: [number, number][] = [
  [0x0, 0x3ffff],
  [0xe0000, 0xeffff],
];

function sweepHashes(): string[] {
  const hashes: string[] = [];
  for (const [start, end] of SWEEP_RANGES) {
    for (let block = start; block <= end; block += SWEEP_BLOCK) {
      let hash = 0x811c9dc5;
      for (let point = block; point < block + SWEEP_BLOCK; point++) {
        if (point >= 0xd800 && point <= 0xdfff) continue;
        hash = fnv1a(hash, normalize(cp(point)) + SWEEP_SEPARATOR);
      }
      hashes.push(hash.toString(16).padStart(8, "0"));
    }
  }
  return hashes;
}

// ── Search ────────────────────────────────────────────────────────────────────────────────────
type Ranked = [id: string, score: number];

function searchCases(engine: AliasEngine, list: Query[] = queries) {
  return list.map((q) => {
    const out = engine.search(q.q, { locale: q.locale, limit: TOP });
    const best = out.results[0];
    return {
      id: q.id,
      q: q.q,
      locale: q.locale,
      query: out.query,
      confidence: out.confidence,
      top: out.results.map((r): Ranked => [r.id, r.score]),
      match: best?.match ?? null,
      field: best?.field ?? null,
    };
  });
}

/** A prefix that ends inside a surrogate pair is not a string Swift can hold. */
const endsInsideSurrogatePair = (text: string) => /[\ud800-\udbff]$/.test(text);

function keystrokeCases(engine: AliasEngine, list: Query[] = queries) {
  return list
    .filter((_, i) => i % KEYSTROKE_SAMPLE_EVERY === 0)
    .flatMap((q) =>
      Array.from({ length: q.q.length }, (_, i) => q.q.slice(0, i + 1))
        .filter((typed) => !endsInsideSurrogatePair(typed))
        .map((typed) => ({
          q: typed,
          locale: q.locale,
          top: engine
            .search(typed, { locale: q.locale, limit: KEYSTROKE_TOP })
            .results.map((r): Ranked => [r.id, r.score]),
        })),
    );
}

const fullFiles = filesFor("tr");
const coreFiles = ["pack.en.json", "pack.tr.json"];
const fullEngine = createEngine(fullFiles.map(pack));
const coreEngine = createEngine(coreFiles.map(pack));
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const localeEngines = sentenceLocales.map((locale) => {
  const files = filesFor(locale);
  return {
    locale,
    files,
    engine: createEngine(files.map(pack)),
    list: sentences.filter((q) => q.locale === locale),
  };
});

const golden = {
  generatedBy: "sdks/swift/scripts/make-golden.ts",
  node: process.versions.node,
  unicode: process.versions.unicode,
  packVersion,
  packSha256: Object.fromEntries(packFiles.map((file) => [file, sha256(packBytes.get(file) as Buffer)])),
  normalization: {
    cases: NORMALIZATION_INPUTS.map((input) => [input, normalize(input)]),
    sweep: { blockSize: SWEEP_BLOCK, ranges: SWEEP_RANGES, hashes: sweepHashes() },
  },
  /** The text the semantic client sends and the API embeds (accents and punctuation kept). */
  embeddingText: { cases: NORMALIZATION_INPUTS.map((input) => [input, embeddingText(input)]) },
  /** The function-word lists (PACK_FORMAT.md §4) that the Swift copy must equal. */
  functionWords: FUNCTION_WORDS,
  search: [
    { name: "core+ext", packs: fullFiles, cases: searchCases(fullEngine) },
    { name: "core", packs: coreFiles, cases: searchCases(coreEngine) },
    ...localeEngines.map(({ locale, files, engine, list }) => ({
      name: `${locale} sentences`,
      packs: files,
      cases: searchCases(engine, list),
    })),
  ],
  keystrokes: { packs: fullFiles, cases: keystrokeCases(fullEngine) },
  /** Per sentence locale: every n-th sentence, keystroke by keystroke. */
  sentenceKeystrokes: localeEngines.map(({ files, engine, list }) => ({
    packs: files,
    cases: keystrokeCases(engine, list),
  })),
};
const keystrokeCount =
  golden.keystrokes.cases.length + golden.sentenceKeystrokes.reduce((sum, k) => sum + k.cases.length, 0);

writeFileSync(OUTPUT, `${JSON.stringify(golden)}\n`);
// Keep the file in the repository's canonical format so `pnpm lint` stays green.
execFileSync(join(THIS_REPO, "node_modules/.bin/biome"), ["format", "--write", OUTPUT], { stdio: "ignore" });
console.log(
  `make-golden: ${queries.length} queries × 2 configs, ${sentences.length} sentences in ` +
    `${sentenceLocales.length} locales, ${keystrokeCount} keystrokes, ` +
    `${NORMALIZATION_INPUTS.length} normalization cases, ${golden.normalization.sweep.hashes.length} sweep blocks → ${OUTPUT}`,
);
