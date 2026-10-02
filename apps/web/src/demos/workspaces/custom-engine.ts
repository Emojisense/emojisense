/**
 * Custom emoji search with the real engine: each workspace's set becomes one small in-memory pack
 * (the standard pack format, docs/PACK_FORMAT.md), indexed by `createEngine` like any other pack.
 * So custom emoji get the same normalization, prefix matching and typo tolerance as the standard set.
 */
import {
  type AliasEngine,
  createEngine,
  normalize,
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
  type Pack,
  type PackRow,
  type SearchResult,
} from "emojisense";
import { customEmojiSrc, type Workspace } from "./data";

export interface CustomResult extends SearchResult {
  source: "custom";
  name: string;
  src: string;
  /** The phrase that matched, for the picker footer. */
  match: string;
}

function phrases(values: string[]): string {
  return [...new Set(values.map((value) => normalize(value)).filter(Boolean))].join("|");
}

export function customPack(workspace: Workspace): Pack {
  return {
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    packVersion: `custom-${workspace.tenant}`,
    locale: "en",
    emojiVersion: "custom",
    groups: ["custom"],
    emoji: workspace.emoji.map(
      (item): PackRow => [
        `:${item.name}:`,
        `${workspace.id}/${item.name}`,
        0,
        0,
        0,
        item.name,
        phrases([item.name.replaceAll("-", "")]),
        "",
        phrases(item.aliases),
        "",
        "",
      ],
    ),
  };
}

const engines = new Map<Workspace["id"], AliasEngine>();

function engineFor(workspace: Workspace): AliasEngine {
  let engine = engines.get(workspace.id);
  if (!engine) {
    engine = createEngine(customPack(workspace));
    engines.set(workspace.id, engine);
  }
  return engine;
}

export function searchCustom(workspace: Workspace, query: string, limit = 8): CustomResult[] {
  const byName = new Map(workspace.emoji.map((item) => [`${workspace.id}/${item.name}`, item.name]));
  return engineFor(workspace)
    .search(query, { limit })
    .results.map((result) => {
      const name = byName.get(result.id) ?? result.id;
      return {
        emoji: result.emoji,
        id: result.id,
        score: result.score,
        source: "custom",
        name,
        src: customEmojiSrc(workspace, name),
        match: result.match,
      };
    });
}
