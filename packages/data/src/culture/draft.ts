/**
 * Turning a model's answer into a draft culture record: the prompt parts, the answer schema, the
 * emoji the model may choose from, and the draft itself. Shared by culture:propose and the API
 * Worker's nightly proposal job. No file access.
 */
import { type AliasEngine, type CultureWhen, normalize } from "emojisense";
import type { CultureRecord, RecordSource } from "./types.ts";
import { LIMITS } from "./validate.ts";

/** What a prompt asks the model to return. Fields beyond `skip` are optional in older prompts. */
export interface DraftAnswer {
  skip?: boolean;
  reason?: string;
  /** Prompt v2: a lowercase English slug for the entry id. */
  id?: string;
  /** Prompt v2, search trends only: "lasting" or "event". */
  kind?: string;
  /** Prompt v2, events from search trends: days the moment stays relevant. */
  days?: number;
  context?: Record<string, string>;
  triggers?: Record<string, string[]>;
  emoji?: { hexcode: string; weight: number }[];
}

/** Everything about a draft that the source decides, not the model. */
export interface DraftCandidate {
  id: string;
  kind: CultureRecord["kind"];
  when: CultureWhen;
  regions: string[];
  locales: string[];
  featured: boolean;
  source: RecordSource;
}

export interface EmojiOption {
  hexcode: string;
  emoji: string;
  label: string;
}

/** Most emoji listed for the model; it may only choose from them. */
export const MAX_EMOJI_OPTIONS = 40;
/** Most triggers a draft keeps per locale. */
export const MAX_DRAFT_TRIGGERS = 8;

/** The SYSTEM and USER parts of a prompt file (culture/prompts/propose.v<N>.md). */
export function splitPrompt(text: string): { system: string; user: string } {
  const system = text.split("## SYSTEM")[1]?.split("## USER")[0]?.trim() ?? "";
  const user = text.split("## USER")[1]?.trim() ?? "";
  if (!system || !user) throw new Error('a culture prompt needs "## SYSTEM" and "## USER" parts');
  return { system, user };
}

/** Replaces each `{{NAME}}` with its value; unknown placeholders stay as they are. */
export function fillPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, name: string) => values[name] ?? match);
}

/**
 * Emoji the model may choose from: the source's hints, then what the alias engine finds for each
 * text, in that order, only ones the catalog has.
 */
export function candidateEmoji(
  engine: AliasEngine,
  catalog: ReadonlyMap<string, string>,
  hintEmoji: readonly string[],
  searchTexts: readonly string[],
  locale?: string,
): EmojiOption[] {
  const ids = [...hintEmoji];
  for (const text of searchTexts) {
    if (!text) continue;
    const search = { limit: 12, prefix: false, culture: false, ...(locale ? { locale } : {}) };
    for (const r of engine.search(text, search).results) ids.push(r.id);
  }
  return [...new Set(ids)]
    .filter((id) => catalog.has(id))
    .slice(0, MAX_EMOJI_OPTIONS)
    .map((id) => ({
      hexcode: id,
      emoji: catalog.get(id) as string,
      label: engine.get(id)?.labels[locale ?? "en"] ?? engine.get(id)?.labels.en ?? "",
    }));
}

/** The candidate list as the prompt shows it: "hexcode emoji name" per line. */
export const formatEmojiOptions = (options: readonly EmojiOption[]) =>
  options.map((o) => `${o.hexcode} ${o.emoji} ${o.label}`).join("\n");

/**
 * The JSON schema of a prompt v2 answer for these locales (Workers AI `response_format`): every
 * key is listed, so the model can answer in strict mode.
 */
export function answerSchema(locales: readonly string[]): Record<string, unknown> {
  const contextLocales = [...new Set(["en", ...locales])];
  const strings = (keys: readonly string[], item: Record<string, unknown>) => ({
    type: "object",
    properties: Object.fromEntries(keys.map((k) => [k, item])),
    required: [...keys],
    additionalProperties: false,
  });
  return {
    type: "object",
    properties: {
      skip: { type: "boolean" },
      reason: { type: "string" },
      id: { type: "string" },
      kind: { type: "string", enum: ["lasting", "event"] },
      days: { type: "integer" },
      context: strings(contextLocales, { type: "string" }),
      triggers: strings(locales, { type: "array", items: { type: "string" } }),
      emoji: {
        type: "array",
        items: {
          type: "object",
          properties: { hexcode: { type: "string" }, weight: { type: "number" } },
          required: ["hexcode", "weight"],
          additionalProperties: false,
        },
      },
    },
    required: ["skip", "reason", "id", "kind", "days", "context", "triggers", "emoji"],
    additionalProperties: false,
  };
}

/**
 * The answer object of a Workers AI text model: `response` (string or object) or the
 * chat-completions `choices[0].message.content`. Code fences and prose around the JSON are cut.
 */
export function parseModelAnswer(output: unknown): DraftAnswer {
  const result = output as { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null;
  const content = result?.choices?.[0]?.message?.content ?? result?.response;
  if (content === undefined || content === null) return { skip: true, reason: "empty answer" };
  if (typeof content !== "string") return content as DraftAnswer;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("the answer holds no JSON object");
  return JSON.parse(content.slice(start, end + 1)) as DraftAnswer;
}

/**
 * A draft record from a candidate and the model's answer. Triggers are normalized and capped,
 * emoji outside `allowed` are dropped, weights are clamped to (0, 1]. The result still needs
 * `validateRecord`: the model's text is not trusted.
 */
export function toDraftRecord(
  candidate: DraftCandidate,
  answer: DraftAnswer,
  allowed: ReadonlySet<string>,
  meta: { createdBy: string; createdAt: string },
): CultureRecord {
  const { locales } = candidate;
  const triggers = Object.fromEntries(
    locales
      .map((l) => {
        const list = Array.isArray(answer.triggers?.[l]) ? (answer.triggers?.[l] as unknown[]) : [];
        const normalized = list.filter((t): t is string => typeof t === "string").map((t) => normalize(t));
        return [l, [...new Set(normalized.filter(Boolean))].slice(0, MAX_DRAFT_TRIGGERS)] as const;
      })
      .filter(([, list]) => list.length > 0),
  );
  const context = Object.fromEntries(
    [...new Set(["en", ...locales])].flatMap((l) => {
      const text = answer.context?.[l];
      return typeof text === "string" && text.trim() ? [[l, text.trim()]] : [];
    }),
  );
  const emoji = (Array.isArray(answer.emoji) ? answer.emoji : [])
    .filter((e) => typeof e?.hexcode === "string" && allowed.has(e.hexcode))
    .map((e) => ({ hexcode: e.hexcode, weight: Math.min(1, Math.max(0.05, Number(e.weight) || 0.5)) }))
    .filter((e, i, all) => all.findIndex((x) => x.hexcode === e.hexcode) === i)
    .slice(0, LIMITS.emojiMax);
  return {
    id: candidate.id,
    status: "draft",
    kind: candidate.kind,
    context,
    when: candidate.when,
    regions: candidate.regions,
    locales,
    triggers,
    emoji,
    ...(candidate.featured && (candidate.kind === "seasonal" || candidate.kind === "event")
      ? { featured: true }
      : {}),
    source: candidate.source,
    createdBy: meta.createdBy,
    createdAt: meta.createdAt,
  };
}
