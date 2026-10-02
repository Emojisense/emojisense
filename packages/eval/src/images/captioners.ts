import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { Photo } from "./labels.ts";

/** What the vision step returns; both texts then go through normal text search. */
export interface Caption {
  /** What is in the photo, a few words ("a puppy asleep on a sofa"). */
  caption: string;
  /** The likely chat reaction ("aww, so cute"). */
  reaction: string;
}

export interface Captioner {
  readonly name: string;
  caption(photo: Photo): Promise<Caption>;
}

/**
 * Captions written beforehand, one entry per file: `{"dog-sofa.jpg": {"caption": "…",
 * "reaction": "…"}}`. Lets the owner compare any vision model (run elsewhere) offline.
 */
export function sidecarCaptioner(path: string): Captioner {
  if (!existsSync(path)) {
    throw new Error(`${path} not found. Write it (photos/README.md) or use --captioner workers-ai`);
  }
  const captions = JSON.parse(readFileSync(path, "utf8")) as Record<string, Partial<Caption>>;
  return {
    name: `sidecar ${basename(path)}`,
    async caption(photo) {
      const entry = captions[photo.label.file];
      if (!entry) throw new Error(`no caption for ${photo.label.file} in ${basename(path)}`);
      return { caption: entry.caption ?? "", reaction: entry.reaction ?? "" };
    },
  };
}

/**
 * Smoke test only: the file name as the caption ("dog-sofa.jpg" → "dog sofa"). It checks the
 * harness end to end without a model; its recall says nothing about a real captioner.
 */
export function filenameCaptioner(): Captioner {
  return {
    name: "file name (smoke test)",
    async caption(photo) {
      const stem = basename(photo.label.file, extname(photo.label.file));
      return { caption: stem.replace(/[-_]+/g, " "), reaction: "" };
    },
  };
}

const PROMPT =
  "Describe this photo in at most 8 words. Then give the most likely short chat reaction to it. " +
  "Answer exactly in this form: caption: <words> | reaction: <words>";

/** Split "caption: … | reaction: …"; a free-form answer becomes the caption. */
export function parseCaptionAnswer(text: string): Caption {
  const match = /caption:\s*(.*?)\s*\|\s*reaction:\s*(.*)/is.exec(text);
  if (match) return { caption: (match[1] ?? "").trim(), reaction: (match[2] ?? "").trim() };
  return { caption: text.trim(), reaction: "" };
}

/**
 * Workers AI image-to-text (needs `wrangler login`). The default model takes
 * `{ image: number[], prompt, max_tokens }` and returns `{ description }`; check the model card
 * before switching models, since vision models differ in input shape.
 */
export function workersAiCaptioner(
  model: string,
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>,
): Captioner {
  return {
    name: `workers-ai ${model}`,
    async caption(photo) {
      const image = [...readFileSync(photo.path)];
      const output = (await run(model, { image, prompt: PROMPT, max_tokens: 64 })) as {
        description?: string;
        response?: string;
      };
      return parseCaptionAnswer(output.description ?? output.response ?? "");
    },
  };
}
