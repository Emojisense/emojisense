import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const BUILD_DIR = join(DATA_ROOT, "build");
export const CACHE_DIR = join(DATA_ROOT, ".cache");
export const ENRICHMENT_DIR = join(DATA_ROOT, "enrichment");
export const BASE_FILE = join(BUILD_DIR, "emoji.base.json");
