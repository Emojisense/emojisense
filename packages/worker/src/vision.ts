import { VISION_MODEL } from "./config.ts";
import type { AiBinding } from "./env.ts";

export interface ImageLabel {
  /** Literal description, e.g. "a puppy asleep on a sofa". */
  caption: string;
  /** How a person would react in chat, e.g. "aww, so cute". */
  reaction: string;
  /** 3–6 short search words for the main things in the image, most important first. */
  keywords: string[];
  /** Emoji the vision model proposes, best first. Only ones the catalog knows are kept. */
  emoji: string[];
}

export type ImageType = "image/jpeg" | "image/webp";

const MAX_CAPTION_CHARS = 200;
const MAX_REACTION_CHARS = 100;
const MAX_KEYWORD_CHARS = 32;
export const MAX_KEYWORDS = 6;
export const MAX_PROPOSED_EMOJI = 8;

/** Bump VISION_PROMPT_VERSION (config.ts) whenever this prompt or the schema changes. */
const SYSTEM_PROMPT =
  "You label images for an emoji picker. Answer with JSON only: " +
  '{"caption": a literal description of the image in at most 12 English words, ' +
  '"reaction": what a person would most likely say in chat when they see it, in at most 6 English words, ' +
  '"keywords": 3 to 6 short English search words for the main things in the image, most important first, ' +
  '"emoji": up to 8 single emoji that fit the image best, best first: first what the image shows, then the most likely reaction}.';

const LABEL_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string" },
    reaction: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    emoji: { type: "array", items: { type: "string" } },
  },
  required: ["caption", "reaction", "keywords", "emoji"],
  additionalProperties: false,
};

/** The declared type must be JPEG or WebP, and the bytes must agree. */
export function sniffImage(bytes: Uint8Array): ImageType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return undefined;
}

export function toBase64(bytes: Uint8Array): string {
  // String.fromCharCode takes its bytes as arguments; chunks keep the call under the arg limit.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Distinct non-empty strings from an array (anything else is ignored), at most `max`. */
function cleanList(value: unknown, maxItems: number, maxChars: number, fold = false): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    const text = clean(item, maxChars);
    if (text) out.add(fold ? text.toLowerCase() : text);
    if (out.size === maxItems) break;
  }
  return [...out];
}

/**
 * Reads the label from the chat-completions output (or a bare `response`). The caption is
 * required; keywords and emoji may be missing or empty. `known` maps each proposed emoji to the
 * catalog emoji it stands for (several for "🐶🐕"); emoji it does not know are dropped.
 */
export function parseLabel(output: unknown, known: (text: string) => string[]): ImageLabel {
  const result = output as {
    choices?: { message?: { content?: unknown } }[];
    response?: unknown;
  };
  const content = result?.choices?.[0]?.message?.content ?? result?.response;
  const value: unknown =
    typeof content === "string"
      ? JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""))
      : content;
  const label = value as Record<string, unknown> | undefined;
  const caption = clean(label?.caption, MAX_CAPTION_CHARS);
  if (!caption) throw new Error("vision model returned no caption");
  const emoji = new Set(cleanList(label?.emoji, 2 * MAX_PROPOSED_EMOJI, 64).flatMap(known));
  return {
    caption,
    reaction: clean(label?.reaction, MAX_REACTION_CHARS),
    keywords: cleanList(label?.keywords, MAX_KEYWORDS, MAX_KEYWORD_CHARS, true),
    emoji: [...emoji].slice(0, MAX_PROPOSED_EMOJI),
  };
}

/** One Workers AI call. The image goes inline as a data URI and is not kept anywhere. */
export async function describeImage(
  ai: AiBinding | undefined,
  bytes: Uint8Array,
  type: ImageType,
  known: (text: string) => string[],
): Promise<ImageLabel> {
  if (!ai) throw new Error("AI binding missing");
  const output = await ai.run(VISION_MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Label this image." },
          { type: "image_url", image_url: { url: `data:${type};base64,${toBase64(bytes)}` } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "image_label", strict: true, schema: LABEL_SCHEMA },
    },
    // ≈ 20 caption + 10 reaction + 20 keyword + 30 emoji tokens + JSON syntax, with headroom.
    max_completion_tokens: 192,
    temperature: 0.2,
    // Captioning needs no reasoning; thinking tokens would only add latency and cost.
    chat_template_kwargs: { enable_thinking: false },
  });
  return parseLabel(output, known);
}
