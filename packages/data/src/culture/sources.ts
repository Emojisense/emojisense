/**
 * Proposal sources (culture/sources/*.json): what culture:propose drafts entries from.
 *   calendar.json  holidays and festivals per region and locale (fixed, computed or listed dates)
 *   events.json    big sports and cultural events, with neutral titles
 *   slang.json     meaning shifts: what people mean by an emoji now
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CULTURE_DIR } from "../paths.ts";
import { type DatedSource, type SlangSource, type SourceFile, splitSources } from "./occurrences.ts";

export {
  type DatedCandidate,
  type DatedSource,
  datedCandidates,
  type Occurrence,
  occurrencesBetween,
  type SlangSource,
  type SourceFile,
  splitSources,
} from "./occurrences.ts";

export const SOURCES_DIR = join(CULTURE_DIR, "sources");

export function loadSources(dir = SOURCES_DIR): { dated: DatedSource[]; slang: SlangSource[] } {
  if (!existsSync(dir)) return { dated: [], slang: [] };
  const files = readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map(
      (name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as SourceFile<DatedSource | SlangSource>,
    );
  return splitSources(files);
}
