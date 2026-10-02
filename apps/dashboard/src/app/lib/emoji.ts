import { CUSTOM_EMOJI_CONTENT_TYPES, CUSTOM_EMOJI_MAX_BYTES } from "@emojisense/platform";
import { ApiError, errorMessage } from "../api";

/** Upload rules from the contract. The API checks them again; these give an answer before upload. */
export const ACCEPTED_TYPES = CUSTOM_EMOJI_CONTENT_TYPES;
export const MAX_IMAGE_BYTES = CUSTOM_EMOJI_MAX_BYTES;
const MAX_IMAGE_KB = MAX_IMAGE_BYTES / 1024;
export const SHORTCODE_PATTERN = /^[a-z0-9_+-]{1,64}$/;

export interface FieldError {
  message: string;
  field?: string;
}

/** "Ship it!.png" → "ship_it" */
export function toShortcode(text: string): string {
  return text
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_+-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function parseAliases(text: string): string[] {
  const seen = new Set<string>();
  for (const alias of text.split(",")) {
    const clean = alias.trim().toLowerCase().replace(/\s+/g, " ");
    if (clean) seen.add(clean.slice(0, 64));
  }
  return [...seen];
}

export function fileProblem(file: File): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name} is not a PNG, GIF, WebP or SVG image.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name} is ${Math.ceil(file.size / 1024)} KB. The limit is ${MAX_IMAGE_KB} KB.`;
  }
  return null;
}

/**
 * A failed upload as a form error. `image_too_large` (and a bare 413 from a proxy, which has no
 * JSON code) names the file, so the right image of a multi-file upload gets the blame.
 */
export function uploadError(error: unknown, file: File): FieldError {
  if (!(error instanceof ApiError)) return { message: errorMessage(error) };
  if (error.code === "image_too_large" || error.status === 413) {
    return { field: "file", message: `${file.name} is too large. The limit is ${MAX_IMAGE_KB} KB.` };
  }
  return { message: error.message, field: error.field };
}

export function shortcodeProblem(shortcode: string): string | null {
  if (!shortcode) return "Add a shortcode, like ship_it.";
  if (!SHORTCODE_PATTERN.test(shortcode)) {
    return "Use 1–64 lowercase letters, digits, _ + or -.";
  }
  return null;
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}
