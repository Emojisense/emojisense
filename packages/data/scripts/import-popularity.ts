/**
 * Imports the popularity prior from Emoji-SP (Ferré et al., Behavior Research Methods 2023; CC BY 4.0;
 * https://osf.io/dtfjv/):
 * the mean rated frequency of use (1–7) of 1,031 emoji, by 30 raters each.
 *
 *   curl -L -o /tmp/emoji-sp.xlsx https://osf.io/download/p3azd/
 *   pnpm --filter @emojisense/data exec tsx scripts/import-popularity.ts /tmp/emoji-sp.xlsx
 *
 * Writes priors/popularity.json (the `freq` column per emoji, keyed by code points without U+FE0F).
 * The build turns it into the `popularity` key of pack.en.json (src/popularity.ts).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { DATA_ROOT } from "../src/paths.ts";

const EXPECTED_SHA256 = "72e7c0060ad232962b8eec953e3a34d37d6ff7aef7146f148519fb08cf161d68";

/** The files of a zip archive (stored or deflated entries), by name. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("not a zip file");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + size);
    files.set(name, method === 0 ? data : inflateRawSync(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const decode = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Rows of the first sheet as arrays of cell texts (shared strings resolved). */
function readSheet(files: Map<string, Buffer>): string[][] {
  const shared = [
    ...(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>(.*?)<\/si>/gs),
  ].map(([, si]) => decode([...(si as string).matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => t[1]).join("")));
  const sheet = files.get("xl/worksheets/sheet1.xml")?.toString("utf8") ?? "";
  const column = (ref: string) =>
    [...(/^[A-Z]+/.exec(ref)?.[0] ?? "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return [...sheet.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map(([, row]) => {
    const cells: string[] = [];
    for (const [, attrs, body] of (row as string).matchAll(/<c ([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
      const ref = /r="([A-Z]+\d+)"/.exec(attrs as string)?.[1] ?? "";
      const value = /<v>(.*?)<\/v>/s.exec(body ?? "")?.[1] ?? "";
      cells[column(ref)] = /t="s"/.test(attrs as string) ? (shared[Number(value)] ?? "") : decode(value);
    }
    return cells;
  });
}

const path = process.argv.slice(2).find((a) => a !== "--");
if (!path) throw new Error("usage: import-popularity.ts <emoji-sp.xlsx>");
const bytes = readFileSync(path);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== EXPECTED_SHA256)
  console.warn(`⚠ sha256 ${sha256} differs from the imported file's ${EXPECTED_SHA256}`);

const [header = [], ...rows] = readSheet(unzip(bytes));
const col = (name: string) => {
  const index = header.indexOf(name);
  if (index < 0) throw new Error(`column "${name}" missing`);
  return index;
};
const codes = col("ascii_code");
const freq = col("freq");
const ratings: Record<string, number> = {};
for (const row of rows) {
  const points = (row[codes] ?? "")
    .split(/\s+/)
    .filter((p) => /^U\+[0-9A-F]+$/i.test(p) && p.toUpperCase() !== "U+FE0F")
    .map((p) => p.slice(2).toUpperCase());
  const value = Number(row[freq]);
  if (points.length === 0 || !Number.isFinite(value)) continue;
  ratings[points.join("-")] = Math.round(value * 1000) / 1000;
}

const out = {
  source:
    "Emoji-SP, the Spanish emoji database (Ferré, Haro, Pérez-Sánchez, Moreno, Hinojosa; Behavior Research Methods 55, 2023)",
  doi: "10.3758/s13428-022-01893-6",
  url: "https://osf.io/dtfjv/",
  license: "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
  changes:
    "kept only the mean rated frequency of use (column `freq`, 1–7) per emoji, keyed by code points without U+FE0F",
  sha256,
  ratings,
};
writeFileSync(join(DATA_ROOT, "priors", "popularity.json"), `${JSON.stringify(out, null, 1)}\n`);
console.log(`import-popularity: ${Object.keys(ratings).length} emoji → priors/popularity.json`);
