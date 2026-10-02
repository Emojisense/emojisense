import { applyCulture, type Culture, type CultureResult, type CultureScope } from "./culture.js";
import { boundedEditDistance, maxEditsFor, plausibleTypo } from "./fuzzy.js";
import { normalize, tokenize } from "./normalize.js";
import {
  assertPack,
  DEFAULT_WEIGHTS,
  FIELDS,
  type Field,
  isCustomPack,
  type Pack,
  type PackRow,
  ROW,
} from "./pack.js";

export type ResultSource = "alias" | "semantic" | "custom" | "culture";

export interface SearchResult {
  /** The emoji character, or `:shortcode:` for a custom emoji. */
  emoji: string;
  /** Emojibase hexcode of the base emoji, e.g. "1F44D"; `C-<emojiId>` for a custom emoji. */
  id: string;
  /** 0–1. Comparable within one source only. */
  score: number;
  source: ResultSource;
  /** Custom emoji: the image to draw instead of a font glyph. */
  imageUrl?: string;
  /** Custom emoji: the shortcode without colons, e.g. "party_parrot". */
  shortcode?: string;
}

export interface AliasResult extends SearchResult {
  /** "custom" for rows of a custom pack (they carry `imageUrl` and `shortcode`). */
  source: "alias" | "custom";
  label: string;
  /** The phrase that matched best, for debugging and "why this result" UI. */
  match: string;
  field: Field;
}

export interface AliasSearchOptions extends CultureScope {
  /** Default 24. */
  limit?: number;
  /** Preferred locale. Matches that exist only in other loaded packs get a small penalty. */
  locale?: string;
  /** Treat the last token as a prefix while the user is still typing. Default true. */
  prefix?: boolean;
  /** `false` = canonical ranking only, even when the engine has a culture file (reproducible). */
  culture?: boolean;
}

export interface AliasSearchOutput {
  /** The normalized query that was searched. */
  query: string;
  tokens: string[];
  /** The canonical ranking, plus culture results after its top result when the engine has a culture file. */
  results: (AliasResult | CultureResult)[];
  /** Score of the best canonical result, 0 when there is none. */
  confidence: number;
}

/** The canonical ranking only (`culture: false`). */
export interface CanonicalSearchOutput extends AliasSearchOutput {
  results: AliasResult[];
}

export interface EmojiEntry {
  emoji: string;
  id: string;
  group: string;
  version: number;
  hasSkinTones: boolean;
  /** Display label per loaded locale. */
  labels: Record<string, string>;
  /** Custom emoji only (see {@link SearchResult}). */
  imageUrl?: string;
  shortcode?: string;
}

export interface EngineOptions {
  /**
   * Minimum IDF-weighted share of the query a phrase must cover (0–1). Higher = fewer partial
   * matches on multi-word queries. Default 0.34.
   */
  minCoverage?: number;
  /** A culture file (loadCulture) whose entries add results after the canonical top result. */
  culture?: Culture;
}

export interface AliasEngine {
  /** `culture: false` gives the canonical ranking, typed as alias results only. */
  search(query: string, options: AliasSearchOptions & { culture: false }): CanonicalSearchOutput;
  search(query: string, options?: AliasSearchOptions): AliasSearchOutput;
  get(id: string): EmojiEntry | undefined;
  /** The same index with another culture file (`undefined` = none). The index is shared, not rebuilt. */
  withCulture(culture: Culture | undefined): AliasEngine;
  readonly culture: Culture | undefined;
  readonly entries: readonly EmojiEntry[];
  readonly locales: readonly string[];
  readonly packVersion: string;
}

const MAX_QUERY_TOKENS = 8;
const MAX_PREFIX_EXPANSION = 400;
const MIN_COVERAGE = 0.34;
const NON_EXACT_FACTOR = 0.9;
/** A multi-word query that equals a whole phrase ("ship it") beats one-word name hits ("ship"). */
const EXACT_PHRASE_BONUS = 1.1;
const FOREIGN_LOCALE_FACTOR = 0.92;
const EVIDENCE_BONUS = 0.02;
const MAX_EVIDENCE_BONUS = 0.06;
const STOPWORD_WEIGHT_CAP = 0.3;
/** Longest piece (code points) tried when a run of an unspaced script is split. */
const MAX_PIECE_LENGTH = 16;
/**
 * Scripts written without spaces between words: Thai, Lao, Myanmar, Khmer, kana, Han. A run of
 * them is one token after normalization, so a sentence only matches if it is a whole phrase.
 */
const UNSPACED_SCRIPT = /[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿豈-﫿\u{20000}-\u{3134F}]/u;

/** Function words that carry little meaning in a query (en + folded tr). */
const STOPWORDS = new Set(
  (
    "a an the of to in on at for from by is are am be im i me my you your u it its this that " +
    "so and or with just very really too we our they them he she his her bir ve ile bu su cok " +
    "da de mi ben sen o icin gibi"
  ).split(" "),
);

function entryOf(pack: Pack, row: PackRow): EmojiEntry {
  const entry: EmojiEntry = {
    emoji: row[ROW.emoji],
    id: row[ROW.hexcode],
    group: pack.groups[row[ROW.group]] ?? "unknown",
    version: row[ROW.version],
    hasSkinTones: row[ROW.skins] === 1,
    labels: {},
  };
  if (!isCustomPack(pack)) return entry;
  const imageUrl = pack.images?.[entry.id];
  const shortcode = /^:(.+):$/.exec(entry.emoji)?.[1] ?? row[ROW.label];
  return { ...entry, shortcode, ...(imageUrl ? { imageUrl } : {}) };
}

/** What search needs from the packs: phrases, vocabulary, postings and IDF. */
interface PhraseIndex {
  phraseText: string[];
  phraseEmoji: Int32Array;
  phraseField: Uint8Array;
  /** Bit i set = the phrase is in packs[i]. */
  phraseLocaleMask: Uint32Array;
  phraseLength: Int32Array;
  phraseFieldWeight: Float64Array;
  /** Sorted, so prefix search is a binary search. */
  vocab: string[];
  tokenId: Map<string, number>;
  postingStart: Int32Array;
  postings: Int32Array;
  idf: Float64Array;
  maxIdf: number;
  tokensByLength: Map<number, number[]>;
}

/**
 * Index the phrases of all packs. A separate function on purpose: its build-time structures
 * (per-emoji dedup maps, token lists) are captured by the closures here, so they are freed when
 * it returns. Inside createEngine they would share the context of `search` and live as long as
 * the engine (≈ half of its memory).
 */
function indexPhrases(packs: Pack[], entries: EmojiEntry[], indexById: Map<string, number>): PhraseIndex {
  // Pass 1: collect phrases, deduplicated per emoji (strongest field / first pack wins). Each
  // token gets an id in first-seen order at once, into one flat list: all 22 packs have ≈ 0.7 M
  // phrases, and an array of tokens per phrase was most of the build time and garbage.
  const phraseEmojiList: number[] = [];
  const phraseField: number[] = [];
  const phraseLocaleMask: number[] = [];
  /** The weights of the pack that added the phrase first (the lowest bit of its locale mask). */
  const phraseFieldWeightList: number[] = [];
  const phraseText: string[] = [];
  /** Tokens of phrase p: `firstSeenTokenIds[phraseTokenEnd[p - 1] … phraseTokenEnd[p])`. */
  const phraseTokenEnd: number[] = [];
  const firstSeenTokenIds: number[] = [];
  const tokenId = new Map<string, number>();
  const seenByEmoji = entries.map(() => new Map<string, number>());

  const addToken = (token: string) => {
    let id = tokenId.get(token);
    if (id === undefined) {
      id = tokenId.size;
      tokenId.set(token, id);
    }
    firstSeenTokenIds.push(id);
  };

  packs.forEach((pack, packIndex) => {
    const weights = { ...DEFAULT_WEIGHTS, ...pack.weights };
    const fieldWeights = FIELDS.map((field) => weights[field]);
    const packBit = 1 << packIndex;
    for (const row of pack.emoji) {
      const emojiIndex = indexById.get(row[ROW.hexcode]);
      if (emojiIndex === undefined) continue;
      const label = row[ROW.label];
      if (label) (entries[emojiIndex] as EmojiEntry).labels[pack.locale] = label;
      const seen = seenByEmoji[emojiIndex] as Map<string, number>;
      for (let fieldIndex = 0; fieldIndex < FIELDS.length; fieldIndex++) {
        const weight = fieldWeights[fieldIndex] as number;
        if (weight <= 0) continue;
        // The name field is the normalized label; the other fields follow it in row order.
        const value = fieldIndex === 0 ? label && normalize(label) : row[ROW.shortcode + fieldIndex - 1];
        if (!value) continue;
        for (const phrase of (value as string).split("|")) {
          if (!phrase) continue;
          const existing = seen.get(phrase);
          if (existing !== undefined) {
            phraseLocaleMask[existing] = (phraseLocaleMask[existing] as number) | packBit;
            continue;
          }
          seen.set(phrase, phraseText.length);
          phraseEmojiList.push(emojiIndex);
          phraseField.push(fieldIndex);
          phraseLocaleMask.push(packBit);
          phraseFieldWeightList.push(weight);
          phraseText.push(phrase);
          // Most phrases are one word: the phrase is its own token (and its hash is cached).
          if (phrase.includes(" ")) tokenize(phrase).forEach(addToken);
          else addToken(phrase);
          phraseTokenEnd.push(firstSeenTokenIds.length);
        }
      }
    }
  });

  // Pass 2: sorted vocabulary (enables prefix search by binary search) + postings. Token ids
  // become positions in the sorted vocabulary.
  const vocab = [...tokenId.keys()].sort();
  const sortedId = new Int32Array(vocab.length);
  vocab.forEach((token, id) => {
    sortedId[tokenId.get(token) as number] = id;
    tokenId.set(token, id);
  });
  const phraseTokenIds = new Int32Array(firstSeenTokenIds.length);
  const postingStart = new Int32Array(vocab.length + 1);
  for (let k = 0; k < phraseTokenIds.length; k++) {
    const id = sortedId[firstSeenTokenIds[k] as number] as number;
    phraseTokenIds[k] = id;
    postingStart[id + 1] = (postingStart[id + 1] as number) + 1;
  }
  for (let i = 1; i < postingStart.length; i++) {
    postingStart[i] = (postingStart[i] as number) + (postingStart[i - 1] as number);
  }
  const postings = new Int32Array(postingStart[vocab.length] as number);
  const fill = postingStart.slice(0, vocab.length);
  const phraseLength = new Int32Array(phraseText.length);
  for (let phrase = 0, k = 0; phrase < phraseText.length; phrase++) {
    const end = phraseTokenEnd[phrase] as number;
    phraseLength[phrase] = end - k;
    for (; k < end; k++) {
      const id = phraseTokenIds[k] as number;
      postings[fill[id] as number] = phrase;
      fill[id] = (fill[id] as number) + 1;
    }
  }

  // IDF over emoji (not phrases), so a token repeated across one emoji's aliases stays specific.
  const idf = new Float64Array(vocab.length);
  const lastSeen = new Int32Array(entries.length).fill(-1);
  let maxIdf = 0;
  for (let t = 0; t < vocab.length; t++) {
    let df = 0;
    for (let k = postingStart[t] as number; k < (postingStart[t + 1] as number); k++) {
      const e = phraseEmojiList[postings[k] as number] as number;
      if (lastSeen[e] !== t) {
        lastSeen[e] = t;
        df++;
      }
    }
    idf[t] = Math.log(1 + entries.length / df);
    if ((idf[t] as number) > maxIdf) maxIdf = idf[t] as number;
  }

  const tokensByLength = new Map<number, number[]>();
  vocab.forEach((token, id) => {
    const bucket = tokensByLength.get(token.length);
    if (bucket) bucket.push(id);
    else tokensByLength.set(token.length, [id]);
  });

  return {
    phraseText,
    phraseEmoji: Int32Array.from(phraseEmojiList),
    phraseField: Uint8Array.from(phraseField),
    phraseLocaleMask: Uint32Array.from(phraseLocaleMask),
    phraseLength,
    phraseFieldWeight: Float64Array.from(phraseFieldWeightList),
    vocab,
    tokenId,
    postingStart,
    postings,
    idf,
    maxIdf,
    tokensByLength,
  };
}

/**
 * Build an in-memory Tier 0 index from one or more packs (same emoji set, different locales).
 * Custom packs (`part: "custom"`) add their own rows; their phrases count for every locale.
 */
export function createEngine(input: Pack | Pack[], options: EngineOptions = {}): AliasEngine {
  const minCoverage = options.minCoverage ?? MIN_COVERAGE;
  const packs = Array.isArray(input) ? input : [input];
  if (packs.length === 0) throw new Error("emojisense: createEngine needs at least one pack");
  for (const pack of packs) assertPack(pack);
  const primary = packs.find((p) => !isCustomPack(p)) ?? (packs[0] as Pack);
  const locales = [...new Set(packs.filter((p) => !isCustomPack(p)).map((p) => p.locale))];
  // Core and extension packs of one locale count as one locale for the preference factor.
  const preferredMasks = new Map<string, number>();
  let customMask = 0;
  packs.forEach((p, i) => {
    if (isCustomPack(p)) customMask |= 1 << i;
    else preferredMasks.set(p.locale, (preferredMasks.get(p.locale) ?? 0) | (1 << i));
  });

  const entries: EmojiEntry[] = [];
  const indexById = new Map<string, number>();
  for (const pack of [primary, ...packs.filter((p) => p !== primary && isCustomPack(p))]) {
    for (const row of pack.emoji) {
      if (indexById.has(row[ROW.hexcode])) continue;
      indexById.set(row[ROW.hexcode], entries.length);
      entries.push(entryOf(pack, row));
    }
  }

  const {
    phraseText,
    phraseEmoji,
    phraseField,
    phraseLocaleMask,
    phraseLength,
    phraseFieldWeight,
    vocab,
    tokenId,
    postingStart,
    postings,
    idf,
    maxIdf,
    tokensByLength,
  } = indexPhrases(packs, entries, indexById);

  // Per-phrase / per-emoji scratch space, reused by every search (no allocation per keystroke:
  // common words touch thousands of phrases and per-phrase objects caused GC pauses).
  const phraseCount = phraseText.length;
  const quality = new Float32Array(phraseCount * MAX_QUERY_TOKENS);
  const phraseStamp = new Uint32Array(phraseCount);
  const touchedPhrases = new Int32Array(phraseCount);
  const emojiStamp = new Uint32Array(entries.length);
  const emojiScore = new Float64Array(entries.length);
  const emojiPhrase = new Int32Array(entries.length);
  /** Matching phrases from preferred-locale packs, the best phrase included. */
  const emojiPreferred = new Int32Array(entries.length);
  const touchedEmoji = new Int32Array(entries.length);
  let generation = 0;

  function lowerBound(prefix: string): number {
    let lo = 0;
    let hi = vocab.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((vocab[mid] as string) < prefix) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Vocabulary tokens a query token may stand for, with a match quality in (0, 1]. */
  function expand(token: string, asPrefix: boolean): Map<number, number> {
    const candidates = new Map<number, number>();
    const add = (id: number, quality: number) => {
      if (quality > (candidates.get(id) ?? 0)) candidates.set(id, quality);
    };
    const exact = tokenId.get(token);
    if (exact !== undefined) add(exact, 1);

    let prefixMatches = 0;
    if (asPrefix) {
      const start = lowerBound(token);
      for (let i = start; i < vocab.length && i < start + MAX_PREFIX_EXPANSION; i++) {
        const candidate = vocab[i] as string;
        if (!candidate.startsWith(token)) break;
        if (candidate.length > token.length) {
          add(i, 0.6 + (0.35 * token.length) / candidate.length);
          prefixMatches++;
        }
      }
    }

    // While a word is still being typed and it already completes to real words, it is not a typo.
    if (exact === undefined && prefixMatches === 0) {
      // "upp" → "up", "happpy" → "happy": a repeated final letter is the most common slip.
      const squeezed = token.replace(/(.)\1+$/, "$1");
      const squeezedId = squeezed !== token ? tokenId.get(squeezed) : undefined;
      if (squeezedId !== undefined) add(squeezedId, 0.85);

      const maxEdits = maxEditsFor(token.length);
      for (let length = token.length - maxEdits; length <= token.length + maxEdits; length++) {
        for (const id of tokensByLength.get(length) ?? []) {
          if (!plausibleTypo(token, vocab[id] as string)) continue;
          const distance = boundedEditDistance(token, vocab[id] as string, maxEdits);
          if (distance <= maxEdits) add(id, distance === 1 ? 0.8 : 0.65);
        }
      }
    }
    return candidates;
  }

  /** Does a longer vocabulary token start with `prefix`? */
  function completes(prefix: string): boolean {
    return vocab[lowerBound(prefix)]?.startsWith(prefix) ?? false;
  }

  /**
   * Split a run of an unspaced script into vocabulary tokens, longest match first from the left.
   * Characters where no vocabulary token starts stay together as one unknown piece.
   */
  function segment(run: string): string[] {
    const chars = Array.from(run);
    const pieces: string[] = [];
    let unknown = "";
    let i = 0;
    while (i < chars.length) {
      let length = Math.min(MAX_PIECE_LENGTH, chars.length - i);
      while (length > 0 && !tokenId.has(chars.slice(i, i + length).join(""))) length--;
      if (length === 0) {
        unknown += chars[i];
        i++;
        continue;
      }
      if (unknown) pieces.push(unknown);
      unknown = "";
      pieces.push(chars.slice(i, i + length).join(""));
      i += length;
    }
    if (unknown) pieces.push(unknown);
    return pieces;
  }

  /**
   * Query tokens. A token of an unspaced script that is not in the vocabulary (and, while typing,
   * is not the start of one) is split into the vocabulary tokens it contains.
   */
  function queryTokens(normalized: string, lastIsPrefix: boolean): string[] {
    const tokens = tokenize(normalized).slice(0, MAX_QUERY_TOKENS);
    return tokens
      .flatMap((token, i) => {
        if (tokenId.has(token) || !UNSPACED_SCRIPT.test(token)) return [token];
        if (lastIsPrefix && i === tokens.length - 1 && completes(token)) return [token];
        return segment(token);
      })
      .slice(0, MAX_QUERY_TOKENS);
  }

  function search(query: string, options: AliasSearchOptions = {}): CanonicalSearchOutput {
    const { limit = 24, locale, prefix = true } = options;
    const normalized = normalize(query);
    const lastIsPrefix = prefix && !/\s$/.test(query);
    const tokens = queryTokens(normalized, lastIsPrefix);
    if (tokens.length === 0) return { query: normalized, tokens, results: [], confidence: 0 };

    const preferredMask = (preferredMasks.get(locale ?? primary.locale) ?? 1) | customMask;
    const isPreferred = (phrase: number) => ((phraseLocaleMask[phrase] as number) & preferredMask) !== 0;
    const n = tokens.length;
    const weights: number[] = [];
    generation++;
    let touchedPhraseCount = 0;

    tokens.forEach((token, i) => {
      const candidates = expand(token, lastIsPrefix && i === n - 1);
      let bestQuality = 0;
      let weight = maxIdf;
      for (const [id, q] of candidates) {
        if (q > bestQuality) {
          bestQuality = q;
          weight = idf[id] as number;
        }
        for (let k = postingStart[id] as number; k < (postingStart[id + 1] as number); k++) {
          const phrase = postings[k] as number;
          const base = phrase * MAX_QUERY_TOKENS;
          if (phraseStamp[phrase] !== generation) {
            phraseStamp[phrase] = generation;
            quality.fill(0, base, base + n);
            touchedPhrases[touchedPhraseCount++] = phrase;
          }
          if (q > (quality[base + i] as number)) quality[base + i] = q;
        }
      }
      weights.push(STOPWORDS.has(token) ? Math.min(weight, STOPWORD_WEIGHT_CAP) : weight);
    });
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let touchedEmojiCount = 0;
    for (let t = 0; t < touchedPhraseCount; t++) {
      const phrase = touchedPhrases[t] as number;
      const base = phrase * MAX_QUERY_TOKENS;
      let covered = 0;
      let matched = 0;
      let allExact = true;
      for (let i = 0; i < n; i++) {
        const q = quality[base + i] as number;
        if (q > 0) matched++;
        if (q !== 1) allExact = false;
        covered += q * (weights[i] as number);
      }
      const coverage = covered / totalWeight;
      if (coverage < minCoverage) continue;

      const length = phraseLength[phrase] as number;
      const preferred = isPreferred(phrase);
      const score =
        (phraseFieldWeight[phrase] as number) *
        coverage *
        (0.6 + 0.4 * Math.min(1, matched / length)) *
        (allExact && length === n ? (n >= 2 ? EXACT_PHRASE_BONUS : 1) : NON_EXACT_FACTOR) *
        (preferred ? 1 : FOREIGN_LOCALE_FACTOR);

      const emoji = phraseEmoji[phrase] as number;
      if (emojiStamp[emoji] !== generation) {
        emojiStamp[emoji] = generation;
        emojiScore[emoji] = score;
        emojiPhrase[emoji] = phrase;
        emojiPreferred[emoji] = 0;
        touchedEmoji[touchedEmojiCount++] = emoji;
      } else if (score > (emojiScore[emoji] as number)) {
        emojiScore[emoji] = score;
        emojiPhrase[emoji] = phrase;
      }
      if (preferred) emojiPreferred[emoji] = (emojiPreferred[emoji] as number) + 1;
    }

    // Only phrases of the preferred locale add evidence: with many locales loaded, other
    // languages would otherwise lift every emoji that shares a loanword to the bonus cap.
    const support = (emoji: number) =>
      (emojiPreferred[emoji] as number) - (isPreferred(emojiPhrase[emoji] as number) ? 1 : 0);
    const ranked = Array.from(touchedEmoji.subarray(0, touchedEmojiCount), (emoji) => ({
      emoji,
      phrase: emojiPhrase[emoji] as number,
      score: Math.min(
        1,
        (emojiScore[emoji] as number) + Math.min(MAX_EVIDENCE_BONUS, support(emoji) * EVIDENCE_BONUS),
      ),
    }))
      .sort((a, b) => b.score - a.score || a.emoji - b.emoji)
      .slice(0, limit);

    const results: AliasResult[] = ranked.map(({ emoji, phrase, score }) => {
      const entry = entries[emoji] as EmojiEntry;
      const { imageUrl, shortcode } = entry;
      return {
        emoji: entry.emoji,
        id: entry.id,
        score: Math.round(score * 1000) / 1000,
        source: shortcode === undefined ? "alias" : "custom",
        label: entry.labels[locale ?? ""] ?? entry.labels[primary.locale] ?? shortcode ?? "",
        match: phraseText[phrase] as string,
        field: FIELDS[phraseField[phrase] as number] as Field,
        ...(imageUrl ? { imageUrl } : {}),
        ...(shortcode ? { shortcode } : {}),
      };
    });
    return { query: normalized, tokens, results, confidence: results[0]?.score ?? 0 };
  }

  const get = (id: string) => {
    const index = indexById.get(id);
    return index === undefined ? undefined : entries[index];
  };

  function withCulture(culture: Culture | undefined): AliasEngine {
    const searchWithCulture = (query: string, options: AliasSearchOptions = {}): AliasSearchOutput => {
      const output = search(query, options);
      if (!culture || options.culture === false) return output;
      const results = applyCulture(output.results, culture, query, {
        ...options,
        engine,
        limit: options.limit ?? 24,
      });
      return { ...output, results };
    };
    const engine: AliasEngine = {
      // With `culture: false` the output is the canonical one, which the first overload promises.
      search: searchWithCulture as AliasEngine["search"],
      get,
      withCulture,
      culture,
      entries,
      locales,
      packVersion: primary.packVersion,
    };
    return engine;
  }

  return withCulture(options.culture);
}
