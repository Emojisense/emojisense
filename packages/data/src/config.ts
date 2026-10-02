import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_ROOT } from "./paths.ts";

export interface PackConfig {
  packVersion: string;
  emojiVersion: string;
  initialAliases: number;
  /** The production semantic model (Worker, shards, cost). Key from models.ts. */
  model: { key: string; dims: number };
}

export function readPackConfig(): PackConfig {
  return JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8")) as PackConfig;
}
