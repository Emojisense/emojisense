/**
 * Facts about the shipped data pack, read at build time from the pack manifest
 * (packages/data/dist/packs/<version>/manifest.json, docs/PACK_FORMAT.md). `undefined` until
 * `pnpm data:build` has produced the packs, so pages show these facts only when they are true.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACK_VERSION } from "../config";

export interface PackFacts {
  packVersion: string;
  emojiVersion: string;
  emojiCount: number;
  languages: number;
  emojibaseVersion?: string;
  cldrVersion?: string;
}

interface Manifest {
  packVersion?: unknown;
  emojiVersion?: unknown;
  emojiCount?: unknown;
  source?: { emojibaseVersion?: unknown; cldrVersion?: unknown };
  files?: Record<string, { locale?: unknown }>;
}

function readManifest(): Manifest | undefined {
  const path = join(process.cwd(), "../../packages/data/dist/packs", PACK_VERSION, "manifest.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Manifest;
  } catch {
    return undefined;
  }
}

function parse(manifest: Manifest | undefined): PackFacts | undefined {
  if (!manifest) return undefined;
  const { packVersion, emojiVersion, emojiCount, source, files } = manifest;
  if (typeof packVersion !== "string" || typeof emojiVersion !== "string" || typeof emojiCount !== "number") {
    return undefined;
  }
  const locales = new Set(
    Object.values(files ?? {})
      .map((file) => file.locale)
      .filter((locale): locale is string => typeof locale === "string"),
  );
  return {
    packVersion,
    emojiVersion,
    emojiCount,
    languages: locales.size,
    ...(typeof source?.emojibaseVersion === "string" ? { emojibaseVersion: source.emojibaseVersion } : {}),
    ...(typeof source?.cldrVersion === "string" ? { cldrVersion: source.cldrVersion } : {}),
  };
}

export const packFacts: PackFacts | undefined = parse(readManifest());
