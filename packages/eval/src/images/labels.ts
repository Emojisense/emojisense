import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** One line of photos/labels.jsonl. */
export interface PhotoLabel {
  /** File name inside photos/, no directories. */
  file: string;
  /** Any of these in the top k counts as a hit. */
  answers: string[];
  /** SPDX-style id; see LICENSE_PATTERN. */
  license: string;
  /** Where the photo comes from (URL), or "own photo". */
  source: string;
  /** Required for CC BY licenses (attribution). */
  author?: string;
  note?: string;
}

/**
 * Licenses that allow us to commit the photo to an MIT repository. Non-commercial (NC) and
 * no-derivatives (ND) licenses are out; so are the Unsplash and Pexels licenses, which forbid
 * redistributing photos as a collection. "own" = taken by the owner, who releases it as CC0.
 */
export const LICENSE_PATTERN = /^(?:CC0|CC0-1\.0|PDM-1\.0|CC-BY-(?:SA-)?(?:2\.0|3\.0|4\.0)|own)$/;
const IMAGE_FILE = /^[\w.-]+\.(?:jpe?g|png|webp)$/i;
/** The API accepts at most 256 KB per image (docs/API.md). */
export const MAX_IMAGE_BYTES = 256 * 1024;

export function parsePhotoLabels(text: string): PhotoLabel[] {
  const labels: PhotoLabel[] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    const where = `labels.jsonl line ${i + 1}`;
    let label: Partial<PhotoLabel>;
    try {
      label = JSON.parse(line);
    } catch {
      throw new Error(`${where}: not valid JSON`);
    }
    if (typeof label.file !== "string" || !IMAGE_FILE.test(label.file)) {
      throw new Error(`${where}: "file" must be a .jpg, .png or .webp name without directories`);
    }
    if (seen.has(label.file)) throw new Error(`${where}: ${label.file} is listed twice`);
    seen.add(label.file);
    if (
      !Array.isArray(label.answers) ||
      label.answers.length === 0 ||
      !label.answers.every((a) => a !== "")
    ) {
      throw new Error(`${where}: "answers" must list at least one emoji`);
    }
    if (typeof label.license !== "string" || !LICENSE_PATTERN.test(label.license)) {
      throw new Error(`${where}: license "${label.license}" is not allowed (see photos/README.md)`);
    }
    if (typeof label.source !== "string" || label.source.trim() === "") {
      throw new Error(`${where}: "source" is required (URL, or "own photo")`);
    }
    if (label.license.startsWith("CC-BY") && !label.author) {
      throw new Error(`${where}: ${label.license} needs "author" for attribution`);
    }
    labels.push(label as PhotoLabel);
  });
  return labels;
}

export interface Photo {
  label: PhotoLabel;
  path: string;
  bytes: number;
}

export interface PhotoSet {
  photos: Photo[];
  /** Listed in labels.jsonl but not in the directory. */
  missing: string[];
  /** Larger than the API accepts; downscale them (photos/README.md). */
  oversized: string[];
}

/** Labels plus the files that exist. A missing labels file is an empty set, not an error. */
export function loadPhotoSet(dir: string): PhotoSet {
  const labelsPath = join(dir, "labels.jsonl");
  const labels = existsSync(labelsPath) ? parsePhotoLabels(readFileSync(labelsPath, "utf8")) : [];
  const set: PhotoSet = { photos: [], missing: [], oversized: [] };
  for (const label of labels) {
    const path = join(dir, label.file);
    if (!existsSync(path)) {
      set.missing.push(label.file);
      continue;
    }
    const bytes = statSync(path).size;
    if (bytes > MAX_IMAGE_BYTES) set.oversized.push(label.file);
    set.photos.push({ label, path, bytes });
  }
  return set;
}
