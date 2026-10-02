/**
 * Prebuilt alias index, binary format "ESIDX1": the phrase index of one fixed list of packs, built
 * ahead of time, so an engine loads it instead of indexing the packs (docs/PACK_FORMAT.md §11).
 *
 *   const prebuilt = readEngineIndex(bytes, packs); // undefined: not made from these packs
 *   const engine = createEngine(packs, prebuilt ? { prebuilt } : {});
 *
 * Search results are the same as with `createEngine(packs)`: the file holds what the build
 * computes (phrases, sorted vocabulary, postings), and the rest is derived the same way.
 */
import { collectEntries, indexPhrases, type PhraseTexts, type StoredIndex } from "./engine.js";
import { normalize } from "./normalize.js";
import { assertPack, FIELDS, type Pack } from "./pack.js";

const MAGIC = "ESIDX1";
/** Bump when `indexPhrases` changes what it produces: older files are then rebuilt, not read. */
const INDEX_VERSION = 1;
/**
 * Normalized when a file is written and when it is read. Stored phrases went through
 * `normalize`, so a different result means the file came from another engine version.
 */
const PROBE = "Café ŞİŞLİ Straße Ⅻ ｆｕｌｌ 👍🏽 مَرحبا नमस्ते 你好 カタカナ Ελλάδα";
const SEPARATOR = "\n";

/** What identifies a pack's content cheaply: a file made from other packs is never read. */
interface PackStamp {
  locale: string;
  part: string;
  packVersion: string;
  rows: number;
  /** Characters in all text cells: an added, removed or changed phrase almost always moves it. */
  chars: number;
  weights: string;
}

interface Header {
  format: typeof MAGIC;
  version: number;
  fields: string;
  probe: string;
  packs: PackStamp[];
  phrases: number;
  vocab: number;
  postings: number;
  emojiBytes: 2 | 4;
  maskBytes: 1 | 4;
  /** UTF-8 bytes of all phrase texts; phrase i starts at textStart[i] (one more entry: the end). */
  textBytes: number;
  vocabBytes: number;
}

function stampOf(pack: Pack): PackStamp {
  let chars = 0;
  for (const row of pack.emoji) {
    for (const cell of row) if (typeof cell === "string") chars += cell.length;
  }
  return {
    locale: pack.locale,
    part: pack.part ?? "core",
    packVersion: pack.packVersion,
    rows: pack.emoji.length,
    chars,
    weights: JSON.stringify(pack.weights ?? {}),
  };
}
const align4 = (n: number) => (n + 3) & ~3;
const littleEndian = () => new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** The prebuilt index of `packs`, in the order `createEngine` gets them. Deterministic bytes. */
export function buildEngineIndex(packs: Pack[]): Uint8Array {
  if (!littleEndian()) throw new Error("emojisense: engine index files are little-endian");
  for (const pack of packs) assertPack(pack);
  const { entries, indexById } = collectEntries(packs);
  const index = indexPhrases(packs, entries, indexById);
  for (const token of index.vocab) {
    if (token.includes(SEPARATOR)) throw new Error("emojisense: a token contains a line break");
  }
  const encoder = new TextEncoder();
  const phraseBytes = index.phraseText.map((phrase) => encoder.encode(phrase));
  const textStart = new Uint32Array(phraseBytes.length + 1);
  phraseBytes.forEach((bytes, i) => {
    textStart[i + 1] = (textStart[i] as number) + bytes.length;
  });
  const text = new Uint8Array(textStart[phraseBytes.length] as number);
  phraseBytes.forEach((bytes, i) => {
    text.set(bytes, textStart[i]);
  });
  const vocab = encoder.encode(index.vocab.join(SEPARATOR));
  const emojiBytes = entries.length <= 0xffff ? 2 : 4;
  const maskBytes = packs.length <= 8 ? 1 : 4;
  const phrases = index.phraseText.length;
  const header: Header = {
    format: MAGIC,
    version: INDEX_VERSION,
    fields: FIELDS.join(","),
    probe: normalize(PROBE),
    packs: packs.map(stampOf),
    phrases,
    vocab: index.vocab.length,
    postings: index.postings.length,
    emojiBytes,
    maskBytes,
    textBytes: text.length,
    vocabBytes: vocab.length,
  };
  const sections: Uint8Array[] = [
    bytesOf(index.postingStart),
    bytesOf(index.postings),
    bytesOf(textStart),
    bytesOf(emojiBytes === 2 ? Uint16Array.from(index.phraseEmoji) : Int32Array.from(index.phraseEmoji)),
    bytesOf(
      maskBytes === 1 ? Uint8Array.from(index.phraseLocaleMask) : Uint32Array.from(index.phraseLocaleMask),
    ),
    index.phraseField,
    text,
    vocab,
  ];
  const headerBytes = encoder.encode(JSON.stringify(header));
  let size = align4(4 + headerBytes.length);
  for (const section of sections) size += align4(section.length);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, headerBytes.length, true);
  out.set(headerBytes, 4);
  let offset = align4(4 + headerBytes.length);
  for (const section of sections) {
    out.set(section, offset);
    offset += align4(section.length);
  }
  return out;
}

/**
 * The stored index in `bytes`, for `createEngine(packs, { prebuilt })`. Undefined when the file
 * was not made from these packs (locale, part, version, rows, text length and weights of each,
 * in order) or by this engine version, or is damaged: the caller then builds the index.
 */
export function readEngineIndex(bytes: ArrayBuffer | Uint8Array, packs: Pack[]): StoredIndex | undefined {
  if (!littleEndian()) return undefined;
  let view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Typed views need 4-byte aligned offsets: copy a view that does not start on one.
  if (view.byteOffset % 4 !== 0) view = view.slice();
  if (view.length < 4) return undefined;
  const headerLength = new DataView(view.buffer, view.byteOffset).getUint32(0, true);
  let header: Header;
  try {
    header = JSON.parse(new TextDecoder().decode(view.subarray(4, 4 + headerLength))) as Header;
  } catch {
    return undefined;
  }
  if (!matches(header, packs)) return undefined;
  try {
    return decodeSections(view, header, headerLength);
  } catch {
    return undefined;
  }
}

function decodeSections(view: Uint8Array, header: Header, headerLength: number): StoredIndex | undefined {
  const { buffer, byteOffset } = view;
  let offset = align4(4 + headerLength);
  const take = (length: number) => {
    const start = offset;
    offset += align4(length);
    if (offset > view.length) throw new Error("emojisense: engine index file is truncated");
    return byteOffset + start;
  };
  const postingStart = new Int32Array(buffer, take((header.vocab + 1) * 4), header.vocab + 1);
  const postings = new Int32Array(buffer, take(header.postings * 4), header.postings);
  const textStart = new Uint32Array(buffer, take((header.phrases + 1) * 4), header.phrases + 1);
  const phraseEmoji =
    header.emojiBytes === 2
      ? new Uint16Array(buffer, take(header.phrases * 2), header.phrases)
      : new Int32Array(buffer, take(header.phrases * 4), header.phrases);
  const phraseLocaleMask =
    header.maskBytes === 1
      ? new Uint8Array(buffer, take(header.phrases), header.phrases)
      : new Uint32Array(buffer, take(header.phrases * 4), header.phrases);
  const phraseField = new Uint8Array(buffer, take(header.phrases), header.phrases);
  const decoder = new TextDecoder();
  const text = new Uint8Array(buffer, take(header.textBytes), header.textBytes);
  const vocabText = new Uint8Array(buffer, take(header.vocabBytes), header.vocabBytes);
  const vocab = header.vocab === 0 ? [] : decoder.decode(vocabText).split(SEPARATOR);
  if (vocab.length !== header.vocab || textStart[header.phrases] !== header.textBytes) return undefined;
  // Phrase texts stay UTF-8 until a result shows one: decoding them all would cost more than
  // the rest of the load.
  const phraseText: PhraseTexts = {
    length: header.phrases,
    at: (i) =>
      i >= 0 && i < header.phrases
        ? decoder.decode(text.subarray(textStart[i] as number, textStart[i + 1] as number))
        : undefined,
  };
  return { phraseText, phraseEmoji, phraseField, phraseLocaleMask, vocab, postingStart, postings };
}

function matches(header: Header, packs: Pack[]): boolean {
  if (header.format !== MAGIC || header.version !== INDEX_VERSION) return false;
  if (header.fields !== FIELDS.join(",") || header.probe !== normalize(PROBE)) return false;
  if (header.packs?.length !== packs.length) return false;
  return packs.every((pack, i) => {
    const stamp = stampOf(pack);
    const stored = header.packs[i] as PackStamp;
    return (
      stored.locale === stamp.locale &&
      stored.part === stamp.part &&
      stored.packVersion === stamp.packVersion &&
      stored.rows === stamp.rows &&
      stored.chars === stamp.chars &&
      stored.weights === stamp.weights
    );
  });
}

function bytesOf(array: Int32Array | Uint32Array | Uint16Array | Uint8Array): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}
