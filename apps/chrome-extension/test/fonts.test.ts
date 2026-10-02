import { describe, expect, it, vi } from "vitest";
import { createFontSource, toBase64 } from "../src/background/fonts";
import { createFontLoader } from "../src/content/fonts";
import {
  FONTS_MESSAGE,
  isFontsRequest,
  PICKER_BODY_FAMILY,
  PICKER_FONTS,
  parseFontsResponse,
} from "../src/shared/fonts";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe("font messages", () => {
  it("recognizes the request", () => {
    expect(isFontsRequest({ type: FONTS_MESSAGE })).toBe(true);
    expect(isFontsRequest({ type: "emojisense/toggle" })).toBe(false);
    expect(isFontsRequest(null)).toBe(false);
  });

  it("takes only the bytes of known files from a reply, never other families or ranges", () => {
    const known = PICKER_FONTS[0];
    if (!known) throw new Error("no picker fonts");
    const parsed = parseFontsResponse({
      fonts: [
        { ...known, family: "Arial", unicodeRange: "U+0-10FFFF", data: "AAEC" },
        { file: "fonts/evil.woff2", family: "X", data: "AAEC" },
      ],
    });
    expect(parsed).toEqual([{ ...known, data: "AAEC" }]);
    expect(parseFontsResponse(undefined)).toEqual([]);
    expect(parseFontsResponse({ fonts: "nope" })).toEqual([]);
  });

  it("uses the extension's own family names, so page text never changes font", () => {
    for (const font of PICKER_FONTS) expect(font.family.startsWith("Emojisense ")).toBe(true);
  });
});

describe("service worker font source", () => {
  it("reads each picker font once and encodes it for messaging", async () => {
    const read = vi.fn(async () => bytes(0, 1, 2, 250));
    const fonts = createFontSource(read);
    const first = await fonts();
    await fonts();
    expect(read).toHaveBeenCalledTimes(PICKER_FONTS.length);
    expect(first.map((font) => font.file)).toEqual(PICKER_FONTS.map((font) => font.file));
    expect(first[0]?.data).toBe("AAEC+g==");
  });

  it("tries again after a failed read", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("gone")).mockResolvedValue(bytes(1));
    const fonts = createFontSource(read);
    await expect(fonts()).rejects.toThrow("gone");
    await expect(fonts()).resolves.toHaveLength(PICKER_FONTS.length);
  });

  it("encodes large files without overflowing the call stack", () => {
    const large = new Uint8Array(200_000).fill(65);
    expect(atob(toBase64(large.buffer))).toHaveLength(200_000);
  });
});

describe("content font loader", () => {
  class FakeFontFace {
    static created: FakeFontFace[] = [];
    loaded = false;
    constructor(
      readonly family: string,
      readonly source: ArrayBuffer,
      readonly descriptors: FontFaceDescriptors,
    ) {
      FakeFontFace.created.push(this);
    }
    async load() {
      this.loaded = true;
      return this;
    }
  }

  function fakeDocument(existing: string[] = []) {
    const faces = new Set<{ family: string }>(existing.map((family) => ({ family: `"${family}"` })));
    const fonts = Object.assign(faces, {
      add: (face: { family: string }) => Set.prototype.add.call(faces, face),
    });
    FakeFontFace.created = [];
    return { defaultView: { FontFace: FakeFontFace }, fonts } as unknown as Document;
  }

  const reply = () => ({
    fonts: PICKER_FONTS.map((font) => ({ file: font.file, data: toBase64(bytes(7, 8, 9)) })),
  });

  it("registers and loads every picker font once per document", async () => {
    const doc = fakeDocument();
    const request = vi.fn(async () => reply());
    const load = createFontLoader(doc, request);
    await load();
    await load();
    expect(request).toHaveBeenCalledTimes(1);
    expect(FakeFontFace.created).toHaveLength(PICKER_FONTS.length);
    const [first] = FakeFontFace.created;
    expect(first?.family).toBe(PICKER_BODY_FAMILY);
    expect([...new Uint8Array(first?.source ?? new ArrayBuffer(0))]).toEqual([7, 8, 9]);
    expect(first?.descriptors).toMatchObject({ weight: "100 900", display: "swap" });
    expect(FakeFontFace.created.every((face) => face.loaded)).toBe(true);
    expect(doc.fonts.size).toBe(PICKER_FONTS.length);
  });

  it("skips families an earlier copy of the script registered", async () => {
    const doc = fakeDocument([PICKER_BODY_FAMILY]);
    await createFontLoader(doc, async () => reply())();
    expect(FakeFontFace.created.map((face) => face.family)).not.toContain(PICKER_BODY_FAMILY);
  });

  it("resolves without fonts when the worker cannot answer", async () => {
    const doc = fakeDocument();
    await expect(
      createFontLoader(doc, async () => Promise.reject(new Error("context invalidated")))(),
    ).resolves.toBeUndefined();
    expect(FakeFontFace.created).toHaveLength(0);
  });
});
