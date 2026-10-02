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
const { assessConfidence, createEngine, embeddingText, fuse, mergeConcept, normalize, semanticStrength } =
  core;
const { FUNCTION_WORDS }: typeof import("../../../packages/core/src/function-words.ts") = await import(
  pathToFileURL(join(REPO_ROOT, "packages/core/src/function-words.ts")).href
);
const TOP = 10;
const KEYSTROKE_TOP = 5;
/** Every n-th query is also replayed keystroke by keystroke. */
const KEYSTROKE_SAMPLE_EVERY = 5;
/** Every n-th sentence is replayed keystroke by keystroke: the file stays under Biome's 1 MiB. */
const SENTENCE_KEYSTROKE_EVERY = 6;

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
/** Names, titles and brands in every pack locale: the partial-match rules of PACK_FORMAT.md §4. */
const entities = readQueries("entities-dev.jsonl");
const entityLocales = [...new Set(entities.map((q) => q.locale))];
const ALL_LOCALES = ["en", "es", "zh", "hi", "ar", "fr", "bn", "pt", "ru", "id", "tr"];
/** Index order of PACK_FORMAT.md §2: every core part first (English first), then the ext parts. */
const filesFor = (locale: string) =>
  locale === "en"
    ? ["pack.en.json", "pack.en.ext.json"]
    : ["pack.en.json", `pack.${locale}.json`, "pack.en.ext.json", `pack.${locale}.ext.json`];
/** Every pack locale in one engine, as the website's demo loads them. */
const allFiles = [
  ...ALL_LOCALES.map((l) => `pack.${l}.json`),
  ...ALL_LOCALES.map((l) => `pack.${l}.ext.json`),
];
/**
 * Queries for the engine with every locale: prefix completions into other locales' words, short
 * typos and one-word matches of unknown names (PACK_FORMAT.md §4, "Partial matches").
 */
const GUARD_QUERIES: Query[] = [
  ["kendrick lamar", "en"],
  ["lamar", "en"],
  ["lamar", "id"],
  ["lamara", "en"],
  ["lamara", "id"],
  ["messi", "en"],
  ["taylor swift", "en"],
  ["elon musk", "en"],
  ["feliz cumpl", "en"],
  ["feliz cumpl", "es"],
  ["feliz cumpleaños", "en"],
  ["lam", "en"],
  ["gat", "en"],
  ["gat", "es"],
  ["rockt", "en"],
  ["cofee", "en"],
  ["kedu", "tr"],
  ["kedu", "en"],
  ["naruto ra", "en"],
  ["harry potter", "en"],
  ["i'm exhausted", "en"],
  ["kolay gelsin", "tr"],
  ["生日快乐", "zh"],
  ["joyeux anniv", "fr"],
  ["selamat ulang", "id"],
  ["с днем рожд", "ru"],
  ["bad bunny", "en"],
  ["drake", "en"],
].map(([q, locale], i) => ({ id: `guard-${i + 1}`, q: q as string, locale: locale as string }));
/** Number slang: `fuse` keeps the dictionary's whole-query answer first (core/src/rerank.ts). */
const SLANG_QUERIES: Query[] = [
  ["666", "zh"],
  ["88", "zh"],
].map(([q, locale], i) => ({ id: `slang-${i + 1}`, q: q as string, locale: locale as string }));

const packFiles = [
  ...new Set(["tr", ...sentenceLocales, ...entityLocales].flatMap(filesFor).concat(allFiles)),
];
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
      coverage: out.coverage,
      top: out.results.map((r): Ranked => [r.id, r.score]),
      match: best?.match ?? null,
      field: best?.field ?? null,
    };
  });
}

/** A prefix that ends inside a surrogate pair is not a string Swift can hold. */
const endsInsideSurrogatePair = (text: string) => /[\ud800-\udbff]$/.test(text);

function keystrokeCases(engine: AliasEngine, list: Query[] = queries, every = KEYSTROKE_SAMPLE_EVERY) {
  return list
    .filter((_, i) => i % every === 0)
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

// ── Fusion ────────────────────────────────────────────────────────────────────────────────────
/** mulberry32: a small deterministic PRNG. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `fuse` with and without the reranker on each query's real alias output (limit 12) and a
 * stand-in semantic list: some alias ids and random emoji (flags included), descending scores in
 * the API's range, three decimals. Self-contained (lists, the top result's match and field, and
 * popularity values), so a port checks its fusion even where its alias output differs.
 */
function fusionCases(engine: AliasEngine, list: Query[]) {
  return list.map((q) => {
    const next = random(fnv1a(0x811c9dc5, q.q));
    const alias = engine.search(q.q, { locale: q.locale, limit: 12, culture: false });
    const pool = [...alias.results.slice(0, 8).map((r) => r.id)];
    while (pool.length < 24) pool.push(engine.entries[Math.floor(next() * engine.entries.length)]?.id ?? "");
    const ids = [...new Set(pool.filter(() => next() < 0.7))].slice(0, 12);
    let score = 0.4 + 0.35 * next();
    const semantic = ids.map((id) => {
      const row = [engine.get(id)?.emoji ?? "", id, Math.round(score * 1000) / 1000] as const;
      score -= 0.002 + 0.02 * next();
      return row;
    });
    const results = semantic.map(([emoji, id, s]) => ({ emoji, id, score: s, source: "semantic" as const }));
    const popularity = Object.fromEntries(
      [...new Set([...alias.results.map((r) => r.id), ...ids])].map((id) => [id, engine.popularity(id)]),
    );
    const fused = (rerank: boolean) =>
      fuse(alias, results, TOP, undefined, { popularity: engine.popularity, rerank }).map((r) => r.id);
    return {
      q: q.q,
      alias: {
        query: alias.query,
        confidence: alias.confidence,
        results: alias.results.map((r) => [r.id, r.score]),
        match: alias.results[0]?.match ?? null,
        field: alias.results[0]?.field ?? null,
      },
      semantic,
      popularity,
      reranked: fused(true),
      reciprocal: fused(false),
    };
  });
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

const entityEngines = entityLocales.map((locale) => {
  const files = filesFor(locale);
  return {
    locale,
    files,
    engine: createEngine(files.map(pack)),
    // Every other entity of each locale: the file stays under the 1 MiB that Biome checks.
    list: entities.filter((q) => q.locale === locale).filter((_, i) => i % 2 === 0),
  };
});
const allEngine = createEngine(allFiles.map(pack));

// ── Confidence ────────────────────────────────────────────────────────────────────────────────
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * `assessConfidence`, `semanticStrength` and `mergeConcept` on generated inputs: an alias output
 * (tokens, confidence, coverage, results) and a semantic list with concept results in it.
 */
function confidenceCases() {
  const next = random(20261002);
  const ids = ["1F600", "1F525", "1F680", "1F3A4", "1F3B5", "1F451", "1F98E", "2B50", "1F30B", "1F436"];
  return Array.from({ length: 44 }, (_, n) => {
    const tokens = n % 11 === 0 ? [] : n % 3 === 0 ? ["a", "b"] : ["a"];
    const confidence = round3(next());
    const coverage = n % 4 === 0 ? 1 : round3(next());
    const aliasIds = ids.filter(() => next() < 0.3);
    const alias = {
      query: tokens.join(" "),
      tokens,
      confidence,
      coverage,
      results: aliasIds.map((id, i) => ({
        emoji: id,
        id,
        score: round3(Math.max(0, confidence - i * 0.05)),
        source: "alias" as const,
        label: id,
        match: "a",
        field: "alias" as const,
      })),
    };
    const top = round3(0.3 + next() * 0.4);
    const semanticIds = ids.filter(() => next() < 0.6);
    const semantic = [
      ...(n % 5 === 0 ? [{ emoji: "1F3A4", id: "1F3A4", score: 0.9, source: "concept" as const }] : []),
      ...semanticIds.map((id, i) => ({
        emoji: id,
        id,
        score: round3(top - i * next() * 0.03),
        source: "semantic" as const,
      })),
    ];
    const concept = ids
      .filter(() => next() < 0.25)
      .map((id, i) => ({ emoji: id, id, score: round3(0.9 - i * 0.1), source: "concept" as const }));
    const fused = [...alias.results, ...semantic.filter((r) => r.source === "semantic")];
    const withAlias = n % 7 !== 0;
    const verdict = assessConfidence(withAlias ? alias : undefined, n % 9 === 0 ? undefined : semantic);
    return {
      alias: withAlias
        ? { tokens, confidence, coverage, results: alias.results.map((r) => [r.id, r.score]) }
        : null,
      semantic: n % 9 === 0 ? null : semantic.map((r) => [r.id, r.score, r.source]),
      concept: concept.map((r) => [r.id, r.score]),
      fused: fused.map((r) => [r.id, r.score, r.source]),
      limit: 4 + (n % 5),
      strength: n % 9 === 0 ? null : semanticStrength(semantic),
      confidence: verdict.confidence,
      unsure: verdict.unsure,
      merged: mergeConcept(fused, concept, withAlias ? alias : undefined, 4 + (n % 5)).map((r) => r.id),
    };
  });
}

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
    ...entityEngines.map(({ locale, files, engine, list }) => ({
      name: `${locale} entities`,
      packs: files,
      cases: searchCases(engine, list),
    })),
    { name: "all locales", packs: allFiles, cases: searchCases(allEngine, GUARD_QUERIES) },
  ],
  keystrokes: { packs: fullFiles, cases: keystrokeCases(fullEngine) },
  /** `fuse` with (reranked) and without (reciprocal) the reranker; PACK_FORMAT.md §10. */
  fusion: [
    // Every fourth query: the file stays under the 1 MiB that Biome checks.
    ...fusionCases(
      fullEngine,
      queries.filter((_, i) => i % 4 === 0),
    ),
    ...fusionCases(createEngine(filesFor("zh").map(pack)), SLANG_QUERIES),
  ],
  /** Per sentence locale: every n-th sentence, keystroke by keystroke. */
  sentenceKeystrokes: localeEngines.map(({ files, engine, list }) => ({
    packs: files,
    cases: keystrokeCases(engine, list, SENTENCE_KEYSTROKE_EVERY),
  })),
  /**
   * Every third guard query with every locale, keystroke by keystroke (prefix completions into other
   * locales' words happen while typing). Entity queries per locale are checked whole, above:
   * their keystrokes would take the file past the 1 MiB that Biome checks.
   */
  entityKeystrokes: [{ packs: allFiles, cases: keystrokeCases(allEngine, GUARD_QUERIES, 3) }],
  /**
   * The unsure verdict and the concept merge (core/src/confidence.ts) on generated inputs.
   * `alias` / `semantic` null = not given. Results are `[id, score]` (alias, concept) or
   * `[id, score, source]` (semantic list, fused list). `strength` is unrounded, null without a
   * semantic list.
   */
  confidence: confidenceCases(),
};
const keystrokeCount =
  golden.keystrokes.cases.length +
  [...golden.sentenceKeystrokes, ...golden.entityKeystrokes].reduce((sum, k) => sum + k.cases.length, 0);

writeFileSync(OUTPUT, `${JSON.stringify(golden)}\n`);
// Keep the file in the repository's canonical format so `pnpm lint` stays green.
execFileSync(join(THIS_REPO, "node_modules/.bin/biome"), ["format", "--write", OUTPUT], { stdio: "ignore" });
console.log(
  `make-golden: ${queries.length} queries × 2 configs, ${sentences.length} sentences in ` +
    `${sentenceLocales.length} locales, ${entities.length} entities in ${entityLocales.length} locales, ` +
    `${GUARD_QUERIES.length} guard queries with every locale, ${golden.confidence.length} confidence cases, ` +
    `${keystrokeCount} keystrokes, ` +
    `${NORMALIZATION_INPUTS.length} normalization cases, ${golden.normalization.sweep.hashes.length} sweep blocks → ${OUTPUT}`,
);
