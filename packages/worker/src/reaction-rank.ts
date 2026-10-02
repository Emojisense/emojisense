import {
  type AliasEngine,
  COMMON_REACTIONS,
  normalize,
  type SearchResult,
  searchVectors,
  type VectorIndex,
} from "emojisense";
import { resolveEmoji } from "./emoji-lookup.ts";
import { fuseLists, type WeightedList } from "./fusion.ts";
import { detectIntents, INTENTS } from "./reaction-intents.ts";

/** Reactions for the intents and moods of chat messages (reaction-intents.ts), after the common ones. */
const INTENT_VOCABULARY = "😩 😫 😤 🙄 😴 🥱 ☕ 🎂 🎈 🎁 🤞 🍀 👋 🥰 🚨 🥹 💕 🤍 😞 🎊 😡 🙃 🆘 😋 🙋";
/** Common reactions the ranking leaves out: the weights and thresholds below were tuned without them. */
const LEFT_OUT = new Set(["🕊️"]);

/**
 * Emoji people react with: the common reactions shared with the MCP server (`COMMON_REACTIONS`
 * in emojisense) plus the reactions of the intents. The message embedding ranks these, so
 * "smoke tests are failing" leans to 😩, not to 🚬.
 */
export const REACTION_VOCABULARY = [
  ...COMMON_REACTIONS.filter((emoji) => !LEFT_OUT.has(emoji)),
  INTENT_VOCABULARY,
].join(" ");

/** How much each kind of evidence counts (DECISIONS.md, "Reaction ranking"). */
export const REACTION_WEIGHTS = {
  /** An emoji the writer used ("shipped it 🎉") is the reaction most people pick. */
  textEmoji: 1,
  /** A cue such as "thanks", "tebrikler" or "jajaja" (reaction-intents.ts). */
  intent: 1,
  /** Reaction vocabulary ranked by the message embedding: the language-agnostic intent prior. */
  prior: 0.5,
  /** Alias hits for the message and its clauses, scaled by match quality ("happy birthday" → 🎂). */
  alias: 0.6,
  /** Nearest emoji of the whole catalog: good recall, but literal nouns ("smoke" → 🚬). */
  neighbours: 0.3,
  /** …counted again when the match is close (≥ CLOSE_NEIGHBOUR): "pizza for lunch?" → 🍕. */
  closeNeighbours: 0.5,
} as const;

const RRF_K = 8;
/**
 * Topical emoji (not in the vocabulary) need this much evidence: a neighbour alone (≤ 0.3) or a
 * partial alias hit never shows, so "smoke tests" cannot surface 🚬 on the embedding alone.
 */
export const REACTION_FLOOR = 0.35;
const SCORE_SCALE = 2;
const PRIOR_SIZE = 8;
const NEIGHBOURS = 8;
/**
 * bge-m3 cosine of a close match. On the labelled messages the literal-noun traps sit at
 * 0.50–0.52 (🚬, 📧) and clear topical reactions at ≥ 0.59 (🍕, 🌨️, 💍). Retune with the model.
 */
export const CLOSE_NEIGHBOUR = 0.58;
const CLAUSE_CANDIDATES = 6;
/** Alias hits below this share only a word or two with the message ("users" → 👥 for "10k users"). */
const MIN_ALIAS_SCORE = 0.5;
/**
 * Chat messages hold several phrases, so each clause is searched on its own. A "." inside
 * "2.14.0" is not a break. One-word clauses are skipped: alone, "US" or "14" mean a flag or a date.
 */
const CLAUSE_BREAK =
  /[.!?,;:]+(?=\s|$)|[\n()"“”`¡¿]+|(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u{FE0F}|\u{200D})+|\s(?:and|but|so)\s/gu;

export function clausesOf(text: string): string[] {
  const clauses = text
    .split(CLAUSE_BREAK)
    .map((clause) => clause.trim())
    .filter((clause) => clause.split(/\s+/).length >= 2);
  return [...new Set([text, ...clauses])];
}

/** Catalog ids of an emoji list such as "👍 ❤️ 😂", unknown ones dropped. */
const idsOf = (engine: AliasEngine, list: string) => [
  ...new Set(resolveEmoji(engine, list.replace(/ /g, ""))),
];

interface ReactionTables {
  vocabulary: string[];
  vocabularySet: ReadonlySet<string>;
  intentReactions: Map<string, string[]>;
}
const tables = new WeakMap<AliasEngine, ReactionTables>();
const rowMaps = new WeakMap<VectorIndex, Map<string, number>>();

/** Built once per engine (isolate), like the engine itself. */
function tablesFor(engine: AliasEngine): ReactionTables {
  let entry = tables.get(engine);
  if (!entry) {
    const vocabulary = idsOf(engine, REACTION_VOCABULARY);
    entry = {
      vocabulary,
      vocabularySet: new Set(vocabulary),
      intentReactions: new Map(INTENTS.map((intent) => [intent.name, idsOf(engine, intent.reactions)])),
    };
    tables.set(engine, entry);
  }
  return entry;
}

/** The reaction vocabulary, most similar to the message first. */
function vocabularyPrior(engine: AliasEngine, index: VectorIndex, vector: Float32Array): SearchResult[] {
  let rows = rowMaps.get(index);
  if (!rows) {
    rows = new Map(index.ids.map((id, row) => [id, row]));
    rowMaps.set(index, rows);
  }
  const { data, dims } = index;
  const scored: SearchResult[] = [];
  for (const id of tablesFor(engine).vocabulary) {
    const row = rows.get(id);
    if (row === undefined) continue;
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += (data[row * dims + d] as number) * (vector[d] as number);
    scored.push({ emoji: engine.get(id)?.emoji ?? "", id, score: dot, source: "semantic" });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, PRIOR_SIZE);
}

const asResults = (engine: AliasEngine, ids: readonly string[]): SearchResult[] =>
  ids.map((id, i) => ({ emoji: engine.get(id)?.emoji ?? "", id, score: 1 / (i + 1), source: "alias" }));

export interface ReactionInput {
  text: string;
  locale: string;
  limit: number;
  /** The message embedding (L2-normalized, index dims) and the emoji vectors; absent over the limit or degraded. */
  semantic?: { index: VectorIndex; vector: Float32Array } | undefined;
  /** Overrides, for ablations. */
  weights?: Partial<Record<keyof typeof REACTION_WEIGHTS, number>>;
}

export interface RankedReactions {
  results: SearchResult[];
  /** Best alias score over the message and its clauses (analytics). */
  aliasConfidence: number;
  /** Best similarity in the whole catalog (analytics); undefined without a vector. */
  semanticTop?: number | undefined;
}

/**
 * Reactions for a chat message. Fuses the emoji in the text, intent cues, the reaction
 * vocabulary ranked by the message embedding, alias hits per clause and the nearest emoji of the
 * catalog; literal nouns need two sources to show, reaction emoji one.
 */
export function rankReactions(engine: AliasEngine, input: ReactionInput): RankedReactions {
  const weights = { ...REACTION_WEIGHTS, ...input.weights };
  const { intentReactions, vocabularySet } = tablesFor(engine);
  const lists: WeightedList[] = [];
  const add = (results: readonly SearchResult[], weight: number, byScore = false) => {
    if (results.length > 0 && weight > 0) lists.push({ results, weight, byScore });
  };

  add(asResults(engine, [...new Set(resolveEmoji(engine, input.text))]), weights.textEmoji);
  for (const intent of detectIntents(normalize(input.text, 256))) {
    add(asResults(engine, intentReactions.get(intent.name) ?? []), weights.intent);
  }
  let aliasConfidence = 0;
  for (const clause of clausesOf(input.text)) {
    const found = engine.search(clause, { locale: input.locale, limit: CLAUSE_CANDIDATES, prefix: false });
    aliasConfidence = Math.max(aliasConfidence, found.confidence);
    add(
      found.results.filter((r) => r.score >= MIN_ALIAS_SCORE),
      weights.alias,
      true,
    );
  }
  let semanticTop: number | undefined;
  if (input.semantic) {
    const { index, vector } = input.semantic;
    add(vocabularyPrior(engine, index, vector), weights.prior);
    const neighbours = searchVectors(index, vector, NEIGHBOURS).map(
      (m): SearchResult => ({
        emoji: engine.get(m.id)?.emoji ?? "",
        id: m.id,
        score: m.score,
        source: "semantic",
      }),
    );
    semanticTop = neighbours[0] ? Math.round(neighbours[0].score * 1000) / 1000 : undefined;
    add(neighbours, weights.neighbours);
    add(
      neighbours.filter((n) => n.score >= CLOSE_NEIGHBOUR),
      weights.closeNeighbours,
    );
  }
  const results = fuseLists(lists, {
    k: RRF_K,
    limit: input.limit,
    floor: REACTION_FLOOR,
    scale: SCORE_SCALE,
    // Reaction emoji are never literal-noun traps, so they may fill the list below the floor.
    exempt: vocabularySet,
  });
  return { results, aliasConfidence, semanticTop };
}
