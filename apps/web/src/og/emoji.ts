/**
 * Emoji art for the share cards: Noto Emoji at the commit the API's hosted "noto" set pins,
 * embedded as data: URIs. Never the system emoji font (Apple's art may not be redistributed).
 *
 * Noto's own PNG renderings are used where they exist: some of its SVGs keep hidden layers and art
 * outside the view box, which resvg draws. Flags have no PNGs; their SVGs are simple. Each runtime
 * supplies the fetch and its cache.
 */
import { notoEmojiPath, notoEmojiPngPath, notoEmojiUrl } from "@emojisense/platform/noto-emoji";
import type { EmojiImages } from "./text/layout";

/** The same cap as the API's hosted sets route. */
const MAX_BYTES = 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Fetches a file by URL; undefined when it does not exist. */
export type AssetFetcher = (url: string) => Promise<Uint8Array | undefined>;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length <= MAX_BYTES && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

export function isSvg(bytes: Uint8Array): boolean {
  if (bytes.length > MAX_BYTES) return false;
  return /<svg[\s>]/.test(new TextDecoder().decode(bytes.subarray(0, 2048)));
}

export class NotoEmoji implements EmojiImages {
  private readonly uris = new Map<string, Promise<string | undefined>>();

  constructor(private readonly fetchAsset: AssetFetcher) {}

  /** `size` is the largest size the emoji is drawn at, in px. */
  dataUri(emoji: string, size = 128): Promise<string | undefined> {
    const pngSize = size > 128 ? 512 : 128;
    const key = `${emoji}@${pngSize}`;
    let uri = this.uris.get(key);
    if (!uri) {
      uri = this.load(emoji, pngSize);
      this.uris.set(key, uri);
    }
    return uri;
  }

  private async load(emoji: string, size: 128 | 512): Promise<string | undefined> {
    const png = notoEmojiPngPath(emoji, size);
    if (png) {
      const bytes = await this.fetchAsset(notoEmojiUrl(png));
      return bytes && isPng(bytes) ? `data:image/png;base64,${toBase64(bytes)}` : undefined;
    }
    const bytes = await this.fetchAsset(notoEmojiUrl(notoEmojiPath(emoji)));
    return bytes && isSvg(bytes) ? `data:image/svg+xml;base64,${toBase64(bytes)}` : undefined;
  }
}
