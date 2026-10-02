import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { formatQuery, getModel } from "./models.ts";
import { parseGlyphVectorFileName, parseVectorFileName } from "./vector-files.ts";

export interface ManifestFile {
  sha256: string;
  bytes: number;
  gzipBytes: number;
  locale?: string;
  model?: string;
  dims?: number;
  queryTemplate?: string;
  /** A glyph vector file: several rows per emoji (PACK_FORMAT.md §5). */
  glyph?: true;
}

/** Compressed size as the manifest reports it (and as the pack budget is measured). */
export const gzipSize = (data: Uint8Array | string) => gzipSync(data, { level: 9 }).length;

/** (Re)write manifest.json for every pack and vector file in `dir`, keeping earlier metadata. */
export interface Manifest {
  format: "emojisense-manifest";
  formatVersion: 1;
  files: Record<string, ManifestFile>;
  [meta: string]: unknown;
}

export function writeManifest(dir: string, meta: Record<string, unknown>): Manifest {
  const path = join(dir, "manifest.json");
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const files: Record<string, ManifestFile> = {};
  for (const name of readdirSync(dir).sort()) {
    if (name === "manifest.json") continue;
    const bytes = readFileSync(join(dir, name));
    const entry: ManifestFile = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      gzipBytes: gzipSize(bytes),
    };
    const pack = /^pack\.([\w-]+?)(?:\.ext)?\.json$/.exec(name);
    if (pack) entry.locale = pack[1] as string;
    const glyph = parseGlyphVectorFileName(name);
    const vectors = parseVectorFileName(name) ?? glyph;
    if (glyph) entry.glyph = true;
    if (vectors) {
      const model = getModel(vectors.modelKey);
      // A locale's vector file names its locale; the shared file has none (PACK_FORMAT.md §5).
      if (vectors.locale) entry.locale = vectors.locale;
      entry.model = model.id;
      entry.dims = vectors.dims;
      entry.queryTemplate = formatQuery(model, "{q}");
    }
    files[name] = entry;
  }
  const { files: _previousFiles, ...previousMeta } = previous;
  const manifest: Manifest = {
    ...previousMeta,
    format: "emojisense-manifest",
    formatVersion: 1,
    ...meta,
    files,
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
