import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CULTURE_DIR } from "../paths.ts";
import { type Exclusion, parseExclusions } from "./policy.ts";

export { type Exclusion, findExcluded, parseExclusions } from "./policy.ts";

export function loadExclusions(path = join(CULTURE_DIR, "exclusions.txt")): Exclusion[] {
  return parseExclusions(readFileSync(path, "utf8"));
}
