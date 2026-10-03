/**
 * Facts the docs state, computed at build time from the real engine and the real packs, so
 * every "you type X, you get Y" in a code comment is true for the shipped data. API responses
 * come from fixtures.json (captured from the real Worker; see its $comment).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AliasEngine, createEngine, type Pack, shouldUseSemantic } from "emojisense";
import { PACK_VERSION } from "../../config";
import fixtures from "./fixtures.json";

/** The public API host used in examples. Self-hosters replace it with their Worker URL. */
export const API_HOST = "https://api.emojisense.com";
export const PACK_URL = `${API_HOST}/v1/pack/${PACK_VERSION}`;
/** Shards come straight from the CDN; the API host serves the same files at /p/. */
export const SHARDS_URL = `https://cdn.emojisense.com/p/${PACK_VERSION}`;
export { PACK_VERSION };

const DATA_DIR = join(process.cwd(), "../../packages/data");
const PACK_DIR = join(DATA_DIR, "dist/packs", PACK_VERSION);

/** The production semantic model: pack.config.json picks it, and scripts/deploy.sh reads it there. */
export const SEMANTIC_MODEL: { key: string; dims: number } = JSON.parse(
  readFileSync(join(DATA_DIR, "pack.config.json"), "utf8"),
).model;

interface ManifestFile {
  bytes: number;
  gzipBytes: number;
  locale?: string;
}

interface Manifest {
  packVersion: string;
  emojiVersion: string;
  emojiCount: number;
  files: Record<string, ManifestFile>;
}

function readJson<T>(name: string): T | undefined {
  const path = join(PACK_DIR, name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined;
}

const manifest = readJson<Manifest>("manifest.json");

/** Locales with a core pack, English first. */
export const LOCALES: string[] = manifest
  ? Object.values(manifest.files)
      .flatMap((file) => (file.locale ? [file.locale] : []))
      .filter((locale, index, all) => all.indexOf(locale) === index)
      .sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : 0))
  : [];

function gzipKb(file: string): number | undefined {
  const bytes = manifest?.files[file]?.gzipBytes;
  return bytes === undefined ? undefined : Math.round(bytes / 1024);
}

export const PACK_FACTS = {
  emojiCount: manifest?.emojiCount,
  emojiVersion: manifest?.emojiVersion,
  languages: LOCALES.length,
  englishCoreKb: gzipKb("pack.en.json"),
  englishExtKb: gzipKb("pack.en.ext.json"),
};

const engines = new Map<string, AliasEngine | undefined>();

/**
 * The engine an example builds. `core` = what `loadPacks({ baseUrl })` gives on first render;
 * `full` = core + the idle-loaded extension packs, as `useEmojisense` has after a moment.
 */
function engineFor(locales: string[], part: "core" | "full"): AliasEngine | undefined {
  const key = `${locales.join(",")}:${part}`;
  if (!engines.has(key)) {
    const names = locales.flatMap((l) => (part === "full" ? [l, `${l}.ext`] : [l]));
    const packs = names.map((name) => readJson<Pack>(`pack.${name}.json`));
    engines.set(key, packs.every(Boolean) ? createEngine(packs as Pack[]) : undefined);
  }
  return engines.get(key);
}

export interface ExampleOptions {
  locale?: string;
  limit?: number;
  part?: "core" | "full";
  /** false = whole-query search, as the server and the MCP tools run it. */
  prefix?: boolean;
}

/** The engine's real top emoji for a query (empty when the packs are not built). */
export function topEmoji(query: string, options: ExampleOptions = {}): string[] {
  const { locale = "en", limit = 3, part = "core", prefix } = options;
  const locales = locale === "en" ? ["en"] : ["en", locale];
  const engine = engineFor(locales, part);
  const output = engine?.search(query, { locale, limit, ...(prefix === undefined ? {} : { prefix }) });
  return output?.results.map((r) => r.emoji) ?? [];
}

/** "🦖 🦕 🦟" or a neutral placeholder when the packs are missing at build time. */
export function shown(query: string, options: ExampleOptions = {}): string {
  const top = topEmoji(query, options);
  return top.length > 0 ? top.join(" ") : "…";
}

/** The real engine output as an array literal for code comments: [{ emoji: "🦖", id: "1F996", … }]. */
export function resultLiteral(query: string, options: ExampleOptions = {}): string {
  const { locale = "en", limit = 2, part = "core" } = options;
  const engine = engineFor(locale === "en" ? ["en"] : ["en", locale], part);
  const results = engine?.search(query, { locale, limit }).results ?? [];
  if (results.length === 0) return "[…]";
  const items = results.map(
    (r) =>
      `{ emoji: "${r.emoji}", id: "${r.id}", score: ${Number(r.score.toFixed(2))}, source: "${r.source}" }`,
  );
  return `[${items.join(", ")}, …]`;
}

export interface EdgeDecision {
  query: string;
  words: number;
  confidence: number;
  /** The SDK's own rule (shouldUseSemantic): ask the semantic layers or not. */
  asksEdge: boolean;
  top: string[];
}

/** How sure the on-device engine is about a query, and whether the SDK would ask the edge. */
export function edgeDecision(query: string, options: ExampleOptions = {}): EdgeDecision | undefined {
  const { locale = "en", part = "core", limit = 3 } = options;
  const engine = engineFor(locale === "en" ? ["en"] : ["en", locale], part);
  const output = engine?.search(query, { locale, limit });
  if (!output) return undefined;
  return {
    query,
    words: output.tokens.length,
    confidence: output.confidence,
    asksEdge: shouldUseSemantic(output),
    top: output.results.map((r) => r.emoji),
  };
}

export const API_FIXTURES = fixtures;

/** Pretty JSON for a response body shown in a code block. Long result lists stay one line each. */
export function prettyResponse(body: unknown): string {
  return JSON.stringify(body, null, 2).replace(
    /\{\s+"emoji": ("[^"]*"),\s+"id": ("[^"]*"),\s+"score": ([\d.]+),\s+"source": ("[^"]*")\s+\}/g,
    '{ "emoji": $1, "id": $2, "score": $3, "source": $4 }',
  );
}
