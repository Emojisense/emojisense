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
  /** What the vision model saw, 3–6 words or short phrases. Absent or empty when there are none. */
  keywords?: string[];
  results: Reaction[];
}

export type ClassifyOutcome =
  | { ok: true; reading: PhotoReading; ms: number }
  | { ok: false; reason: ClassifyFailure; message: string };

/** Why a photo got no reactions; the demo says it in the page's language (demos.photo.errors). */
export type ClassifyFailure = "unreadable" | "unavailable" | "tooLarge" | "tooMany" | "budget";

/** The API expects clients to send about 384 px on the long edge (max 256 KB). */
export const MAX_EDGE = 384;
const JPEG_QUALITY = 0.85;
const TIMEOUT_MS = 20_000;

/** English messages (the playground); the demo says the reason in the page's language. */
export const FAILURE_MESSAGES: Record<ClassifyFailure, string> = {
  unreadable: "This file is not a photo we can read. Try a JPEG, PNG or WebP.",
  unavailable: "Photo reactions are not available right now.",
  tooLarge: "This photo is too large to send.",
  tooMany: "Too many photos at once. Wait a few seconds, then try again.",
  budget: "The demo has used its photo budget for this month.",
};
export const UNREADABLE = FAILURE_MESSAGES.unreadable;

const failure = (reason: ClassifyFailure) => ({
  ok: false as const,
  reason,
  message: FAILURE_MESSAGES[reason],
});

const STATUS_FAILURES: Record<number, ClassifyFailure> = {
  400: "unreadable",
  413: "tooLarge",
  429: "tooMany",
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
    keywords: Array.isArray(value.keywords)
      ? [...new Set(value.keywords.filter((k): k is string => typeof k === "string" && k.trim() !== ""))]
      : [],
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
    if (!response.ok) return failure(STATUS_FAILURES[response.status] ?? "unavailable");
    const body = (await response.json()) as { overLimit?: boolean };
    if (body.overLimit) return failure("budget");
    const reading = readReading(body);
    if (!reading) return failure("unavailable");
    return { ok: true, reading, ms: Math.round(performance.now() - started) };
  } catch {
    return failure("unavailable");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
