/**
 * The hero's example searches per page language, checked at build time against the engine a
 * visitor gets first on that page (English core + the page language's core pack). An example
 * whose real top answers miss every expected emoji is left out, so the page never shows a guess.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AliasEngine, createEngine, type Pack } from "emojisense";
import { PACK_VERSION } from "../config";
import type { Locale } from "./locales";

export type ExampleKind =
  | "film"
  | "meaning"
  | "typo"
  | "feeling"
  | "intent"
  | "idiom"
  | "greeting"
  | "wish"
  | "thanks"
  | "athlete";

export interface HeroExample {
  query: string;
  kind: ExampleKind;
  /** Engine locale of a query that is not in the page's language. */
  lang?: string;
}

const PACK_DIR = join(process.cwd(), "../../packages/data/dist/packs", PACK_VERSION);

const BIRTHDAY = ["🎂", "🥳", "🎉", "🎁", "🎈", "🍰", "🧁", "🎊"];
const THANKS = ["🙏", "🤗", "😊", "💐", "🙇", "🥰", "🫂", "🫶", "🥹"];
const LOVE = ["❤", "😍", "🥰", "💕", "💖", "😘", "💘", "💗", "💞", "💓", "😻", "🤟", "🫶", "🩷"];
const CONGRATS = ["🎉", "🥳", "🎊", "👏", "🙌", "🍾", "🏆", "🥂"];
const STRENGTH = ["💪", "✊", "🔥", "👊", "🙏", "👷", "🛠"];
const TIRED = ["😩", "😴", "🥱", "😫", "😪", "😓", "🫠", "🫩"];

interface Candidate {
  query: string;
  kind: ExampleKind;
  expect: string[];
}

/** Native searches per language, best first. Three of them make it into the hero. */
const NATIVE: Record<Exclude<Locale, "en">, Candidate[]> = {
  zh: [
    { query: "生日快乐", kind: "wish", expect: BIRTHDAY },
    { query: "我爱你", kind: "feeling", expect: LOVE },
    { query: "谢谢", kind: "thanks", expect: THANKS },
    { query: "加油", kind: "intent", expect: STRENGTH },
  ],
  hi: [
    { query: "जन्मदिन मुबारक", kind: "wish", expect: BIRTHDAY },
    { query: "बधाई हो", kind: "intent", expect: CONGRATS },
    { query: "धन्यवाद", kind: "thanks", expect: THANKS },
    { query: "प्यार", kind: "feeling", expect: LOVE },
  ],
  es: [
    { query: "feliz cumpleaños", kind: "wish", expect: BIRTHDAY },
    { query: "estoy agotado", kind: "feeling", expect: TIRED },
    { query: "felicidades", kind: "intent", expect: CONGRATS },
    { query: "gracias", kind: "thanks", expect: THANKS },
    { query: "te quiero", kind: "feeling", expect: LOVE },
  ],
  ar: [
    { query: "عيد ميلاد سعيد", kind: "wish", expect: BIRTHDAY },
    { query: "مبروك", kind: "intent", expect: CONGRATS },
    { query: "شكرا", kind: "thanks", expect: THANKS },
    { query: "أحبك", kind: "feeling", expect: LOVE },
  ],
  fr: [
    { query: "joyeux anniversaire", kind: "wish", expect: BIRTHDAY },
    { query: "félicitations", kind: "intent", expect: CONGRATS },
    { query: "je suis épuisé", kind: "feeling", expect: TIRED },
    { query: "merci", kind: "thanks", expect: THANKS },
    { query: "je t'aime", kind: "feeling", expect: LOVE },
  ],
  bn: [
    { query: "শুভ জন্মদিন", kind: "wish", expect: BIRTHDAY },
    { query: "অভিনন্দন", kind: "intent", expect: CONGRATS },
    { query: "ধন্যবাদ", kind: "thanks", expect: THANKS },
    { query: "ভালোবাসা", kind: "feeling", expect: LOVE },
  ],
  pt: [
    { query: "feliz aniversário", kind: "wish", expect: BIRTHDAY },
    { query: "parabéns", kind: "intent", expect: [...CONGRATS, ...BIRTHDAY] },
    { query: "estou exausto", kind: "feeling", expect: TIRED },
    { query: "obrigado", kind: "thanks", expect: THANKS },
    { query: "te amo", kind: "feeling", expect: LOVE },
  ],
  ru: [
    { query: "с днём рождения", kind: "wish", expect: BIRTHDAY },
    { query: "поздравляю", kind: "intent", expect: CONGRATS },
    { query: "спасибо", kind: "thanks", expect: THANKS },
    { query: "люблю тебя", kind: "feeling", expect: LOVE },
  ],
  id: [
    { query: "selamat ulang tahun", kind: "wish", expect: BIRTHDAY },
    { query: "terima kasih", kind: "thanks", expect: THANKS },
    { query: "aku cinta kamu", kind: "feeling", expect: LOVE },
  ],
  tr: [
    { query: "kolay gelsin", kind: "intent", expect: STRENGTH },
    { query: "doğum günün kutlu olsun", kind: "wish", expect: BIRTHDAY },
    { query: "tebrikler", kind: "intent", expect: CONGRATS },
    { query: "teşekkürler", kind: "thanks", expect: THANKS },
    { query: "seni seviyorum", kind: "feeling", expect: LOVE },
  ],
};

/** The English page's examples, as they always were. `lang` marks the non-English ones. */
const ENGLISH_PAGE: HeroExample[] = [
  { query: "jurassic park", kind: "film" },
  { query: "greatest of all time", kind: "meaning" },
  { query: "hallowelen", kind: "typo" },
  { query: "feliz cumpleaños", kind: "wish", lang: "es" },
  { query: "mbappe", kind: "athlete" },
  { query: "i'm exhausted", kind: "feeling" },
  { query: "生日快乐", kind: "wish", lang: "zh" },
  { query: "congrats on the launch", kind: "intent" },
  { query: "kolay gelsin", kind: "intent", lang: "tr" },
  { query: "break a leg", kind: "idiom" },
];

/** English searches that every translated page shows after its own. */
const ENGLISH_EXTRAS: HeroExample[] = [
  { query: "jurassic park", kind: "film", lang: "en" },
  { query: "greatest of all time", kind: "meaning", lang: "en" },
  { query: "hallowelen", kind: "typo", lang: "en" },
  { query: "break a leg", kind: "idiom", lang: "en" },
];

const NATIVE_SHOWN = 3;
const strip = (emoji: string) => emoji.replaceAll(String.fromCodePoint(0xfe0f), "");

function readPack(name: string): Pack | undefined {
  const path = join(PACK_DIR, `pack.${name}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Pack) : undefined;
}

const cache = new Map<Locale, HeroExample[]>();
let coreEngine: AliasEngine | undefined | null;

/**
 * Every core pack in one engine (English first), built once per build. Searching it in a locale
 * ranks that locale's phrases first, which is what a page's first engine (English core plus that
 * core pack) answers, without indexing English ten times.
 */
function cores(): AliasEngine | undefined {
  if (coreEngine === undefined) {
    const packs = (Object.keys(NATIVE) as Locale[]).flatMap((locale) => readPack(locale) ?? []);
    const english = readPack("en");
    coreEngine = english && packs.length > 0 ? createEngine([english, ...packs]) : null;
  }
  return coreEngine ?? undefined;
}

/** The hero examples for a page language. English keeps its classic mix of languages. */
export function heroExamples(locale: Locale): HeroExample[] {
  if (locale === "en") return ENGLISH_PAGE;
  const cached = cache.get(locale);
  if (cached) return cached;
  const engine = cores();
  const native = NATIVE[locale]
    .filter((candidate) => {
      const top = engine?.search(candidate.query, { locale, limit: 3, prefix: false }).results ?? [];
      return top.some((result) => candidate.expect.includes(strip(result.emoji)));
    })
    .slice(0, NATIVE_SHOWN)
    .map(({ query, kind }): HeroExample => ({ query, kind }));
  const examples = [...native, ...ENGLISH_EXTRAS];
  cache.set(locale, examples);
  return examples;
}
