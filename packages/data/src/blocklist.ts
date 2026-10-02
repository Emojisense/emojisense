/**
 * Alias moderation, per locale. A word that is a slur in one language can be an ordinary word in
 * another: Turkish swear words folded to ASCII ("got", "pic"), French "retard" (late), Brazilian
 * "kkk" (laughter), Spanish "Kike" (a name). So each locale has its own lists, and the English
 * lists apply to English only. BLOCK drops an alias. DEMOTE keeps it searchable only in the
 * weakest field. Matching is on whole normalized tokens.
 *
 * Kept short on purpose: the generation style guide already forbids slurs and explicit terms.
 * This is the safety net, and everything it catches is listed in review.csv.
 */
const words = (s: string) => new Set(s.trim().split(/\s+/).filter(Boolean));

/**
 * Clear English slurs that are not ordinary words in any wave-1 language. Every locale without
 * its own list uses only these. Left out on purpose: "kkk" (pt laughter), "retard" (fr "late"),
 * "kike" (es name), "chink" (Hindi "chheenk", sneeze, in Latin letters).
 */
const SHARED_SLURS = `nigger nigga faggot fag tranny spic gook wetback`;

const BLOCK: Record<string, Set<string>> = {
  en: words(`
    porn porno nsfw nude nudes sex horny cum dick cock penis vagina pussy boobs tits titties
    dildo orgasm blowjob nazi swastika kkk retard retarded fag faggot tranny nigga nigger
    chink spic kike gook wetback`),
  tr: words(`
    porno seks sik sikis siktir yarrak amk orospu pic got ibne gavat kahpe pezevenk amcik`),
};
const DEFAULT_BLOCK = words(SHARED_SLURS);

const DEMOTE: Record<string, Set<string>> = {
  en: words(`
    fuck fucking fucked wtf shit shitty bullshit ass asshole bitch damn crap boner booty
    thicc weed stoned hungover`),
  tr: words(`bok boktan lan salak aptal mal`),
};
const NONE = new Set<string>();

/**
 * Phrases where a listed word has an ordinary meaning ("same sex parents" is about family, not
 * sex). Their tokens are not checked; any other token in the alias still is.
 */
const ALLOW: Record<string, string[][]> = {
  en: [
    "same sex couple",
    "same sex couples",
    "same sex parents",
    "same sex wedding",
    "same sex weddings",
    "same sex marriage",
  ].map((p) => p.split(" ")),
};

/** Tokens outside every allowed phrase of the locale. */
function unexempted(tokens: string[], locale: string): string[] {
  const allowed = ALLOW[locale];
  if (!allowed) return tokens;
  const covered = new Array<boolean>(tokens.length).fill(false);
  for (const phrase of allowed) {
    for (let i = 0; i + phrase.length <= tokens.length; i++) {
      if (phrase.every((word, j) => tokens[i + j] === word)) covered.fill(true, i, i + phrase.length);
    }
  }
  return tokens.filter((_, i) => !covered[i]);
}

export type Moderation = "block" | "demote" | "ok";

export function moderate(phrase: string, locale: string): Moderation {
  const block = BLOCK[locale] ?? DEFAULT_BLOCK;
  const demote = DEMOTE[locale] ?? NONE;
  const tokens = unexempted(phrase.split(" "), locale);
  if (tokens.some((t) => block.has(t))) return "block";
  if (tokens.some((t) => demote.has(t))) return "demote";
  return "ok";
}
