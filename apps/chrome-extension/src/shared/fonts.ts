/**
 * Fonts for the picker and the toast. They ship inside the extension (dist/fonts): no font is
 * downloaded from the network.
 *
 * A content script cannot fetch packaged files without `web_accessible_resources`, which would let
 * any site detect the extension. So the picker asks the service worker for the bytes once per page
 * and registers them with the FontFace API, which page CSP `font-src` rules do not block. The
 * family names are our own, so the faces never change how the page renders its own text.
 */
export const FONTS_MESSAGE = "emojisense/fonts";

export interface FontFile {
  family: string;
  /** Path inside the extension package. */
  file: string;
  weight: string;
  unicodeRange: string;
}

/** A font file with its bytes, base64-encoded (extension messages are JSON). */
export interface FontPayload extends FontFile {
  data: string;
}

/** The subsets of fontsource's latin and latin-ext files; Turkish needs both. */
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

export const PICKER_BODY_FAMILY = "Emojisense Hanken Grotesk";
export const PICKER_MONO_FAMILY = "Emojisense DM Mono";

export const PICKER_FONTS: readonly FontFile[] = [
  {
    family: PICKER_BODY_FAMILY,
    file: "fonts/hanken-grotesk-latin-wght-normal.woff2",
    weight: "100 900",
    unicodeRange: LATIN,
  },
  {
    family: PICKER_BODY_FAMILY,
    file: "fonts/hanken-grotesk-latin-ext-wght-normal.woff2",
    weight: "100 900",
    unicodeRange: LATIN_EXT,
  },
  {
    family: PICKER_MONO_FAMILY,
    file: "fonts/dm-mono-latin-400-normal.woff2",
    weight: "400",
    unicodeRange: LATIN,
  },
];

export function isFontsRequest(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === FONTS_MESSAGE;
}

/** The bytes from a reply, with the descriptors from PICKER_FONTS: a reply cannot add families. */
export function parseFontsResponse(value: unknown): FontPayload[] {
  const fonts: unknown = (value as { fonts?: unknown } | null)?.fonts;
  if (!Array.isArray(fonts)) return [];
  return PICKER_FONTS.flatMap((known) => {
    const match = fonts.find(
      (font): font is { data: string } =>
        typeof font === "object" &&
        font !== null &&
        font.file === known.file &&
        typeof font.data === "string",
    );
    return match ? [{ ...known, data: match.data }] : [];
  });
}
