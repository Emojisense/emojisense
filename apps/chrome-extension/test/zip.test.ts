import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createZip } from "../scripts/zip.ts";

/** Read a zip back through its central directory, as the Web Store does. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const localOffset = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const start = localOffset + 30 + localNameLength;
    const body = zip.subarray(start, start + compressed);
    entries.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    at += 46 + nameLength;
  }
  return entries;
}

describe("createZip", () => {
  const manifest = Buffer.from(JSON.stringify({ manifest_version: 3, name: "Emojisense" }).repeat(20));
  const icon = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it("round-trips every file, sorted, with the manifest at the root", () => {
    const entries = readZip(
      createZip([
        { path: "icons/icon-16.png", data: icon },
        { path: "manifest.json", data: manifest },
      ]),
    );
    expect([...entries.keys()]).toEqual(["icons/icon-16.png", "manifest.json"]);
    expect(entries.get("manifest.json")).toEqual(manifest);
    expect(entries.get("icons/icon-16.png")).toEqual(icon);
  });

  it("gives the same bytes for the same files in any order", () => {
    const a = createZip([
      { path: "a.txt", data: icon },
      { path: "b.txt", data: manifest },
    ]);
    const b = createZip([
      { path: "b.txt", data: manifest },
      { path: "a.txt", data: icon },
    ]);
    expect(a.equals(b)).toBe(true);
  });

  it("refuses paths that leave the zip root", () => {
    expect(() => createZip([{ path: "../manifest.json", data: icon }])).toThrow(/Unsafe zip path/);
    expect(() => createZip([{ path: "/manifest.json", data: icon }])).toThrow(/Unsafe zip path/);
  });
});
