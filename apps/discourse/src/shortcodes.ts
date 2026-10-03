import type { EmojiSuggestion } from "emojisense/autocomplete";

/** What the theme reads from Discourse's emoji data (`pretty-text/emoji`, `pretty-text/emoji/data`). */
export interface DiscourseEmojiData {
  /** Unicode emoji → Discourse name, e.g. "🚀" → "rocket", "👍🏽" → "+1:t4". */
  replacements: Readonly<Record<string, string>>;
  /** Whether a Discourse name takes a skin tone (`:wave:t3:`). */
  isSkinTonable: (code: string) => boolean;
}

export interface CodeOptions {
  data: DiscourseEmojiData;
  /** The user's skin tone, 1 (none) to 6. The emoji picker applies it itself: pass 1 there. */
  diversity?: number;
  /** `site.denied_emojis`. */
  denied?: readonly string[];
  limit?: number;
}

const VARIATION_SELECTOR = /️/g;

/**
 * Emojisense suggestions as Discourse emoji names, in rank order: a custom emoji by its name, a
 * standard emoji by Discourse's own name for it. Emoji that Discourse does not know (newer than
 * its data) and denied emoji are left out.
 */
export function toDiscourseCodes(suggestions: readonly EmojiSuggestion[], options: CodeOptions): string[] {
  const { data, diversity = 1, denied = [], limit = Number.POSITIVE_INFINITY } = options;
  const codes: string[] = [];
  for (const suggestion of suggestions) {
    const name =
      suggestion.source === "custom"
        ? suggestion.shortcode
        : (data.replacements[suggestion.emoji] ??
          data.replacements[suggestion.emoji.replace(VARIATION_SELECTOR, "")]);
    if (!name || denied.includes(name)) continue;
    const code = diversity > 1 && data.isSkinTonable(name) ? `${name}:t${diversity}` : name;
    if (!codes.includes(code)) codes.push(code);
    if (codes.length >= limit) break;
  }
  return codes;
}

/** Ours first, then Discourse's own matches that ours do not have, up to `limit`. */
export function mergeCodes(ours: readonly string[], theirs: readonly string[], limit: number): string[] {
  const merged = [...ours];
  for (const code of theirs) {
    if (merged.length >= limit) break;
    if (!merged.includes(code)) merged.push(code);
  }
  return merged.slice(0, limit);
}
