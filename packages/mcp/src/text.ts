import { type AliasEngine, type AliasResult, boundedEditDistance, normalize, tokenize } from "emojisense";

/** Longest word window tried against the alias index. Most intent aliases have ≤ 4 words. */
const MAX_WINDOW = 4;
/** Only the start of a long message is scanned. This keeps a call at ≈ 4 × 64 index lookups. */
const MAX_TEXT_TOKENS = 64;
const MAX_TEXT_CHARS = 1024;
/** Results kept per window. Generous, because a reaction emoji often sits below topical ones. */
const PER_WINDOW = 16;
/** Weaker matches are mostly fuzzy noise from ordinary words in a sentence. */
const MIN_SCORE = 0.45;
/** A longer matched alias is more specific: "congrats on the launch" beats "launch". */
const PHRASE_BONUS = 0.1;
const EVIDENCE_BONUS = 0.04;
const MAX_EVIDENCE_BONUS = 0.12;
/** A single very common word ("new", "day") says little about the message on its own. */
const COMMON_WORD_FACTOR = 0.6;
/** "pr" or "ki" alone would otherwise suggest the flags of Puerto Rico or Kiribati. */
const SHORT_FLAG_FACTOR = 0.5;
/** Each further pick from the same window costs a little, so one word does not fill the list. */
const SAME_WINDOW_FACTOR = 0.93;

/** Function words (en + folded tr). A window made only of these is not searched. */
const STOPWORDS = new Set(
  (
    "a an the of to in on at for from by is are am was were be been im i me my you your u it its this " +
    "that so and or but with just very really too we our they them he she his her us if then than as " +
    "bir ve ile bu su da de mi ben sen o icin gibi ama"
  ).split(" "),
);

/** Frequent words that match emoji keywords but rarely carry the point of a sentence. */
const COMMON_WORDS = new Set(
  (
    "new can day again got get go going all one time make see know take come want need would could " +
    "should will also back still now here there out over more most some any every much many even way " +
    "thing things lot like let lets did do does done have has had what when where who why how which " +
    "about into after before off only first last next same other today"
  ).split(" "),
);

export interface TextMatch extends AliasResult {
  /** The part of the text that matched, e.g. "happy birthday". */
  window: string;
}

export interface TextMatchOptions {
  locale?: string;
  limit?: number;
}

/** The normalized words of a message, capped for cost. */
export function textTokens(text: string): string[] {
  return tokenize(normalize(text, MAX_TEXT_CHARS)).slice(0, MAX_TEXT_TOKENS);
}

/**
 * Word windows of 1–{@link MAX_WINDOW} tokens, longest first. Windows may start with a function
 * word, because many intent aliases do ("on fire", "we launched", "just shipped").
 */
export function textWindows(tokens: readonly string[]): string[] {
  const windows = new Set<string>();
  for (let size = MAX_WINDOW; size >= 1; size--) {
    for (let start = 0; start + size <= tokens.length; start++) {
      const window = tokens.slice(start, start + size);
      if (window.every((token) => STOPWORDS.has(token))) continue;
      windows.add(window.join(" "));
    }
  }
  return [...windows];
}

/**
 * Share of the alias phrase's words that occur in the text. A window such as "shipped" partly
 * matches the alias "order shipped", but the message never said "order". A one-letter typo counts
 * half: in running text, "fine" is far more often a real word than a typo of "fire".
 */
function phraseCoverage(phrase: string, words: ReadonlySet<string>): number {
  const phraseWords = phrase.split(" ");
  let present = 0;
  for (const word of phraseWords) {
    if (words.has(word)) present += 1;
    else if (word.length >= 4 && [...words].some((w) => boundedEditDistance(word, w, 1) <= 1)) present += 0.5;
  }
  return present / phraseWords.length;
}

/** How telling the matched alias is on its own, independent of the engine score. */
function phraseFactor(engine: AliasEngine, result: AliasResult): number {
  const { match } = result;
  if (match.includes(" ")) return 1 + PHRASE_BONUS * (match.split(" ").length - 1);
  if (COMMON_WORDS.has(match)) return COMMON_WORD_FACTOR;
  if (match.length <= 3 && engine.get(result.id)?.group === "flags") return SHORT_FLAG_FACTOR;
  return 1;
}

/**
 * Emoji for free text (a sentence, a chat message). The alias engine is built for short queries,
 * so the text is cut into word windows. Each window is an exact (non-prefix) query, and the
 * strongest matches are merged per emoji. Intent aliases such as "we launched" or "sorry for your
 * loss" make this work offline without a model.
 */
export function matchText(engine: AliasEngine, text: string, options: TextMatchOptions = {}): TextMatch[] {
  const { locale, limit = 10 } = options;
  const tokens = textTokens(text);
  const words = new Set(tokens);
  const best = new Map<string, { match: TextMatch; score: number; phrases: Set<string> }>();

  for (const window of textWindows(tokens)) {
    const { results } = engine.search(window, {
      prefix: false,
      limit: PER_WINDOW,
      ...(locale ? { locale } : {}),
    });
    for (const result of results) {
      const coverage = phraseCoverage(result.match, words);
      const score = result.score * coverage * coverage * phraseFactor(engine, result);
      if (score < MIN_SCORE) continue;
      const current = best.get(result.id);
      if (!current) {
        best.set(result.id, { match: { ...result, window }, score, phrases: new Set([result.match]) });
        continue;
      }
      // Overlapping windows find the same alias again; only distinct aliases are extra evidence.
      current.phrases.add(result.match);
      if (score > current.score) {
        current.score = score;
        current.match = { ...result, window };
      }
    }
  }

  const ranked = [...best.values()]
    .map(({ match, score, phrases }) => ({
      match,
      score: Math.min(1, score + Math.min(MAX_EVIDENCE_BONUS, (phrases.size - 1) * EVIDENCE_BONUS)),
    }))
    .sort((a, b) => b.score - a.score);
  return diversify(ranked, limit);
}

/** Greedy re-rank: each emoji that comes from an already used window loses a little. */
function diversify(ranked: { match: TextMatch; score: number }[], limit: number): TextMatch[] {
  const picked: TextMatch[] = [];
  const perWindow = new Map<string, number>();
  const pool = [...ranked];
  while (picked.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -1;
    pool.forEach(({ match, score }, index) => {
      const adjusted = score * SAME_WINDOW_FACTOR ** (perWindow.get(match.window) ?? 0);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = index;
      }
    });
    const [{ match }] = pool.splice(bestIndex, 1) as [{ match: TextMatch; score: number }];
    perWindow.set(match.window, (perWindow.get(match.window) ?? 0) + 1);
    picked.push({ ...match, score: round(bestScore) });
  }
  return picked;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
