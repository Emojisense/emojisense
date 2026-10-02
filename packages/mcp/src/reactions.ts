import type { AliasEngine } from "emojisense";
import { type EmojiSuggestion, labelFor, toSuggestion } from "./suggestion.js";
import { matchText, type TextMatch } from "./text.js";

/**
 * Emoji that people commonly use as reactions (hand-picked from the default and most frequent
 * reactions of Slack, GitHub and Discord). They are preferred over topical emoji: a reader
 * reacts to "we shipped it" with 🎉, not with 🚢.
 */
export const REACTION_IDS: ReadonlySet<string> = new Set([
  "1F44D", // 👍
  "2764", // ❤️
  "1F602", // 😂
  "1F389", // 🎉
  "1F64C", // 🙌
  "1F525", // 🔥
  "1F440", // 👀
  "1F64F", // 🙏
  "1F4AF", // 💯
  "2705", // ✅
  "1F44F", // 👏
  "1F680", // 🚀
  "1F622", // 😢
  "1F62D", // 😭
  "1F914", // 🤔
  "1F62E", // 😮
  "1F60D", // 😍
  "1F973", // 🥳
  "1FAF6", // 🫶
  "1F4AA", // 💪
  "1FAE1", // 🫡
  "1F91D", // 🤝
  "2728", // ✨
  "1F923", // 🤣
  "1F605", // 😅
  "1F60A", // 😊
  "1F62C", // 😬
  "1F631", // 😱
  "1F92F", // 🤯
  "1F972", // 🥲
  "1FAE0", // 🫠
  "1F917", // 🤗
  "2B50", // ⭐
  "1F480", // 💀
  "1F606", // 😆
  "1FAC2", // 🫂
  "1F54A", // 🕊️
  "1F494", // 💔
  "1F614", // 😔
  "1F37E", // 🍾
  "1F942", // 🥂
  "1F3C6", // 🏆
  "1F44C", // 👌
  "1F648", // 🙈
  "1F60E", // 😎
  "1F929", // 🤩
  "1F97A", // 🥺
  "1F926", // 🤦
]);

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
