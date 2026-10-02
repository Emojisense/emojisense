/**
 * Held-out eval queries written by a different model family than the alias authors (Claude),
 * so the benchmark is not graded by the same "mind" that wrote the aliases.
 *
 *   tsx scripts/make-heldout.ts                        top every locale up to 60 queries
 *   tsx scripts/make-heldout.ts --target 80 --locales ar,hi
 *   tsx scripts/make-heldout.ts --dry-run --locales ar  print one call per locale, write nothing
 *
 * Adds to queries/heldout.jsonl. Existing lines and ids are kept as they are; the file is
 * rewritten grouped by locale after every call, so an interrupted run keeps its work.
 *
 * Personas, apps, topics and (for hi, bn, ar) the script drive what people would type. The
 * model never sees our aliases. It sees only the held-out queries it already wrote for that
 * locale, so it does not repeat them. Answers are the generator's own labels (labelled_by),
 * validated against the catalog only. Do not relabel with Claude: disputed labels go to
 * queries/heldout-review.md for a human to decide.
 *
 * The first 133 queries were made with thinking on and 3 roles per locale; later ones with
 * thinking off, 12 roles and 14 topics (topic is recorded per query).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { disposeEmbeddings, runWorkersAI } from "@emojisense/data/embeddings";
import { LOCALE_CODES } from "@emojisense/data/locales";
import { DATA_ROOT } from "@emojisense/data/paths";
import { normalize } from "emojisense";
import { type HeldoutQuery, parseHeldout } from "../src/heldout.ts";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const PER_CALL = 6;
const MAX_RETRIES = 2;
const MAX_WORDS = 6;
const EVAL_ROOT = new URL("..", import.meta.url).pathname;
const HELDOUT_PATH = join(EVAL_ROOT, "queries", "heldout.jsonl");

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    target: { type: "string", default: "60" },
    locales: { type: "string" },
    concurrency: { type: "string", default: "4" },
    "dry-run": { type: "boolean", default: false },
  },
});
const target = Number(args.target);
const locales = args.locales ? args.locales.split(",") : LOCALE_CODES;
for (const l of locales) if (!LOCALE_CODES.includes(l)) throw new Error(`unknown locale ${l}`);

type Script = "latin" | "han" | "cyrillic" | "arabic" | "devanagari" | "bengali";
interface LocaleSetup {
  language: string;
  where: string;
  native: Script;
  /** How people write the language in Latin letters, for locales where chat often does. */
  romanized?: string;
}
const PER_LOCALE: Record<string, LocaleSetup> = {
  en: { language: "English", where: "the US, the UK or India", native: "latin" },
  zh: { language: "Simplified Chinese", where: "China", native: "han" },
  hi: { language: "Hindi", where: "India", native: "devanagari", romanized: "Hinglish" },
  es: { language: "Spanish", where: "Mexico, Spain or Argentina", native: "latin" },
  ar: { language: "Arabic", where: "Egypt or Saudi Arabia", native: "arabic", romanized: "Arabizi" },
  fr: { language: "French", where: "France or Québec", native: "latin" },
  bn: { language: "Bengali", where: "Bangladesh or West Bengal", native: "bengali", romanized: "Banglish" },
  pt: { language: "Portuguese", where: "Brazil", native: "latin" },
  ru: { language: "Russian", where: "Russia", native: "cyrillic" },
  id: { language: "Indonesian", where: "Indonesia", native: "latin" },
  tr: { language: "Turkish", where: "Türkiye", native: "latin" },
};
const ROLES = [
  "a teenager in a group chat with school friends",
  "an office worker in a team chat",
  "a parent or grandparent in the family group chat",
  "a university student texting a close friend",
  "a gamer in a voice-and-text gaming community",
  "a small shop owner answering customers on a messaging app",
  "a football fan in a match-day group chat",
  "someone texting their partner",
  "a nurse in a hospital staff chat",
  "a retiree in a neighbourhood group",
  "a teacher in a group chat with other teachers",
  "a traveller texting friends from a trip",
];
const TOPICS = [
  "everyday moods and reactions",
  "food, drinks and eating out",
  "weather and seasons",
  "deadlines, exams and being busy",
  "sports and games",
  "holidays, festivals and religious occasions they celebrate",
  "love, friendship and family",
  "travel and getting around",
  "animals, pets and nature",
  "money, shopping and bills",
  "health, sleep and the body",
  "sarcasm, jokes and internet slang",
  "good news, bad news and condolences",
  "music, films and celebrities",
];
const SCRIPT_TEST: Record<Script, RegExp> = {
  latin: /\p{Script=Latin}/u,
  han: /\p{Script=Han}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  arabic: /\p{Script=Arabic}/u,
  devanagari: /\p{Script=Devanagari}/u,
  bengali: /\p{Script=Bengali}/u,
};

interface Brief {
  locale: string;
  who: string;
  topic: string;
  script: Script;
  writing: string;
}

/** Call `n` for a locale: rotate role and topic (co-prime steps), alternate script where it applies. */
function briefFor(locale: string, n: number): Brief {
  const setup = PER_LOCALE[locale] as LocaleSetup;
  const offset = LOCALE_CODES.indexOf(locale);
  const role = ROLES[(n + offset) % ROLES.length] as string;
  const topic = TOPICS[(n * 5 + offset) % TOPICS.length] as string;
  const romanized = setup.romanized !== undefined && n % 2 === 1;
  const writing = romanized
    ? `${setup.romanized} (${setup.language} in Latin letters, as they normally type it)`
    : setup.native === "latin"
      ? setup.language
      : `${setup.language}, in its own script`;
  return {
    locale,
    who: `${role} in ${setup.where}`,
    topic,
    script: romanized ? "latin" : setup.native,
    writing,
  };
}

function prompt(brief: Brief, avoid: string[]) {
  return [
    `Simulate ${brief.who}. They open the emoji search box of their chat app ${PER_CALL} times this week.`,
    `This week is mostly about: ${brief.topic}.`,
    `Write the ${PER_CALL} different things they type, in ${brief.writing}: 1 to ${MAX_WORDS} words, lowercase, natural.`,
    "Mostly describe a feeling, reaction, situation, joke, idiom or thing they want to express; only sometimes a literal object.",
    "For each, give 1 to 5 standard Unicode emoji that would be a correct result, best first.",
    ...(avoid.length
      ? [`Do not repeat or reword these, they are already collected: ${avoid.join(" · ")}`]
      : []),
    'Answer with JSON only: {"items":[{"q":"...","answers":["..."]}]}',
  ].join("\n");
}

const strip = (e: string) => e.replace(/️/g, "").replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "");
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
/** The model sometimes packs several emoji into one answer ("⚽️🔥😱"); keep them all, in order. */
const graphemes = (text: string) =>
  [...segmenter.segment(text)].map((s) => s.segment).filter((s) => s.trim() !== "");
const { emoji }: { emoji: { emoji: string }[] } = JSON.parse(
  readFileSync(join(DATA_ROOT, "build", "emoji.base.json"), "utf8"),
);
const catalog = new Map(emoji.map((e) => [strip(e.emoji), e.emoji]));
const inHouse = new Set(
  readFileSync(join(EVAL_ROOT, "queries", "queries.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => normalize((JSON.parse(l) as { q: string }).q)),
);
const heldout = parseHeldout(readFileSync(HELDOUT_PATH, "utf8"));
const dropped: Record<string, number> = {};
const drop = (reason: string) => {
  dropped[reason] = (dropped[reason] ?? 0) + 1;
};

/** Why an item is rejected, or undefined when it is kept. */
function rejection(locale: string, brief: Brief, q: string, answers: string[]): string | undefined {
  const key = normalize(q);
  if (!key) return "empty";
  if (key.split(" ").length > MAX_WORDS || q.length > 40) return "too long";
  if (!SCRIPT_TEST[brief.script].test(q)) return "wrong script";
  if (brief.script === "latin" && /[^\p{Script=Latin}\P{L}]/u.test(q)) return "wrong script";
  if (inHouse.has(key)) return "in the in-house set";
  if (heldout.some((h) => h.locale === locale && normalize(h.q) === key)) return "duplicate";
  if (answers.length === 0) return "no valid emoji";
  return undefined;
}

function nextId(locale: string): string {
  const numbers = heldout
    .filter((h) => h.locale === locale)
    .map((h) => Number(/-(\d+)$/.exec(h.id)?.[1] ?? 0));
  return `held-${locale}-${String(Math.max(-1, ...numbers) + 1).padStart(3, "0")}`;
}

function save() {
  const ordered = LOCALE_CODES.flatMap((l) => heldout.filter((h) => h.locale === l));
  writeFileSync(HELDOUT_PATH, `${ordered.map((h) => JSON.stringify(h)).join("\n")}\n`);
}

type Completion = {
  response?: unknown;
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
};

async function ask(brief: Brief, avoid: string[]): Promise<{ q: string; answers: string[] }[] | undefined> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = (await runWorkersAI(MODEL, {
      messages: [{ role: "user", content: prompt(brief, avoid) }],
      // With thinking on, Gemma 4 often spends the whole budget deliberating (4,000 tokens,
      // finish_reason "length") and returns no content, most often for romanized prompts.
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 1500,
      temperature: 0.8,
    })) as Completion;
    const raw = result.response ?? result.choices?.[0]?.message?.content ?? "";
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    try {
      const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (Array.isArray(json.items)) return json.items;
    } catch {
      // retried below
    }
    const finish = result.choices?.[0]?.finish_reason ?? "?";
    console.warn(`⚠ ${brief.locale} / ${brief.who}: unusable answer (${finish}): ${text.slice(0, 120)}`);
  }
  return undefined;
}

async function topUp(locale: string) {
  const count = () => heldout.filter((h) => h.locale === locale).length;
  const start = Math.floor(count() / PER_CALL);
  const maxCalls = Math.ceil(Math.max(0, target - count()) / PER_CALL) * 3 + 2;
  for (let call = 0; count() < target && call < maxCalls; call++) {
    const brief = briefFor(locale, start + call);
    const avoid = heldout.filter((h) => h.locale === locale).map((h) => h.q);
    const items = await ask(brief, avoid);
    if (!items) {
      drop("no JSON");
      continue;
    }
    for (const item of items) {
      if (typeof item?.q !== "string" || !Array.isArray(item.answers)) {
        drop("malformed item");
        continue;
      }
      const q = item.q.trim().toLocaleLowerCase(locale);
      const answers = [
        ...new Set(
          item.answers
            .flatMap((a) => graphemes(String(a)))
            .map((g) => catalog.get(strip(g)))
            .filter(Boolean),
        ),
      ] as string[];
      const reason = rejection(locale, brief, q, answers);
      if (reason) {
        drop(reason);
        if (args["dry-run"]) console.log(`✘ ${reason}: ${JSON.stringify(item)}`);
        continue;
      }
      const query: HeldoutQuery = {
        id: nextId(locale),
        q,
        locale,
        cat: `heldout-${locale}`,
        answers: answers.slice(0, 5),
        persona: brief.who,
        topic: brief.topic,
        labelled_by: MODEL,
      };
      if (args["dry-run"]) console.log(JSON.stringify(query));
      else heldout.push(query);
    }
    if (args["dry-run"]) return;
    save();
    console.log(`${locale}: ${count()}/${target} after call ${call + 1} (${brief.who}; ${brief.topic})`);
  }
  if (count() < target) console.warn(`⚠ ${locale}: stopped at ${count()}/${target} after ${maxCalls} calls`);
}

try {
  const queue = [...locales];
  const worker = async () => {
    for (let locale = queue.shift(); locale; locale = queue.shift()) await topUp(locale);
  };
  await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));
} finally {
  await disposeEmbeddings();
}
const perLocale = LOCALE_CODES.map((l) => `${l} ${heldout.filter((h) => h.locale === l).length}`);
console.log(`\nheldout: ${heldout.length} queries (${perLocale.join(", ")})`);
console.log(`dropped: ${JSON.stringify(dropped)}`);
