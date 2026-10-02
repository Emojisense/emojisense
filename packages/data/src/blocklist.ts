/**
 * Alias moderation, per locale (a Turkish swear word folded to ASCII can be an innocent
 * English word, e.g. "got", "pic"). BLOCK drops an alias. DEMOTE keeps it searchable only in
 * the weakest field. Matching is on whole normalized tokens.
 *
 * Kept short on purpose: the generation style guide already forbids slurs and explicit terms.
 * This is the safety net, and everything it catches is listed in review.csv.
 */
type Locale = "en" | "tr";

const words = (s: string) => new Set(s.trim().split(/\s+/));

const BLOCK: Record<Locale, Set<string>> = {
  en: words(`
    porn porno nsfw nude nudes sex horny cum dick cock penis vagina pussy boobs tits titties
    dildo orgasm blowjob nazi swastika kkk retard retarded fag faggot tranny nigga nigger
    chink spic kike gook wetback`),
  tr: words(`
    porno seks sik sikis siktir yarrak amk orospu pic got ibne gavat kahpe pezevenk amcik`),
};

const DEMOTE: Record<Locale, Set<string>> = {
  en: words(`
    fuck fucking fucked wtf shit shitty bullshit ass asshole bitch damn crap boner booty
    thicc weed stoned hungover`),
  tr: words(`bok boktan lan salak aptal mal`),
};

export type Moderation = "block" | "demote" | "ok";

export function moderate(phrase: string, locale: string): Moderation {
  const key = (locale === "tr" ? "tr" : "en") satisfies Locale;
  const tokens = phrase.split(" ");
  if (tokens.some((t) => BLOCK[key].has(t))) return "block";
  if (tokens.some((t) => DEMOTE[key].has(t))) return "demote";
  return "ok";
}
