/**
 * The share-card typefaces and the fallback order per text style. The site's faces come first
 * (Bricolage Grotesque, Hanken Grotesk, DM Mono); scripts they lack fall through to Noto Sans
 * faces. Script faces load only for text that needs them.
 *
 * Files:
 * - `og/<name>.woff`: committed in src/og/fonts/ (scripts/og-fonts.mjs).
 * - `noto-sans/…`, `noto-sans-sc/…`: the @fontsource packages' slices.
 */
import notoSansSlices from "@fontsource/noto-sans/unicode.json";
import notoSansScSlices from "@fontsource/noto-sans-sc/unicode.json";
import type { HarfBuzz, HbFont } from "./harfbuzz";

export type Range = readonly [number, number];

export interface FaceSpec {
  /** Logical file name; a FontSource maps it to bytes. */
  file: string;
  /** The code points worth loading the face for. Faces without ranges always load. */
  ranges?: readonly Range[];
  /** Takes the style's letter spacing. Scripts that join letters or stack marks never do. */
  tracking?: boolean;
}

export interface FontSource {
  /** The face file as SFNT (TrueType or OpenType) bytes. */
  read(file: string): Promise<Uint8Array>;
}

export type StackName = "display" | "body" | "medium" | "mono";

export interface Face {
  spec: FaceSpec;
  font: HbFont;
}

const ARABIC: Range[] = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x0870, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];
const DEVANAGARI: Range[] = [
  [0x0900, 0x097f],
  [0x1cd0, 0x1cff],
  [0xa8e0, 0xa8ff],
];
const BENGALI: Range[] = [[0x0980, 0x09ff]];

/** "U+0400-045F,U+2116" → ranges. */
export function parseUnicodeRange(css: string): Range[] {
  return css.split(",").map((part) => {
    const [from, to = from] = part.trim().replace(/^U\+/i, "").split("-");
    return [Number.parseInt(from ?? "0", 16), Number.parseInt(to ?? "0", 16)] as const;
  });
}

/** Noto Sans adds the Cyrillic and Greek that the site's faces lack. */
const NOTO_SANS_SLICES = ["cyrillic", "cyrillic-ext", "greek"] as const;

function notoSans(weight: 400 | 700): FaceSpec[] {
  return NOTO_SANS_SLICES.map((slice) => ({
    file: `noto-sans/noto-sans-${slice}-${weight}-normal.woff`,
    ranges: parseUnicodeRange(notoSansSlices[slice]),
  }));
}

/** The numbered slices only: the named ones repeat Latin and Cyrillic. */
function notoSansSc(weight: 400 | 700): FaceSpec[] {
  return Object.entries(notoSansScSlices as Record<string, string>).flatMap(([key, range]) => {
    const slice = /^\[(\d+)\]$/.exec(key)?.[1];
    return slice
      ? [
          {
            file: `noto-sans-sc/noto-sans-sc-${slice}-${weight}-normal.woff`,
            ranges: parseUnicodeRange(range),
          },
        ]
      : [];
  });
}

function scripts(weight: 400 | 700): FaceSpec[] {
  return [
    ...notoSans(weight),
    { file: `og/noto-sans-arabic-${weight}.woff`, ranges: ARABIC },
    { file: `og/noto-sans-devanagari-${weight}.woff`, ranges: DEVANAGARI },
    { file: `og/noto-sans-bengali-${weight}.woff`, ranges: BENGALI },
    ...notoSansSc(weight),
  ];
}

const BODY: FaceSpec = { file: "og/hanken-grotesk-400.woff", tracking: true };

export const STACKS: Record<StackName, readonly FaceSpec[]> = {
  display: [{ file: "og/bricolage-grotesque-700.woff", tracking: true }, ...scripts(700)],
  body: [BODY, ...scripts(400)],
  medium: [{ file: "og/hanken-grotesk-500.woff", tracking: true }, BODY, ...scripts(400)],
  // As on the site: after DM Mono (Latin code), words in other scripts take the body faces.
  mono: [{ file: "og/dm-mono-400.woff", tracking: true }, BODY, ...scripts(400)],
};

const needs = (spec: FaceSpec, codePoints: readonly number[]) =>
  !spec.ranges || codePoints.some((cp) => spec.ranges?.some(([from, to]) => cp >= from && cp <= to));

/** Loads faces on demand and picks the face for each character. One per renderer. */
export class FontLibrary {
  private readonly loaded = new Map<string, Promise<Face>>();

  constructor(
    private readonly hb: HarfBuzz,
    private readonly source: FontSource,
  ) {}

  /** The faces of a stack that can draw `text`, in fallback order. */
  async facesFor(stack: StackName, text: string): Promise<Face[]> {
    const codePoints = Array.from(text, (char) => char.codePointAt(0) ?? 0);
    const specs = STACKS[stack].filter((spec) => needs(spec, codePoints));
    return Promise.all(specs.map((spec) => this.load(spec)));
  }

  private load(spec: FaceSpec): Promise<Face> {
    let face = this.loaded.get(spec.file);
    if (!face) {
      face = this.source.read(spec.file).then((bytes) => ({ spec, font: this.hb.loadFont(bytes) }));
      face.catch(() => this.loaded.delete(spec.file));
      this.loaded.set(spec.file, face);
    }
    return face;
  }
}
