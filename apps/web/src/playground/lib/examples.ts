import type { Locale } from "./settings";

/** Each search example shows one thing the engine understands. `kind` names it, never the answer. */
export const SEARCH_EXAMPLES: { query: string; locale: Locale; kind: string }[] = [
  { query: "jurassic park", locale: "en", kind: "film" },
  { query: "lgtm", locale: "en", kind: "slang" },
  { query: "hallowelen", locale: "en", kind: "typo" },
  { query: "i am exhausted", locale: "en", kind: "feeling" },
  { query: "the vibes are off", locale: "en", kind: "meaning" },
  { query: "feliz cumpleaños", locale: "es", kind: "es" },
  { query: "生日快乐", locale: "zh", kind: "zh" },
  { query: "जन्मदिन मुबारक", locale: "hi", kind: "hi" },
  { query: "joyeux anniversaire", locale: "fr", kind: "fr" },
  { query: "kolay gelsin", locale: "tr", kind: "tr" },
];

/** Chat messages of the kind a team sends every day. */
export const REACTION_EXAMPLES: { text: string; locale: Locale }[] = [
  { text: "We just shipped the new onboarding!", locale: "en" },
  { text: "Thanks team, great work on the launch", locale: "en" },
  { text: "Ugh, the build is broken again", locale: "en" },
  { text: "Anyone want to grab lunch? Pizza place downstairs", locale: "en" },
  { text: "My flight got cancelled, stuck at the airport", locale: "en" },
  { text: "¡Feliz cumpleaños, Ana! Que tengas un gran día", locale: "es" },
];
