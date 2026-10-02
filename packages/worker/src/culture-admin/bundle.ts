import {
  type DatedSource,
  type GateQuery,
  parseExclusions,
  type SlangSource,
  type SourceFile,
  splitPrompt,
  splitSources,
} from "@emojisense/data/culture-core";
import type { AliasEngine, PackRow } from "emojisense";
import type { Env } from "../env.ts";
import type { CultureRuntime } from "./runtime.ts";

export interface CultureBundle {
  packVersion: string;
  /** Rows of the bundled English pack: `[emoji, hexcode, …]`. It holds every base emoji. */
  packRows: readonly PackRow[];
  /** packages/data/culture/exclusions.txt */
  exclusions: string;
  /** packages/data/culture/prompts/propose.<version>.md */
  prompt: string;
  /** packages/eval/queries/queries.jsonl (the in-house suite; never the held-out one). */
  gateQueries: string;
  /** packages/data/culture/sources/*.json */
  sources: readonly SourceFile<DatedSource | SlangSource>[];
  engine(locale: string, env: Env): Promise<AliasEngine | undefined>;
}

/** One `{"id","q","locale",…}` object per line. */
export function parseGateQueries(jsonl: string): GateQuery[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const { id, q, locale } = JSON.parse(line) as GateQuery;
      return { id, q, locale };
    });
}

/** The culture runtime from the files the Worker bundles (index.ts) or a test passes. */
export function createCultureRuntime(bundle: CultureBundle): CultureRuntime {
  return {
    packVersion: bundle.packVersion,
    catalog: new Map(bundle.packRows.map((row) => [row[1], row[0]])),
    exclusions: parseExclusions(bundle.exclusions),
    gateQueries: parseGateQueries(bundle.gateQueries),
    prompt: splitPrompt(bundle.prompt),
    sources: splitSources(bundle.sources).dated,
    engine: bundle.engine,
  };
}
