import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { formatQuery, getModel } from "./models.ts";

export interface ManifestFile {
  sha256: string;
  bytes: number;
  gzipBytes: number;
  locale?: string;
  model?: string;
  dims?: number;
  queryTemplate?: string;
}

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
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
    };
    const pack = /^pack\.([\w-]+?)(?:\.ext)?\.json$/.exec(name);
    if (pack) entry.locale = pack[1] as string;
    const vectors = /^vectors\.([\w-]+)\.(\d+)\.bin$/.exec(name);
    if (vectors) {
      const model = getModel(vectors[1] as string);
      entry.model = model.id;
      entry.dims = Number(vectors[2]);
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
