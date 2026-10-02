import { type FontPayload, PICKER_FONTS } from "../shared/fonts";

/**
 * The picker fonts with their bytes, read from the extension package once per worker life.
 * `read` returns a packaged file (chrome.runtime.getURL + fetch in the worker).
 */
export function createFontSource(read: (file: string) => Promise<ArrayBuffer>): () => Promise<FontPayload[]> {
  let fonts: Promise<FontPayload[]> | undefined;
  return () => {
    if (!fonts) {
      const reading = Promise.all(
        PICKER_FONTS.map(async (font) => ({ ...font, data: toBase64(await read(font.file)) })),
      );
      fonts = reading;
      reading.catch(() => {
        if (fonts === reading) fonts = undefined;
      });
    }
    return fonts;
  };
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunks keep the argument list of String.fromCharCode short.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
