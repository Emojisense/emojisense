/**
 * Live photo → emoji for "Try your own photo": downscale in the browser, then one call to
 * `POST /v1/classify-image` (docs/API.md). No image hash is sent, so nothing is cached.
 */
import { API_URL, PUBLISHABLE_KEY } from "../../config";

export interface Reaction {
  emoji: string;
  id: string;
}

export interface PhotoReading {
  caption: string;
  /** What a person would likely say in chat. Empty when there is none. */
  reaction: string;
  results: Reaction[];
}

export type ClassifyOutcome =
  | { ok: true; reading: PhotoReading; ms: number }
  | { ok: false; message: string };

/** The API expects clients to send about 384 px on the long edge (max 256 KB). */
export const MAX_EDGE = 384;
const JPEG_QUALITY = 0.85;
const TIMEOUT_MS = 20_000;

export const UNREADABLE = "This file is not a photo we can read. Try a JPEG, PNG or WebP.";
const UNAVAILABLE = "Photo reactions are not available right now.";

const STATUS_MESSAGES: Record<number, string> = {
  400: UNREADABLE,
  413: "This photo is too large to send.",
  429: "Too many photos at once. Wait a few seconds, then try again.",
};

/** Decodes any image the browser can read and re-encodes it as a small JPEG. Throws if unreadable. */
export async function downscale(file: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    ),
  );
}

function readReading(body: unknown): PhotoReading | undefined {
  const value = body as Partial<PhotoReading> | null;
  if (!value || typeof value.caption !== "string" || !value.caption || !Array.isArray(value.results)) {
    return undefined;
  }
  return {
    caption: value.caption,
    reaction: typeof value.reaction === "string" ? value.reaction : "",
    results: value.results.filter(
      (r): r is Reaction => typeof r?.emoji === "string" && typeof r?.id === "string",
    ),
  };
}

/** Never throws: every failure becomes a calm message the UI can show. */
export async function classifyPhoto(image: Blob, signal: AbortSignal, limit = 8): Promise<ClassifyOutcome> {
  const started = performance.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const abort = () => timeout.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const params = new URLSearchParams({ key: PUBLISHABLE_KEY, limit: String(limit), locale: "en" });
    const response = await fetch(`${API_URL}/v1/classify-image?${params}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: image,
      signal: timeout.signal,
    });
    if (!response.ok) return { ok: false, message: STATUS_MESSAGES[response.status] ?? UNAVAILABLE };
    const body = (await response.json()) as { overLimit?: boolean };
    if (body.overLimit) return { ok: false, message: "The demo has used its photo budget for this month." };
    const reading = readReading(body);
    if (!reading) return { ok: false, message: UNAVAILABLE };
    return { ok: true, reading, ms: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, message: UNAVAILABLE };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
