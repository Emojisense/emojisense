/**
 * Checks of custom emoji images, for the dashboard upload, the imports and the tenants API:
 * size, type by magic bytes (the declared type and the file name are never trusted), and SVG
 * checks. SVGs that could run code or load other resources are rejected, not rewritten: a
 * rewrite can be bypassed, a rejection fails closed.
 */
import type { CustomEmojiContentType } from "./types.js";

export const CUSTOM_EMOJI_MAX_BYTES = 256 * 1024;

export type EmojiImageExtension = "png" | "gif" | "webp" | "svg";

export interface EmojiImage {
  bytes: Uint8Array;
  contentType: CustomEmojiContentType;
  extension: EmojiImageExtension;
}

export type EmojiImageErrorCode = "missing_file" | "image_too_large" | "unsupported_image" | "unsafe_svg";

/** `status` is the HTTP status both Workers answer with; `error` is the code. */
export type ImageCheck =
  | { ok: true; image: EmojiImage }
  | { ok: false; error: EmojiImageErrorCode; status: 400 | 413 | 415; field: "file"; message: string };

const refused = (error: EmojiImageErrorCode, status: 400 | 413 | 415, message: string): ImageCheck => ({
  ok: false,
  error,
  status,
  field: "file",
  message,
});

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/** The SVG root may follow a BOM, an XML declaration, comments, a DOCTYPE and whitespace. */
const SVG_START = /^﻿?\s*(<\?xml[^>]*\?>\s*)?((<!--[\s\S]*?-->|<!doctype[^>[]*>)\s*)*<svg[\s/>]/i;

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** The image type from the file's first bytes, or undefined for anything else. */
export function sniffEmojiImage(
  bytes: Uint8Array,
): { contentType: CustomEmojiContentType; extension: EmojiImageExtension } | undefined {
  if (startsWith(bytes, PNG)) return { contentType: "image/png", extension: "png" };
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89))
    return { contentType: "image/gif", extension: "gif" };
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return { contentType: "image/webp", extension: "webp" };
  }
  const text = decodeUtf8(bytes.subarray(0, 1024));
  // A cut multi-byte character at the end of the window is fine; the full check comes later.
  const head = text ?? new TextDecoder().decode(bytes.subarray(0, 1024));
  if (SVG_START.test(head)) return { contentType: "image/svg+xml", extension: "svg" };
  return undefined;
}

const NAMED_ENTITIES: Record<string, string> = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  lpar: "(",
  rpar: ")",
  sol: "/",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Character references are decoded first, so `&#106;avascript:` is seen as `javascript:`. */
function decodeReferences(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, ref: string) => {
    if (ref[0] !== "#") return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
    const code = ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

const unquote = (value: string) => value.replace(/^["']|["']$/g, "").trim();

/** A fragment link, or an embedded raster image (which cannot carry script). */
const isInternalReference = (value: string) =>
  value.startsWith("#") || /^data:image\/(png|gif|jpe?g|webp)[;,]/.test(value);

/**
 * An XML name prefix (`svg:`, `x:`, …). XML lets any prefix stand for the SVG, XHTML or XLink
 * namespace, so `<x:script xmlns:x="http://www.w3.org/2000/svg">` is a script element and
 * `x:href` with `xmlns:x="http://www.w3.org/1999/xlink"` is a link: names match with any prefix.
 * Prefixes may use non-ASCII letters, so anything up to the colon counts.
 */
const PREFIX = String.raw`(?:[^\s<>/=:"']+:)?`;
const FORBIDDEN_ELEMENTS = new RegExp(
  `<${PREFIX}(script|foreignobject|iframe|embed|object|html|body|meta|link|base|handler|listener)\\b`,
);
/** `<?xml-stylesheet?>` can attach XSLT or CSS, inside the file or outside it. */
const STYLESHEET_INSTRUCTION = /<\?xml-stylesheet\b/;
const EVENT_ATTRIBUTE = /[\s"'/]on[a-z]+\s*=/;
const LINK_ATTRIBUTE = new RegExp(`[\\s"'/]${PREFIX}href\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "g");
const SOURCE_ATTRIBUTE = /[\s"'/]src\s*=/;
const ANIMATED_LINK = new RegExp(`attributename\\s*=\\s*["']?${PREFIX}href`);
const CSS_URL = /url\(\s*([^)]*)\)/g;

/**
 * Why an SVG is unsafe to serve, or undefined when it is safe. Blocks scripts, event handler
 * attributes, `javascript:` URLs, links and `url()` references outside the document, DTDs
 * (entity expansion) and embedded documents.
 */
export function checkSvg(svg: string): string | undefined {
  const text = decodeReferences(svg).toLowerCase();
  const compact = text.replace(/[\s\p{Cc}]+/gu, "");
  if (FORBIDDEN_ELEMENTS.test(text)) return "SVG files cannot contain scripts or embedded documents.";
  if (STYLESHEET_INSTRUCTION.test(text)) return "SVG files cannot attach style sheets.";
  if (/<!entity|<!doctype[^>]*\[/.test(text)) return "SVG files cannot declare entities.";
  if (EVENT_ATTRIBUTE.test(text)) return "SVG files cannot contain event handler attributes (on…=).";
  if (/(java|vb)script:/.test(compact)) return "SVG files cannot contain javascript: URLs.";
  for (const [, value = ""] of text.matchAll(LINK_ATTRIBUTE)) {
    if (!isInternalReference(unquote(value))) {
      return 'SVG files can only link to elements inside the file (href="#…").';
    }
  }
  if (SOURCE_ATTRIBUTE.test(text) || ANIMATED_LINK.test(text)) {
    return "SVG files cannot load or animate external resources.";
  }
  if (text.includes("@import")) return "SVG files cannot import style sheets.";
  for (const [, value = ""] of text.matchAll(CSS_URL)) {
    if (!isInternalReference(unquote(value))) {
      return "SVG files can only use url(#…) references inside the file.";
    }
  }
  return undefined;
}

/**
 * Checks an uploaded or imported image and returns it with its real type, or why it is refused:
 * an empty or oversized file, an unsupported type, or an unsafe SVG.
 */
export function inspectEmojiImage(bytes: Uint8Array): ImageCheck {
  if (bytes.byteLength === 0) return refused("missing_file", 400, "The image file is empty.");
  if (bytes.byteLength > CUSTOM_EMOJI_MAX_BYTES) {
    return refused("image_too_large", 413, `The image is larger than ${CUSTOM_EMOJI_MAX_BYTES / 1024} KB.`);
  }
  const type = sniffEmojiImage(bytes);
  if (!type) return refused("unsupported_image", 415, "Upload a PNG, GIF, WebP or SVG image.");
  if (type.contentType === "image/svg+xml") {
    const svg = decodeUtf8(bytes);
    if (svg === undefined) return refused("unsupported_image", 415, "The SVG file is not valid UTF-8.");
    const problem = checkSvg(svg);
    if (problem) return refused("unsafe_svg", 400, problem);
  }
  return { ok: true, image: { bytes, ...type } };
}
