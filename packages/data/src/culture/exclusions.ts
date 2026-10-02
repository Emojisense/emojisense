import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "emojisense";
import { moderate } from "../blocklist.ts";
import { CULTURE_DIR } from "../paths.ts";

export interface Exclusion {
  phrase: string;
  category: string;
}

/** Scripts written without spaces: a phrase matches anywhere, not only as whole words. */
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** Parse culture/exclusions.txt: `[category]` headers, one phrase per line, `#` comments. */
export function parseExclusions(text: string): Exclusion[] {
  let category = "general";
  const exclusions: Exclusion[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      category = header[1] as string;
      continue;
    }
    const phrase = normalize(line);
    if (phrase) exclusions.push({ phrase, category });
  }
  return exclusions;
}

export function loadExclusions(path = join(CULTURE_DIR, "exclusions.txt")): Exclusion[] {
  return parseExclusions(readFileSync(path, "utf8"));
}

/**
 * The first exclusion a text hits, or the alias blocklist's verdict (slurs, sexual terms).
 * Returns `undefined` when the text is clean.
 */
export function findExcluded(
  text: string,
  exclusions: readonly Exclusion[],
  locale = "en",
): string | undefined {
  const normalized = normalize(text, 1000);
  if (normalized === "") return undefined;
  const padded = ` ${normalized} `;
  for (const { phrase, category } of exclusions) {
    const hit = NO_SPACES.test(phrase) ? normalized.includes(phrase) : padded.includes(` ${phrase} `);
    if (hit) return `"${phrase}" (${category})`;
  }
  return moderate(normalized, locale) === "block" ? "a blocked word (blocklist)" : undefined;
}
