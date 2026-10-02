import { inspectEmojiImage } from "../src/emoji-image.js";

const encoder = new TextEncoder();

export const IMAGES = {
  png: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  gif: encoder.encode("GIF89a\u0001\u0000\u0001\u0000"),
  webp: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]),
  svg: encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle r="4"/></svg>'),
};

export const svg = (body: string) =>
  encoder.encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">${body}</svg>`);

/** A checked PNG, ready for createCustomEmoji. */
export function pngImage() {
  const checked = inspectEmojiImage(IMAGES.png);
  if (!checked.ok) throw new Error(checked.message);
  return checked.image;
}
