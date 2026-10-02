import { type AliasEngine, COMMON_REACTIONS, hexcodeOf } from "emojisense";
import { type EmojiSuggestion, labelFor, toSuggestion } from "./suggestion.js";
import { matchText, type TextMatch } from "./text.js";

/** Catalog ids of the common reactions (`COMMON_REACTIONS` in emojisense), preferred over topical emoji. */
export const REACTION_IDS: ReadonlySet<string> = new Set(COMMON_REACTIONS.map(hexcodeOf));

const REACTION_FACTOR = 1.15;
const FACE_FACTOR = 0.95;
const TOPICAL_FACTOR = 0.7;

/** Generic reactions used only to fill the list when the text gives too little signal. */
const QUESTION_DEFAULTS = ["1F440", "1F914"]; // 👀 🤔
const DEFAULTS = ["1F44D", "2764"]; // 👍 ❤️
const DEFAULT_SCORE = 0.3;

export interface ReactionOptions {
  locale?: string;
  limit?: number;
}

/** Offline reaction suggestions: text matches, re-ranked towards emoji people react with. */
export function suggestReactionsOffline(
  engine: AliasEngine,
  text: string,
  options: ReactionOptions = {},
): EmojiSuggestion[] {
  const { locale, limit = 6 } = options;
  const ranked = matchText(engine, text, { limit: 40, ...(locale ? { locale } : {}) })
    .map((match) => ({ match, score: Math.min(1, match.score * reactionFactor(engine, match)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ match, score }) => toSuggestion(engine, { ...match, score: Math.round(score * 1000) / 1000 }));

  const defaults = text.trim().endsWith("?") ? [...QUESTION_DEFAULTS, ...DEFAULTS] : DEFAULTS;
  for (const id of defaults) {
    if (ranked.length >= limit) break;
    const entry = engine.get(id);
    if (!entry || ranked.some((r) => r.id === id)) continue;
    ranked.push({
      emoji: entry.emoji,
      id,
      label: labelFor(engine, id, locale),
      score: DEFAULT_SCORE,
      source: "default",
    });
  }
  return ranked;
}

function reactionFactor(engine: AliasEngine, match: TextMatch): number {
  if (REACTION_IDS.has(match.id)) return REACTION_FACTOR;
  return engine.get(match.id)?.group === "smileys-emotion" ? FACE_FACTOR : TOPICAL_FACTOR;
}
