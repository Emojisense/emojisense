/**
 * Culture eval gate (PULSE.md) over the built pack files. The checks live in
 * `@emojisense/data/culture-core` (`runCultureGateWith`), which the API Worker also runs before it
 * stores an AI proposal or publishes approved live entries.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CultureRecord } from "@emojisense/data/culture";
import { type CultureGateResult, runCultureGateWith } from "@emojisense/data/culture-core";
import { createEngine, type Pack } from "emojisense";
import type { EvalQuery } from "./queries.ts";

export {
  type CultureGateResult,
  type RegionalIssue,
  type TopChange,
  TRIGGER_TOP_N,
  type TriggerMiss,
} from "@emojisense/data/culture-core";

export interface CultureGateInput {
  /** Directory with pack.<locale>.json and pack.<locale>.ext.json. */
  packDir: string;
  packVersion: string;
  records: readonly CultureRecord[];
  catalog: ReadonlyMap<string, string>;
  /** Queries whose changes are reported in full (the in-house suite). */
  queries: readonly EvalQuery[];
  /** Queries whose changes are only counted (the held-out suite: its text never leaves the run). */
  hiddenQueries?: readonly EvalQuery[];
}

export function runCultureGate(input: CultureGateInput): CultureGateResult {
  const { packDir } = input;
  const readPack = (name: string): Pack =>
    JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
  return runCultureGateWith({
    ...input,
    baseFor: (locale) => {
      const names = locale === "en" ? ["en", "en.ext"] : ["en", locale, "en.ext", `${locale}.ext`];
      return createEngine(names.filter((n) => existsSync(join(packDir, `pack.${n}.json`))).map(readPack));
    },
  });
}
