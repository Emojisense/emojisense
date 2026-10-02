/**
 * Build-time examples for the landing page, computed with the real engine on the real packs,
 * so every "you type X, you get Y" on the page is true for the shipped data.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createEngine, normalize, type Pack, ROW_INDEX } from "emojisense";
import { PACK_VERSION } from "../config";

const PACK_DIR = join(process.cwd(), "../../packages/data/dist/packs", PACK_VERSION);
const LOCALES = ["en", "es", "zh", "hi", "ar", "fr", "bn", "pt", "ru", "id", "tr"];

function readPack(name: string): Pack | undefined {
  const path = join(PACK_DIR, `pack.${name}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Pack) : undefined;
}

const cores = LOCALES.map((l) => readPack(l)).filter((p): p is Pack => p !== undefined);
const exts = LOCALES.map((l) => readPack(`${l}.ext`)).filter((p): p is Pack => p !== undefined);
const engine = cores.length > 0 ? createEngine([...cores, ...exts]) : undefined;
const english = cores.find((p) => p.locale === "en");

/** The label/keyword substring filter most pickers ship (CLDR names and keywords only). */
function nameSearch(query: string, limit: number): string[] {
  const q = normalize(query);
  if (!english || !q) return [];
  const hits: { emoji: string; score: number; order: number }[] = [];
  english.emoji.forEach((row, order) => {
    let score = normalize(row[ROW_INDEX.label]).includes(q) ? 10 : 0;
    for (const tag of row[ROW_INDEX.keyword].split("|")) if (tag?.includes(q)) score += 1;
    if (score > 0) hits.push({ emoji: row[ROW_INDEX.emoji], score, order });
  });
  return hits
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((h) => h.emoji);
}

function ours(query: string, locale: string, limit: number): string[] {
  return engine?.search(query, { locale, limit, prefix: false }).results.map((r) => r.emoji) ?? [];
}

export interface Comparison {
  query: string;
  kind: string;
  name: string[];
  emojisense: string[];
}

const COMPARE = [
  { query: "congrats on the launch", kind: "Intent" },
  { query: "greatest of all time", kind: "Meaning" },
  { query: "hallowelen", kind: "Typo" },
  { query: "jurassic park", kind: "Film" },
  { query: "i'm exhausted", kind: "Feeling" },
  { query: "break a leg", kind: "Idiom" },
];

export const comparisons: Comparison[] = COMPARE.map(({ query, kind }) => ({
  query,
  kind,
  name: nameSearch(query, 3),
  emojisense: ours(query, "en", 3),
})).filter((c) => c.emojisense.length > 0);

export interface LanguageExample {
  locale: string;
  language: string;
  query: string;
  top: string[];
}

const BIRTHDAY = [
  { locale: "en", language: "English", query: "happy birthday" },
  { locale: "es", language: "Español", query: "feliz cumpleaños" },
  { locale: "zh", language: "中文", query: "生日快乐" },
  { locale: "hi", language: "हिन्दी", query: "जन्मदिन मुबारक" },
  { locale: "ar", language: "العربية", query: "عيد ميلاد سعيد" },
  { locale: "fr", language: "Français", query: "joyeux anniversaire" },
  { locale: "bn", language: "বাংলা", query: "শুভ জন্মদিন" },
  { locale: "pt", language: "Português", query: "feliz aniversário" },
  { locale: "ru", language: "Русский", query: "с днём рождения" },
  { locale: "id", language: "Indonesia", query: "selamat ulang tahun" },
  { locale: "tr", language: "Türkçe", query: "doğum günü" },
];

/** Only languages where the engine really answers with a birthday emoji make it onto the page. */
const BIRTHDAY_EMOJI = new Set(["🎂", "🥳", "🎉", "🎁", "🎈", "🍰", "🧁", "🎊"]);
export const languages: LanguageExample[] = BIRTHDAY.map((b) => ({
  ...b,
  top: ours(b.query, b.locale, 3),
})).filter((b) => b.top.some((e) => BIRTHDAY_EMOJI.has(e.replace(/️/g, ""))));

export const stats = {
  emoji: english?.emoji.length ?? 0,
  languages: LOCALES.length,
};

export interface CityBubble {
  city: string;
  locale: string;
  query: string;
  emoji: string;
}

const CELEBRATE = ["🎉", "🥳", "🎊", "👏", "🙌", "🍾", "🥂"];
/** Each city tries its searches in order and shows the first one the engine gets right. */
const CITY_QUERIES = [
  { city: "Los Angeles", locale: "en", queries: ["jurassic park"], expect: ["🦖", "🦕"] },
  { city: "New York", locale: "en", queries: ["congrats", "congratulations"], expect: CELEBRATE },
  {
    city: "Mexico City",
    locale: "es",
    queries: ["feliz cumple", "feliz cumpleaños"],
    expect: [...BIRTHDAY_EMOJI],
  },
  {
    city: "São Paulo",
    locale: "pt",
    queries: ["parabéns", "feliz aniversário"],
    expect: [...CELEBRATE, ...BIRTHDAY_EMOJI],
  },
  { city: "London", locale: "en", queries: ["cheers"], expect: ["🍻", "🥂", "🍺"] },
  { city: "Lagos", locale: "en", queries: ["well done", "congratulations"], expect: CELEBRATE },
  {
    city: "Paris",
    locale: "fr",
    queries: ["bravo", "joyeux anniversaire"],
    expect: [...CELEBRATE, ...BIRTHDAY_EMOJI],
  },
  { city: "Istanbul", locale: "tr", queries: ["kolay gelsin"], expect: ["💪", "🙏", "👷", "🛠"] },
  {
    city: "Cairo",
    locale: "ar",
    queries: ["مبروك", "عيد ميلاد سعيد"],
    expect: [...CELEBRATE, ...BIRTHDAY_EMOJI],
  },
  { city: "Moscow", locale: "ru", queries: ["с днём рождения"], expect: [...BIRTHDAY_EMOJI] },
  {
    city: "Mumbai",
    locale: "hi",
    queries: ["बधाई हो", "जन्मदिन मुबारक"],
    expect: [...CELEBRATE, ...BIRTHDAY_EMOJI],
  },
  { city: "Dhaka", locale: "bn", queries: ["শুভ জন্মদিন"], expect: [...BIRTHDAY_EMOJI] },
  { city: "Jakarta", locale: "id", queries: ["selamat ulang tahun"], expect: [...BIRTHDAY_EMOJI] },
  { city: "Shanghai", locale: "zh", queries: ["生日快乐"], expect: [...BIRTHDAY_EMOJI] },
  { city: "Sydney", locale: "en", queries: ["greatest of all time"], expect: ["🐐"] },
];

/** Searches shown on the edge map: only the ones whose real top result is an expected emoji. */
export const cityBubbles: CityBubble[] = CITY_QUERIES.flatMap(({ city, locale, queries, expect }) => {
  for (const query of queries) {
    const emoji = ours(query, locale, 1)[0];
    if (emoji && expect.includes(emoji.replace(/\uFE0F/g, ""))) return [{ city, locale, query, emoji }];
  }
  return [];
});

export interface QueryAnswer {
  query: string;
  top: string[];
}

/** The engine's real top results for a few queries, for small visuals on the page. */
export function answersFor(queries: string[], locale = "en", limit = 3): QueryAnswer[] {
  return queries.map((query) => ({ query, top: ours(query, locale, limit) })).filter((a) => a.top.length > 0);
}
