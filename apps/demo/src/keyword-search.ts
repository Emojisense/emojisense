import { type Pack, ROW_INDEX } from "emojisense";

export interface KeywordHit {
  emoji: string;
  id: string;
  label: string;
}

/**
 * Baseline: the label/keyword substring filter most pickers ship (this mirrors Frimousse 0.4:
 * label match +10, each keyword match +1). Same CLDR data as Emojisense, no aliases.
 */
export function keywordSearch(pack: Pack | undefined, query: string, limit = 24): KeywordHit[] {
  const q = query.toLowerCase().trim();
  if (!pack || q === "") return [];
  const scored: { hit: KeywordHit; score: number; order: number }[] = [];
  pack.emoji.forEach((row, order) => {
    const label = row[ROW_INDEX.label];
    let score = label.toLowerCase().includes(q) ? 10 : 0;
    for (const tag of row[ROW_INDEX.keyword].split("|")) if (tag?.includes(q)) score += 1;
    if (score > 0)
      scored.push({ hit: { emoji: row[ROW_INDEX.emoji], id: row[ROW_INDEX.hexcode], label }, score, order });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.hit);
}
