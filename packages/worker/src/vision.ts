import { VISION_MODEL } from "./config.ts";
import type { AiBinding } from "./env.ts";

export interface ImageLabel {
  /** Literal description, e.g. "a puppy asleep on a sofa". */
  caption: string;
  /** How a person would react in chat, e.g. "aww, so cute". */
  reaction: string;
}

export type ImageType = "image/jpeg" | "image/webp";

const MAX_CAPTION_CHARS = 200;
const MAX_REACTION_CHARS = 100;

const SYSTEM_PROMPT =
  "You label images for an emoji picker. Answer with JSON only: " +
  '{"caption": a literal description of the image in at most 12 English words, ' +
  '"reaction": what a person would most likely say in chat when they see it, in at most 6 English words}.';

const LABEL_SCHEMA = {
  type: "object",
  properties: { caption: { type: "string" }, reaction: { type: "string" } },
  required: ["caption", "reaction"],
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

/** Reads `{caption, reaction}` from the chat-completions output (or a bare `response`). */
export function parseLabel(output: unknown): ImageLabel {
  const result = output as {
    choices?: { message?: { content?: unknown } }[];
    response?: unknown;
  };
  const content = result?.choices?.[0]?.message?.content ?? result?.response;
  const value: unknown =
    typeof content === "string"
      ? JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""))
      : content;
  const label = value as Partial<ImageLabel> | undefined;
  const caption = clean(label?.caption, MAX_CAPTION_CHARS);
  if (!caption) throw new Error("vision model returned no caption");
  return { caption, reaction: clean(label?.reaction, MAX_REACTION_CHARS) };
}

/** One Workers AI call. The image goes inline as a data URI and is not kept anywhere. */
export async function describeImage(
  ai: AiBinding | undefined,
  bytes: Uint8Array,
  type: ImageType,
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
    max_completion_tokens: 96,
    temperature: 0.2,
    // Captioning needs no reasoning; thinking tokens would only add latency and cost.
    chat_template_kwargs: { enable_thinking: false },
  });
  return parseLabel(output);
}
