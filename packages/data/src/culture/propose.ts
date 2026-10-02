/**
 * Draft culture entries with Workers AI. Writes `status: "draft"` files only; a person approves
 * them with culture:review.
 *
 *   tsx src/culture/propose.ts [--from YYYY-MM-DD] [--days 60] [--sources calendar,events,slang]
 *                              [--misses misses.jsonl --min-count 5] [--limit 10]
 *                              [--model @cf/...] [--prompt v1] [--provider workers-ai|none] [--dry-run]
 *
 * Inputs: culture/sources/*.json (holidays and events starting in [from, from + days], slang notes)
 * and, when given, an analytics export of misses ({"q","locale","n"} per line; only queries seen
 * at least --min-count times are used: rare strings can be personal). Existing entry ids are
 * skipped. The model may choose emoji only from a candidate list (source hints + what the alias
 * engine finds for the topic), so it cannot invent emoji. Needs `wrangler login` (or
 * CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID) and the built packs (pnpm data:build).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type AliasEngine, type CultureWhen, createEngine, localDay, normalize, type Pack } from "emojisense";
import { readPackConfig } from "../config.ts";
import { disposeEmbeddings, runWorkersAI } from "../embeddings.ts";
import { LOCALE_CODES } from "../locales.ts";
import { CULTURE_DIR, DATA_ROOT } from "../paths.ts";
import { loadCatalog } from "./catalog.ts";
import { addDays } from "./compile.ts";
import { loadExclusions } from "./exclusions.ts";
import { loadRecords, writeRecord } from "./records.ts";
import { type DatedSource, loadSources, occurrencesBetween, type SlangSource } from "./sources.ts";
import type { CultureRecord, RecordSource } from "./types.ts";
import { LIMITS, validateRecord } from "./validate.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    from: { type: "string" },
    days: { type: "string", default: "60" },
    sources: { type: "string", default: "calendar,events,slang" },
    misses: { type: "string" },
    "min-count": { type: "string", default: "5" },
    limit: { type: "string", default: "10" },
    // The repo's text model for data jobs (also used by miss mining).
    model: { type: "string", default: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    prompt: { type: "string", default: "v1" },
    provider: { type: "string", default: "workers-ai" },
    lead: { type: "string", default: "7" },
    "dry-run": { type: "boolean", default: false },
  },
});

interface Candidate {
  id: string;
  kind: CultureRecord["kind"];
  when: CultureWhen;
  regions: string[];
  locales: string[];
  featured: boolean;
  source: RecordSource;
  sourceKind: string;
  /** What the model and the reviewer see. */
  description: Record<string, unknown>;
  titles: Record<string, string>;
  phrases: Record<string, string[]>;
  hintEmoji: string[];
  searchTexts: string[];
}

const today = localDay();
const from = args.from ?? today;
const days = Number(args.days);
const lead = Number(args.lead);
const wanted = new Set((args.sources ?? "").split(",").filter(Boolean));
const existing = new Set(loadRecords().map((l) => l.record.id));
const catalog = loadCatalog();
const exclusions = loadExclusions();

const monthDay = (day: string) => day.slice(5);
const slug = (text: string) =>
  normalize(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "query";

function fromDated(source: DatedSource): Candidate[] {
  return occurrencesBetween(source, from, days).map((occurrence) => {
    // People start talking about a moment some days before it; event windows stay ≤ 60 days.
    const span = (Date.parse(occurrence.to) - Date.parse(occurrence.from)) / 86_400_000 + 1;
    const leadDays = Math.max(0, Math.min(lead, LIMITS.eventMaxDays - span));
    const start = addDays(occurrence.from, -leadDays);
    const when: CultureWhen = occurrence.yearly
      ? { from: monthDay(start), to: monthDay(occurrence.to), recurs: "yearly" }
      : { from: start, to: occurrence.to };
    const locales = source.locales.includes("*") ? [...LOCALE_CODES] : source.locales;
    return {
      id: occurrence.yearly ? source.id : `${source.id}-${occurrence.year}`,
      kind: occurrence.yearly ? "seasonal" : "event",
      when,
      regions: source.regions,
      locales,
      featured: true,
      source: "calendar",
      sourceKind: source.category === "sport" ? "sports event" : `${source.category} calendar day`,
      description: {
        title: source.title,
        days: `${occurrence.from} to ${occurrence.to}`,
        hint: source.hint,
        regions: source.regions,
      },
      titles: source.title,
      phrases: {},
      hintEmoji: source.emoji ?? [],
      searchTexts: [source.title.en ?? "", source.hint],
    };
  });
}

function fromSlang(source: SlangSource): Candidate {
  return {
    id: source.id,
    kind: "lasting",
    when: null,
    regions: source.regions,
    locales: Object.keys(source.phrases).filter((l) => LOCALE_CODES.includes(l)),
    featured: false,
    source: "ai-proposed",
    sourceKind: "meaning shift (slang note)",
    description: { meaning: source.meaning, phrases: source.phrases, note: source.note },
    titles: { en: source.meaning },
    phrases: source.phrases,
    hintEmoji: source.emoji,
    searchTexts: [source.meaning, ...Object.values(source.phrases).flat()],
  };
}

function fromMisses(path: string): Candidate[] {
  const minCount = Number(args["min-count"]);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { q: string; locale?: string; n: number })
    .filter((row) => row.n >= minCount && LOCALE_CODES.includes(row.locale ?? "en"))
    .map((row) => {
      const locale = row.locale ?? "en";
      const q = normalize(row.q);
      return {
        id: `miss-${locale}-${slug(q)}`,
        kind: "lasting" as const,
        when: null,
        regions: ["*"],
        locales: [locale],
        featured: false,
        source: "ai-proposed" as const,
        sourceKind: "search with no good result (aggregated analytics)",
        description: { query: q, locale, searches: row.n },
        titles: {},
        phrases: { [locale]: [q] },
        hintEmoji: [],
        searchTexts: [q],
      };
    });
}

const { dated, slang } = loadSources();
const candidates: Candidate[] = [
  ...dated.filter((s) => wanted.has(s.category === "sport" ? "events" : "calendar")).flatMap(fromDated),
  ...(wanted.has("slang") ? slang.map(fromSlang) : []),
  ...(args.misses ? fromMisses(args.misses) : []),
]
  .filter((c) => !existing.has(c.id))
  .slice(0, Number(args.limit));

const { packVersion } = readPackConfig();
const packDir = join(DATA_ROOT, "dist", "packs", packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`culture:propose: no packs in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}
const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const engine: AliasEngine = createEngine([readPack("en"), readPack("en.ext")]);

/** Emoji the model may choose from: the source's hints, then what the alias engine finds. */
function candidateEmoji(candidate: Candidate): { hexcode: string; emoji: string; label: string }[] {
  const ids = [...candidate.hintEmoji];
  for (const text of candidate.searchTexts) {
    for (const r of engine.search(text, { limit: 12, prefix: false, culture: false }).results) ids.push(r.id);
  }
  return [...new Set(ids)]
    .filter((id) => catalog.has(id))
    .slice(0, 40)
    .map((id) => ({ hexcode: id, emoji: catalog.get(id) as string, label: engine.get(id)?.labels.en ?? "" }));
}

const promptFile = join(CULTURE_DIR, "prompts", `propose.${args.prompt}.md`);
const promptText = readFileSync(promptFile, "utf8");
const system = promptText.split("## SYSTEM")[1]?.split("## USER")[0]?.trim() ?? "";
const user = promptText.split("## USER")[1]?.trim() ?? "";
if (!system || !user) throw new Error(`${promptFile} needs "## SYSTEM" and "## USER" parts`);

interface Answer {
  skip?: boolean;
  reason?: string;
  context?: Record<string, string>;
  triggers?: Record<string, string[]>;
  emoji?: { hexcode: string; weight: number }[];
}

async function ask(candidate: Candidate, options: ReturnType<typeof candidateEmoji>): Promise<Answer> {
  if (args.provider === "none") {
    // Offline draft from the source alone: titles as context and triggers, hint emoji.
    const weights = [0.8, 0.65, 0.5, 0.4, 0.35];
    return {
      context: candidate.titles,
      triggers: Object.fromEntries(
        candidate.locales.map((l) => [
          l,
          [...(candidate.phrases[l] ?? []), candidate.titles[l] ?? ""].filter(Boolean),
        ]),
      ),
      emoji: candidate.hintEmoji.slice(0, 5).map((hexcode, i) => ({ hexcode, weight: weights[i] ?? 0.3 })),
    };
  }
  const filled = user
    .replace("{{TODAY}}", today)
    .replace("{{SOURCE_KIND}}", candidate.sourceKind)
    .replace("{{SOURCE}}", JSON.stringify(candidate.description, null, 1))
    .replace("{{LOCALES}}", candidate.locales.join(", "))
    .replace("{{CANDIDATES}}", options.map((o) => `${o.hexcode} ${o.emoji} ${o.label}`).join("\n"));
  const output = (await runWorkersAI(args.model as string, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: filled },
    ],
    max_tokens: 1500,
    temperature: 0.2,
  })) as { response?: string | Answer };
  const raw = output.response;
  if (typeof raw !== "string") return raw ?? { skip: true, reason: "empty answer" };
  return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Answer;
}

function toRecord(candidate: Candidate, answer: Answer, allowed: Set<string>): CultureRecord {
  const locales = candidate.locales;
  const triggers = Object.fromEntries(
    locales
      .map((l) => [
        l,
        [...new Set((answer.triggers?.[l] ?? []).map((t) => normalize(t)).filter(Boolean))].slice(0, 8),
      ])
      .filter(([, list]) => (list as string[]).length > 0),
  );
  const context = Object.fromEntries(
    ["en", ...locales]
      .filter((l) => answer.context?.[l])
      .map((l) => [l, (answer.context?.[l] as string).trim()]),
  );
  const emoji = (answer.emoji ?? [])
    .filter((e) => allowed.has(e.hexcode))
    .map((e) => ({ hexcode: e.hexcode, weight: Math.min(1, Math.max(0.05, Number(e.weight) || 0.5)) }))
    .filter((e, i, all) => all.findIndex((x) => x.hexcode === e.hexcode) === i)
    .slice(0, LIMITS.emojiMax);
  const modelTag = args.provider === "none" ? "source-only" : `workers-ai:${args.model}`;
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
    ...(candidate.featured && candidate.kind !== "lasting" ? { featured: true } : {}),
    source: candidate.source,
    createdBy: `${modelTag} prompt:propose.${args.prompt}`,
    createdAt: today,
  };
}

console.log(`culture:propose: ${candidates.length} candidates from ${from} (+${days} days)`);
let written = 0;
try {
  for (const candidate of candidates) {
    const options = candidateEmoji(candidate);
    let answer: Answer;
    try {
      answer = await ask(candidate, options);
    } catch (error) {
      console.log(`✘ ${candidate.id}: no usable answer (${(error as Error).message})`);
      continue;
    }
    if (answer.skip) {
      console.log(`- ${candidate.id}: skipped by the model (${answer.reason ?? "no reason"})`);
      continue;
    }
    const allowed = new Set([...options.map((o) => o.hexcode), ...candidate.hintEmoji]);
    const record = toRecord(candidate, answer, allowed);
    const errors = validateRecord(record, { catalog, exclusions }).filter((i) => i.level === "error");
    if (errors.length > 0) {
      console.log(`✘ ${candidate.id}: draft not written, ${errors.map((e) => e.message).join("; ")}`);
      continue;
    }
    if (args["dry-run"]) {
      console.log(JSON.stringify(record, null, 2));
    } else {
      writeRecord(record);
      written++;
      console.log(`✔ ${candidate.id}: draft written`);
    }
  }
} finally {
  await disposeEmbeddings();
}
console.log(
  `culture:propose: ${written} drafts written${args["dry-run"] ? " (dry run)" : ""}. Review: pnpm culture:review`,
);
