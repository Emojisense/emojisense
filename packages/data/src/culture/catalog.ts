import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE_FILE } from "../paths.ts";
import type { BaseEmoji } from "../types.ts";

const COMPONENT_GROUP = 2;

/**
 * The emoji catalog as hexcode → emoji: the ingested base file when it exists, else the same
 * selection straight from Emojibase (ingest.ts), so validation runs before the data build.
 */
export function loadCatalog(): Map<string, string> {
  if (existsSync(BASE_FILE)) {
    const { emoji }: { emoji: BaseEmoji[] } = JSON.parse(readFileSync(BASE_FILE, "utf8"));
    return new Map(emoji.map((e) => [e.hexcode, e.emoji]));
  }
  const require = createRequire(import.meta.url);
  const data: { hexcode: string; emoji: string; group?: number }[] = require("emojibase-data/en/data.json");
  return new Map(
    data.filter((e) => e.group !== undefined && e.group !== COMPONENT_GROUP).map((e) => [e.hexcode, e.emoji]),
  );
}
