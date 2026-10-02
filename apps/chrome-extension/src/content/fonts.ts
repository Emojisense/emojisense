import { parseFontsResponse } from "../shared/fonts";

/**
 * Registers the picker fonts in this document, once. The returned function never rejects:
 * without the fonts the picker falls back to the system font.
 */
export function createFontLoader(doc: Document, request: () => Promise<unknown>): () => Promise<void> {
  let loading: Promise<void> | undefined;
  return () => {
    loading ??= install(doc, request).catch(() => undefined);
    return loading;
  };
}

async function install(doc: Document, request: () => Promise<unknown>): Promise<void> {
  const FontFaceClass = doc.defaultView?.FontFace;
  if (!FontFaceClass || !doc.fonts) return;
  const fonts = parseFontsResponse(await request());
  // A copy of the content script from before an extension reload may have added them already.
  const present = new Set([...doc.fonts].map((face) => face.family.replace(/["']/g, "")));
  const faces: FontFace[] = [];
  for (const font of fonts) {
    if (present.has(font.family)) continue;
    const face = new FontFaceClass(font.family, fromBase64(font.data), {
      weight: font.weight,
      unicodeRange: font.unicodeRange,
      display: "swap",
    });
    doc.fonts.add(face);
    faces.push(face);
  }
  await Promise.allSettled(faces.map((face) => face.load()));
}

function fromBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
