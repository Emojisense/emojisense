/**
 * Step 1 of the data pipeline: Emojibase (en) + CLDR (tr) → build/emoji.base.json.
 *
 * Only base emoji are kept. Skin-tone variants are recorded on the base entry
 * (`skins`) so search can map any variant back to its base. Regional indicators
 * and components (skin-tone / hair modifiers) are dropped: nobody searches for them.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE_FILE, BUILD_DIR } from "./paths.ts";
import type { BaseEmoji } from "./types.ts";

const require = createRequire(import.meta.url);

interface EmojibaseEntry {
  label: string;
  hexcode: string;
  emoji: string;
  tags?: string[];
  group?: number;
  subgroup?: number;
  order?: number;
  version: number;
  skins?: { hexcode: string; emoji: string }[];
}
interface Messages {
  groups: { key: string; order: number }[];
  subgroups: { key: string; order: number }[];
}
type CldrAnnotations = Record<string, { default?: string[]; tts?: string[] }>;

const COMPONENT_GROUP = 2;

const data: EmojibaseEntry[] = require("emojibase-data/en/data.json");
const messages: Messages = require("emojibase-data/en/messages.json");
const shortcodeSets: Record<string, string | string[]>[] = [
  require("emojibase-data/en/shortcodes/emojibase.json"),
  require("emojibase-data/en/shortcodes/github.json"),
  require("emojibase-data/en/shortcodes/iamcal.json"),
];
const trAnnotations: CldrAnnotations = {
  ...require("cldr-annotations-derived-full/annotationsDerived/tr/annotations.json").annotationsDerived
    .annotations,
  ...require("cldr-annotations-full/annotations/tr/annotations.json").annotations.annotations,
};
const emojibaseVersion: string = require("emojibase-data/package.json").version;
const cldrVersion: string = require("cldr-annotations-full/package.json").version;

const groupKey = new Map(messages.groups.map((g) => [g.order, g.key]));
const subgroupKey = new Map(messages.subgroups.map((g) => [g.order, g.key]));

function lookupTr(emoji: string) {
  const bare = emoji.replace(/️/g, "");
  return trAnnotations[emoji] ?? trAnnotations[bare] ?? trAnnotations[`${bare}️`];
}

function collectShortcodes(hexcode: string): string[] {
  const all = shortcodeSets.flatMap((set) => {
    const value = set[hexcode];
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  });
  return [...new Set(all)];
}

const emoji: BaseEmoji[] = data
  .filter((e) => e.group !== undefined && e.group !== COMPONENT_GROUP)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map((e) => {
    const tr = lookupTr(e.emoji);
    return {
      hexcode: e.hexcode,
      emoji: e.emoji,
      label: e.label,
      tags: e.tags ?? [],
      shortcodes: collectShortcodes(e.hexcode),
      group: groupKey.get(e.group as number) ?? "unknown",
      subgroup: subgroupKey.get(e.subgroup as number) ?? "unknown",
      order: e.order ?? 0,
      version: e.version,
      skins: (e.skins ?? []).map((s) => s.hexcode),
      tr: {
        label: tr?.tts?.[0] ?? null,
        tags: tr?.default ?? [],
      },
    };
  });

mkdirSync(BUILD_DIR, { recursive: true });
writeFileSync(
  BASE_FILE,
  `${JSON.stringify({ source: { emojibaseVersion, cldrVersion }, emoji }, null, 1)}\n`,
);

const missingTr = emoji.filter((e) => e.tr.label === null).length;
console.log(
  `ingest: ${emoji.length} base emoji (emojibase-data ${emojibaseVersion}, CLDR ${cldrVersion}); ` +
    `${missingTr} without a Turkish CLDR label → ${BASE_FILE}`,
);
