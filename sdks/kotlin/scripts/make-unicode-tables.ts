/**
 * Writes the Unicode data of the TypeScript reference runtime that the Kotlin normalizer needs:
 *
 * - src/main/kotlin/com/emojisense/UnicodeTables.kt: property ranges, lowercase mappings, full
 *   decompositions, the order of the canonical combining classes, and the primary composites.
 * - src/test/resources/normalization-forms.json: NFC, NFD, NFKC, NFKD and lowercase of random
 *   sequences, the oracle for the Kotlin implementation of those operations.
 *
 * The Kotlin SDK does not use java.text.Normalizer or java.lang.Character: their Unicode version
 * depends on the JVM or Android release (JDK 21 has Unicode 15.0, the reference Node 24 has 16.0).
 * Everything comes from this Node runtime. Node does not expose canonical combining classes, so
 * the script derives their order from how NFD reorders pairs of marks; only the order matters to
 * normalization. Before it writes anything, it rebuilds every normalization form from the tables
 * and compares it with Node, for every code point and for random sequences.
 *
 *   pnpm exec tsx sdks/kotlin/scripts/make-unicode-tables.ts      (with Node 24)
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const KOTLIN_OUTPUT = fileURLToPath(
  new URL("../src/main/kotlin/com/emojisense/UnicodeTables.kt", import.meta.url),
);
const FIXTURE_OUTPUT = fileURLToPath(
  new URL("../src/test/resources/normalization-forms.json", import.meta.url),
);

const MAX_CODE_POINT = 0x10ffff;
/** Keep in sync with packages/core/src/normalize.ts. */
const EMOJI_PARTS =
  /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{E0020}-\u{E007F}]$/u;
const EMOJI_GLUE = [0x200d, 0xfe0e, 0xfe0f, 0x20e3];
const WORD = /^[\p{L}\p{M}\p{N}]$/u;
const SPACING = /^[\p{Cc}\p{Z}﻿]$/u;
const CASED = /^\p{Cased}$/u;
const CASE_IGNORABLE = /^\p{Case_Ignorable}$/u;
/** Canonical combining class 1 (Overlay) and 240 (Iota subscript): the lowest and highest. */
const LOWEST_CLASS_MARK = 0x0334;
const HIGHEST_CLASS_MARK = 0x0345;
const CAPITAL_SIGMA = 0x03a3;
const FIXTURE_CASES = 800;
const SELF_CHECK_CASES = 60_000;
/** Longest text in one Kotlin string constant (the class file limit is 65,535 bytes). */
const CHUNK_LENGTH = 30_000;

const S_BASE = 0xac00;
const L_BASE = 0x1100;
const V_BASE = 0x1161;
const T_BASE = 0x11a7;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = 19 * N_COUNT;

type Range = [number, number];

const chr = (cp: number) => String.fromCodePoint(cp);
const codePoints = (text: string) => Array.from(text, (c) => c.codePointAt(0) as number);
const isSurrogate = (cp: number) => cp >= 0xd800 && cp <= 0xdfff;
const isHangulSyllable = (cp: number) => cp >= S_BASE && cp < S_BASE + S_COUNT;
const hex = (cp: number) => cp.toString(16).toUpperCase();

function* everyCodePoint(): Generator<number> {
  for (let cp = 0; cp <= MAX_CODE_POINT; cp++) if (!isSurrogate(cp)) yield cp;
}

function rangesWhere(test: (cp: number) => boolean): Range[] {
  const ranges: Range[] = [];
  for (const cp of everyCodePoint()) {
    if (!test(cp)) continue;
    const last = ranges.at(-1);
    if (last && last[1] === cp - 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  return ranges;
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`make-unicode-tables: ${message}`);
}

// ── Properties ──────────────────────────────────────────────────────────────────────────────
const emojiParts = rangesWhere((cp) => EMOJI_PARTS.test(chr(cp)));
const word = rangesWhere((cp) => WORD.test(chr(cp)));
const spacing = rangesWhere((cp) => SPACING.test(chr(cp)));
const cased = rangesWhere((cp) => CASED.test(chr(cp)));
const caseIgnorable = rangesWhere((cp) => CASE_IGNORABLE.test(chr(cp)));
check(
  EMOJI_GLUE.every((cp) => !EMOJI_PARTS.test(chr(cp))),
  "emoji glue and emoji parts must not overlap (the Kotlin normalizer handles them in one pass)",
);

// ── Lowercase (the context-free mapping; Final_Sigma is applied in code) ───────────────────
const lowercase = new Map<number, number[]>();
for (const cp of everyCodePoint()) {
  const lower = chr(cp).toLowerCase();
  if (lower !== chr(cp)) lowercase.set(cp, codePoints(lower));
}

// ── Decompositions (full, as NFD and NFKD give them for one code point) ───────────────────────
const canonical = new Map<number, number[]>();
const compatibility = new Map<number, number[]>();
for (const cp of everyCodePoint()) {
  if (isHangulSyllable(cp)) continue;
  const text = chr(cp);
  const nfd = text.normalize("NFD");
  const nfkd = text.normalize("NFKD");
  if (nfd !== text) canonical.set(cp, codePoints(nfd));
  if (nfkd !== nfd) compatibility.set(cp, codePoints(nfkd));
}

// ── Order of the canonical combining classes ────────────────────────────────────────────────
/** NFD moves `a` after `b`: ccc(a) > ccc(b) > 0. */
const sortsAfter = (a: number, b: number) => (chr(a) + chr(b)).normalize("NFD") === chr(b) + chr(a);
check(sortsAfter(HIGHEST_CLASS_MARK, LOWEST_CLASS_MARK), "U+0345 must sort after U+0334");
const nonStarters: number[] = [];
for (const cp of everyCodePoint()) {
  if (canonical.has(cp) || isHangulSyllable(cp)) continue;
  if (sortsAfter(cp, LOWEST_CLASS_MARK) || sortsAfter(HIGHEST_CLASS_MARK, cp)) nonStarters.push(cp);
}
nonStarters.sort((a, b) => (sortsAfter(a, b) ? 1 : sortsAfter(b, a) ? -1 : a - b));
/** 1 = the lowest non-zero class. Code points without an entry are starters (class 0). */
const classRank = new Map<number, number>();
nonStarters.forEach((cp, i) => {
  const previous = nonStarters[i - 1];
  const rank =
    previous === undefined ? 1 : (classRank.get(previous) as number) + (sortsAfter(cp, previous) ? 1 : 0);
  classRank.set(cp, rank);
});
const rankOf = (cp: number) => classRank.get(cp) ?? 0;

// ── Normalization forms rebuilt from the tables ────────────────────────────────────────────
function reorder(points: number[]): number[] {
  for (let i = 1; i < points.length; i++) {
    const rank = rankOf(points[i] as number);
    if (rank === 0) continue;
    let j = i;
    while (j > 0 && rankOf(points[j - 1] as number) > rank) {
      [points[j - 1], points[j]] = [points[j] as number, points[j - 1] as number];
      j--;
    }
  }
  return points;
}

function decompose(points: number[], compat: boolean): number[] {
  const out: number[] = [];
  for (const cp of points) {
    if (isHangulSyllable(cp)) {
      const index = cp - S_BASE;
      out.push(L_BASE + Math.floor(index / N_COUNT), V_BASE + Math.floor((index % N_COUNT) / T_COUNT));
      if (index % T_COUNT !== 0) out.push(T_BASE + (index % T_COUNT));
      continue;
    }
    const mapping = (compat ? compatibility.get(cp) : undefined) ?? canonical.get(cp);
    if (mapping) out.push(...mapping);
    else out.push(cp);
  }
  return reorder(out);
}

const pairKey = (first: number, second: number) => first * 0x110000 + second;
const compositions = new Map<number, number>();

function composePair(first: number, second: number): number | undefined {
  if (first >= L_BASE && first < L_BASE + 19 && second >= V_BASE && second < V_BASE + V_COUNT) {
    return S_BASE + ((first - L_BASE) * V_COUNT + (second - V_BASE)) * T_COUNT;
  }
  if (
    isHangulSyllable(first) &&
    (first - S_BASE) % T_COUNT === 0 &&
    second > T_BASE &&
    second < T_BASE + T_COUNT
  ) {
    return first + (second - T_BASE);
  }
  return compositions.get(pairKey(first, second));
}

/** Canonical composition (UAX #15 D117) of a decomposed, canonically ordered sequence. */
function compose(points: readonly number[]): number[] {
  const out: number[] = [];
  let starter = -1;
  /** Rank of the last code point kept after the starter; -1 = none since the starter. */
  let lastRank = -1;
  for (const cp of points) {
    const rank = rankOf(cp);
    if (starter >= 0 && (lastRank === -1 || lastRank < rank)) {
      const composite = composePair(out[starter] as number, cp);
      if (composite !== undefined) {
        out[starter] = composite;
        continue;
      }
    }
    if (rank === 0) {
      starter = out.length;
      lastRank = -1;
    } else {
      lastRank = rank;
    }
    out.push(cp);
  }
  return out;
}

// ── Primary composites, shortest decomposition first ───────────────────────────────────────
// Composing a composite's own decomposition with the pairs found so far stops one step short:
// at [the composite of everything but the last code point, the last code point]. That pair is the
// composite's canonical decomposition mapping.
const composites = [...canonical.keys()].filter((cp) => chr(cp).normalize("NFC") === chr(cp));
const decompositionLength = (cp: number) => (canonical.get(cp) as number[]).length;
composites.sort((a, b) => decompositionLength(a) - decompositionLength(b) || a - b);
for (const cp of composites) {
  const decomposition = canonical.get(cp) as number[];
  const partial = compose(decomposition);
  check(
    partial.length === 2 && partial[1] === decomposition.at(-1),
    `U+${hex(cp)} does not compose from its decomposition`,
  );
  const [first, second] = partial as [number, number];
  check((chr(first) + chr(second)).normalize("NFC") === chr(cp), `U+${hex(cp)}: pair check failed`);
  compositions.set(pairKey(first, second), cp);
}

const forms = (text: string) => {
  const points = codePoints(text);
  return {
    NFD: decompose(points, false),
    NFKD: decompose(points, true),
    NFC: compose(decompose(points, false)),
    NFKC: compose(decompose(points, true)),
  };
};

// ── Lowercase rebuilt from the tables, with Final_Sigma as ICU applies it ───────────────────
const inRanges = (ranges: readonly Range[], cp: number) => {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((ranges[middle] as Range)[1] < cp) low = middle + 1;
    else high = middle;
  }
  return low < ranges.length && (ranges[low] as Range)[0] <= cp;
};

function hasCasedNeighbor(points: readonly number[], index: number, step: number): boolean {
  for (let i = index + step; i >= 0 && i < points.length; i += step) {
    const cp = points[i] as number;
    if (!inRanges(caseIgnorable, cp)) return inRanges(cased, cp);
  }
  return false;
}

function lower(text: string): number[] {
  const points = codePoints(text);
  return points.flatMap((cp, i) => {
    if (cp === CAPITAL_SIGMA && hasCasedNeighbor(points, i, -1) && !hasCasedNeighbor(points, i, 1)) {
      return [0x03c2];
    }
    return lowercase.get(cp) ?? [cp];
  });
}

// ── Self-check against Node ──────────────────────────────────────────────────────────────────
const same = (points: readonly number[], text: string) => String.fromCodePoint(...points) === text;

function checkText(text: string): void {
  const rebuilt = forms(text);
  for (const form of ["NFD", "NFKD", "NFC", "NFKC"] as const) {
    check(same(rebuilt[form], text.normalize(form)), `${form} differs for ${JSON.stringify(text)}`);
  }
  check(same(lower(text), text.toLowerCase()), `lowercase differs for ${JSON.stringify(text)}`);
}

for (const cp of everyCodePoint()) checkText(chr(cp));

/** mulberry32: a small seeded generator, so the fixture is the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const next = random(0x5eed);
const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
const between = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
const compositionParts = [...compositions.keys()].flatMap((key) => [
  Math.floor(key / 0x110000),
  key % 0x110000,
]);
const pools: (() => number)[] = [
  () => pick(nonStarters),
  () => pick(nonStarters),
  () => pick(compositionParts),
  () => pick(composites),
  () => pick([...compatibility.keys()]),
  () => between(0x1100, 0x11ff),
  () => between(S_BASE, S_BASE + S_COUNT - 1),
  () => pick([CAPITAL_SIGMA, 0x03c3, 0x0391, 0x0345, 0x02b0, 0x0130, 0x0049, 0x0027, 0x00b7]),
  () => pick([...lowercase.keys()]),
  () => between(0x20, 0x7e),
  () => {
    const cp = between(0, MAX_CODE_POINT);
    return isSurrogate(cp) ? 0xfffd : cp;
  },
];
const randomText = () =>
  String.fromCodePoint(...Array.from({ length: between(2, 7) }, () => (pick(pools) as () => number)()));

for (let i = 0; i < SELF_CHECK_CASES; i++) checkText(randomText());
/** Code points in hex, so the fixture stays ASCII; "=" stands for "the same as the input". */
const fixtureCases = Array.from({ length: FIXTURE_CASES }, () => {
  const text = randomText();
  const outputs = [
    text.normalize("NFC"),
    text.normalize("NFD"),
    text.normalize("NFKC"),
    text.normalize("NFKD"),
    text.toLowerCase(),
  ];
  const encode = (value: string) => codePoints(value).map(hex).join(" ");
  return [encode(text), ...outputs.map((output) => (output === text ? "=" : encode(output)))];
});

// ── Output ───────────────────────────────────────────────────────────────────────────────────
const rangeText = (ranges: readonly Range[]) =>
  ranges.map(([low, high]) => (low === high ? hex(low) : `${hex(low)}-${hex(high)}`));
const mappingText = (map: ReadonlyMap<number, number[]>, separator: string) =>
  [...map]
    .sort(([a], [b]) => a - b)
    .map(([cp, points]) => `${hex(cp)}${separator}${points.map(hex).join(",")}`);
/** Runs of code points with the same class rank: `start-end:rank` or `cp:rank`. */
const classText = () => {
  const ranked = [...classRank].sort(([a], [b]) => a - b);
  const runs: [number, number, number][] = [];
  for (const [cp, rank] of ranked) {
    const last = runs.at(-1);
    if (last && last[1] === cp - 1 && last[2] === rank) last[1] = cp;
    else runs.push([cp, cp, rank]);
  }
  return runs.map(
    ([low, high, rank]) => `${low === high ? hex(low) : `${hex(low)}-${hex(high)}`}:${hex(rank)}`,
  );
};
const compositionText = () =>
  [...compositions]
    .sort(([a], [b]) => a - b)
    .map(([key, cp]) => `${hex(Math.floor(key / 0x110000))},${hex(key % 0x110000)}:${hex(cp)}`);

/** Space-separated entries as Kotlin string literals: ≤ CHUNK_LENGTH per string, ~100 per line. */
function kotlinStrings(entries: readonly string[]): string {
  const chunks: string[][] = [[]];
  let length = 0;
  for (const entry of entries) {
    if (length + entry.length + 1 > CHUNK_LENGTH) {
      chunks.push([]);
      length = 0;
    }
    (chunks.at(-1) as string[]).push(entry);
    length += entry.length + 1;
  }
  const literal = (chunk: string[]) => {
    const lines: string[] = [];
    let line = "";
    for (const entry of chunk) {
      const piece = line === "" ? entry : ` ${entry}`;
      if (line.length + piece.length > 96) {
        lines.push(line);
        line = ` ${entry}`;
      } else {
        line += piece;
      }
    }
    lines.push(line);
    return lines.map((text) => `        "${text}"`).join(" +\n");
  };
  return `arrayOf(\n${chunks.map(literal).join(",\n")},\n    )`;
}

const unicode = process.versions.unicode;
check(unicode !== undefined, "this Node runtime does not report its Unicode version");
const table = (doc: string, name: string, entries: readonly string[]) =>
  [`    /** ${doc} */`, `    val ${name}: Array<String> = ${kotlinStrings(entries)}`, ""].join("\n");
const kotlin = [
  `// Generated by sdks/kotlin/scripts/make-unicode-tables.ts from Node ${process.versions.node}`,
  `// (Unicode ${unicode}, ICU ${process.versions.icu}). Do not edit.`,
  "package com.emojisense",
  "",
  "/**",
  " * Unicode data of the TypeScript reference runtime, as text that [UnicodeData] parses once.",
  " * Hexadecimal code points; entries are separated by spaces. Ranges are inclusive.",
  " */",
  "internal object UnicodeTables {",
  `    const val UNICODE_VERSION = "${unicode}"`,
  "",
  table(
    "Extended_Pictographic, Emoji_Modifier, Regional_Indicator and U+E0020–E007F (PACK_FORMAT.md §3, step 2).",
    "EMOJI_PARTS",
    rangeText(emojiParts),
  ),
  table("Letters, marks and numbers: `\\p{L}`, `\\p{M}`, `\\p{N}` (step 9).", "WORD", rangeText(word)),
  table(
    "`\\p{Cc}`, `\\p{Z}` and U+FEFF: what the embedding text turns into spaces.",
    "SPACING",
    rangeText(spacing),
  ),
  table("The Cased property (Final_Sigma context).", "CASED", rangeText(cased)),
  table("The Case_Ignorable property (Final_Sigma context).", "CASE_IGNORABLE", rangeText(caseIgnorable)),
  table(
    "Full lowercase mapping without context (`code:mapping`). Final_Sigma is applied in code.",
    "LOWERCASE",
    mappingText(lowercase, ":"),
  ),
  table(
    "Full canonical decomposition (`code:mapping`). Hangul syllables are algorithmic.",
    "CANONICAL",
    mappingText(canonical, ":"),
  ),
  table(
    "Full compatibility decomposition where it differs from the canonical one (`code:mapping`).",
    "COMPATIBILITY",
    mappingText(compatibility, ":"),
  ),
  table(
    "Order of the canonical combining classes (`range:rank`, 1 = the lowest non-zero class). Other code " +
      "points are starters. Only the order matters to normalization, so ranks stand in for class values.",
    "COMBINING_CLASS_RANK",
    classText(),
  ),
  table("Primary composites, Hangul excepted (`first,second:composite`).", "COMPOSITIONS", compositionText()),
  "}",
  "",
].join("\n");
writeFileSync(KOTLIN_OUTPUT, kotlin);

const fixture = {
  generatedBy: "sdks/kotlin/scripts/make-unicode-tables.ts",
  node: process.versions.node,
  unicode,
  /** [input, NFC, NFD, NFKC, NFKD, toLowerCase()], as hex code points; "=" = the input. */
  cases: fixtureCases,
};
writeFileSync(FIXTURE_OUTPUT, `${JSON.stringify(fixture)}\n`);
execFileSync(join(REPO_ROOT, "node_modules/.bin/biome"), ["format", "--write", FIXTURE_OUTPUT], {
  stdio: "ignore",
});

console.log(
  `make-unicode-tables: Unicode ${unicode}, ${word.length} word ranges, ${lowercase.size} lowercase mappings, ` +
    `${canonical.size} canonical and ${compatibility.size} compatibility decompositions, ` +
    `${nonStarters.length} non-starters in ${new Set(classRank.values()).size} classes, ` +
    `${compositions.size} compositions; self-check passed on every code point and ${SELF_CHECK_CASES} sequences`,
);
