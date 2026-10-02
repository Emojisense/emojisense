/**
 * Held-out eval queries written by a different model family than the alias authors (Claude),
 * so the benchmark is not graded by the same "mind" that wrote the aliases.
 *
 *   tsx scripts/make-heldout.ts   → queries/heldout.jsonl
 *
 * Personas and app contexts drive what people would type; the model never sees our aliases.
 * Answers are the generator's own labels (labelled_by), validated against the catalog only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { disposeEmbeddings, runWorkersAI } from "@emojisense/data/embeddings";
import { DATA_ROOT } from "@emojisense/data/paths";
import { normalize } from "emojisense";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const PER_PERSONA = 6;
const MAX_RETRIES = 2;
const EVAL_ROOT = new URL("..", import.meta.url).pathname;

const PER_LOCALE: Record<string, { language: string; where: string }> = {
  en: { language: "English", where: "the US, the UK or India" },
  zh: { language: "Simplified Chinese", where: "China" },
  hi: { language: "Hindi (Devanagari or the Hinglish they normally type)", where: "India" },
  es: { language: "Spanish", where: "Mexico, Spain or Argentina" },
  ar: {
    language: "Arabic (Arabic script or the Arabizi they normally type)",
    where: "Egypt or Saudi Arabia",
  },
  fr: { language: "French", where: "France or Québec" },
  bn: {
    language: "Bengali (Bengali script or the Banglish they normally type)",
    where: "Bangladesh or West Bengal",
  },
  pt: { language: "Portuguese", where: "Brazil" },
  ru: { language: "Russian", where: "Russia" },
  id: { language: "Indonesian", where: "Indonesia" },
  tr: { language: "Turkish", where: "Türkiye" },
};
const ROLES = [
  "a teenager in a group chat with school friends",
  "an office worker in a team chat",
  "a parent or grandparent in the family group chat",
];
const PERSONAS = Object.entries(PER_LOCALE).flatMap(([locale, { language, where }]) =>
  ROLES.map((role) => ({ locale, language, who: `${role} in ${where}` })),
);

function prompt(language: string, who: string) {
  return [
    `Simulate ${who}. They open the emoji search box of their chat app ${PER_PERSONA} times this week.`,
    `Write the ${PER_PERSONA} different things they type, in ${language}: 1 to 6 words, lowercase, natural.`,
    "Mostly describe a feeling, reaction, situation, joke, idiom or thing they want to express; only sometimes a literal object.",
    "For each, give 1 to 5 standard Unicode emoji that would be a correct result, best first.",
    'Answer with JSON only: {"items":[{"q":"...","answers":["..."]}]}',
  ].join("\n");
}

const strip = (e: string) => e.replace(/️/g, "").replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "");
const { emoji }: { emoji: { emoji: string }[] } = JSON.parse(
  readFileSync(join(DATA_ROOT, "build", "emoji.base.json"), "utf8"),
);
const catalog = new Map(emoji.map((e) => [strip(e.emoji), e.emoji]));
const existing = new Set(
  readFileSync(join(EVAL_ROOT, "queries", "queries.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => normalize((JSON.parse(l) as { q: string }).q)),
);

const out: string[] = [];
const seen = new Set<string>();
let dropped = 0;
try {
  for (const [p, { locale, language, who }] of PERSONAS.entries()) {
    let json: { items: { q: string; answers: string[] }[] } | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES && !json; attempt++) {
      const result = (await runWorkersAI(MODEL, {
        messages: [{ role: "user", content: prompt(language, who) }],
        // Gemma 4 reasons before it answers; a small budget truncates the JSON.
        max_tokens: 4000,
        temperature: 0.8,
      })) as { response?: unknown; choices?: { message?: { content?: string } }[] };
      const raw = result.response ?? result.choices?.[0]?.message?.content ?? "";
      const text = typeof raw === "string" ? raw : JSON.stringify(raw);
      try {
        json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      } catch {
        json = undefined;
      }
    }
    if (!json) {
      console.warn(`\n⚠ ${who}: no valid JSON after ${MAX_RETRIES + 1} attempts`);
      continue;
    }
    json.items.forEach((item, i) => {
      const q = normalize(item.q);
      const answers = [
        ...new Set(
          item.answers
            .map(strip)
            .map((a) => catalog.get(a))
            .filter(Boolean),
        ),
      ] as string[];
      if (!q || seen.has(q) || existing.has(q) || answers.length === 0) {
        dropped++;
        return;
      }
      seen.add(q);
      out.push(
        JSON.stringify({
          id: `held-${locale}-${String(p).padStart(2, "0")}${i}`,
          q: item.q.trim().toLocaleLowerCase(locale),
          locale,
          cat: `heldout-${locale}`,
          answers,
          persona: who,
          labelled_by: MODEL,
        }),
      );
    });
    process.stdout.write(`\r${p + 1}/${PERSONAS.length} personas, ${out.length} queries`);
  }
} finally {
  await disposeEmbeddings();
}
writeFileSync(join(EVAL_ROOT, "queries", "heldout.jsonl"), `${out.join("\n")}\n`);
console.log(
  `\nheldout: ${out.length} queries (${dropped} dropped: duplicate, already in the main set, or no valid emoji)`,
);
