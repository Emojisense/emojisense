/**
 * A minimal ZIP writer (deflate, no extras) for the Chrome Web Store upload. Entries are sorted and
 * carry a fixed timestamp, so one commit always gives a byte-identical zip.
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Path inside the zip, with forward slashes, e.g. "icons/icon-16.png". */
  path: string;
  data: Uint8Array;
}

/** 1980-01-01 00:00, the earliest DOS date: a timestamp that never changes the bytes. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const UTF8_FLAG = 1 << 11;

function header(fields: [bytes: 2 | 4, value: number][]): Buffer {
  const buffer = Buffer.alloc(fields.reduce((sum, [bytes]) => sum + bytes, 0));
  let offset = 0;
  for (const [bytes, value] of fields) {
    if (bytes === 2) buffer.writeUInt16LE(value, offset);
    else buffer.writeUInt32LE(value, offset);
    offset += bytes;
  }
  return buffer;
}

export function createZip(entries: readonly ZipEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { path, data } of sorted) {
    if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
      throw new Error(`Unsafe zip path: ${path}`);
    }
    const name = Buffer.from(path, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    // Store small or incompressible files as they are (method 0).
    const stored = deflated.length >= data.length;
    const body = stored ? Buffer.from(data) : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);
    const common: [2 | 4, number][] = [
      [2, 20], // version needed: 2.0
      [2, UTF8_FLAG],
      [2, method],
      [2, DOS_TIME],
      [2, DOS_DATE],
      [4, crc],
      [4, body.length],
      [4, data.length],
      [2, name.length],
      [2, 0], // extra field length
    ];
    const localHeader = Buffer.concat([header([[4, 0x04034b50], ...common]), name]);
    local.push(localHeader, body);
    central.push(
      Buffer.concat([
        header([
          [4, 0x02014b50],
          [2, 20], // version made by: 2.0, MS-DOS attributes
          ...common,
          [2, 0], // comment length
          [2, 0], // disk number
          [2, 0], // internal attributes
          [4, 0], // external attributes
          [4, offset],
        ]),
        name,
      ]),
    );
    offset += localHeader.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = header([
    [4, 0x06054b50],
    [2, 0],
    [2, 0],
    [2, sorted.length],
    [2, sorted.length],
    [4, directory.length],
    [4, offset],
    [2, 0],
  ]);
  return Buffer.concat([...local, directory, end]);
}
