/**
 * WOFF 1.0 → SFNT (TrueType/OpenType), because HarfBuzz reads only the latter. WOFF keeps each
 * table zlib-compressed; the caller passes the inflater of its runtime (node:zlib at build time,
 * DecompressionStream in the Worker).
 */
export type Inflate = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

const WOFF_SIGNATURE = 0x774f4646;
const WOFF_HEADER_BYTES = 44;
const WOFF_ENTRY_BYTES = 20;
const SFNT_HEADER_BYTES = 12;
const SFNT_ENTRY_BYTES = 16;

const pad4 = (length: number) => (length + 3) & ~3;

export function isWoff(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0) === WOFF_SIGNATURE
  );
}

/** Returns SFNT bytes; SFNT input comes back unchanged. */
export async function toSfnt(bytes: Uint8Array, inflate: Inflate): Promise<Uint8Array> {
  if (!isWoff(bytes)) return bytes;
  const woff = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flavor = woff.getUint32(4);
  const tableCount = woff.getUint16(12);
  const tables: { tag: number; checksum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < tableCount; i++) {
    const entry = WOFF_HEADER_BYTES + i * WOFF_ENTRY_BYTES;
    const offset = woff.getUint32(entry + 4);
    const compressedLength = woff.getUint32(entry + 8);
    const length = woff.getUint32(entry + 12);
    const stored = bytes.subarray(offset, offset + compressedLength);
    const data = compressedLength < length ? await inflate(stored) : stored;
    if (data.byteLength !== length) throw new Error("WOFF table length mismatch");
    tables.push({ tag: woff.getUint32(entry), checksum: woff.getUint32(entry + 16), data });
  }

  const directoryBytes = SFNT_HEADER_BYTES + tableCount * SFNT_ENTRY_BYTES;
  const size = tables.reduce((total, table) => total + pad4(table.data.byteLength), directoryBytes);
  const out = new Uint8Array(size);
  const sfnt = new DataView(out.buffer);
  const entrySelector = Math.floor(Math.log2(tableCount));
  const searchRange = 2 ** entrySelector * 16;
  sfnt.setUint32(0, flavor);
  sfnt.setUint16(4, tableCount);
  sfnt.setUint16(6, searchRange);
  sfnt.setUint16(8, entrySelector);
  sfnt.setUint16(10, tableCount * 16 - searchRange);
  let offset = directoryBytes;
  tables.forEach((table, i) => {
    const entry = SFNT_HEADER_BYTES + i * SFNT_ENTRY_BYTES;
    sfnt.setUint32(entry, table.tag);
    sfnt.setUint32(entry + 4, table.checksum);
    sfnt.setUint32(entry + 8, offset);
    sfnt.setUint32(entry + 12, table.data.byteLength);
    out.set(table.data, offset);
    offset += pad4(table.data.byteLength);
  });
  return out;
}
