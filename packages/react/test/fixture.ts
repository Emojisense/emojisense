import type { Culture, Pack, PackRow } from "emojisense";

const row = (
  emoji: string,
  hexcode: string,
  label: string,
  keyword: string,
  alias = "",
  skins: 0 | 1 = 0,
): PackRow => [emoji, hexcode, 0, 1, skins, label, "", keyword, alias, "", ""];

export const en: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["smileys-emotion"],
  emoji: [
    row("👍", "1F44D", "thumbs up", "good|like", "lgtm", 1),
    row("🦖", "1F996", "T-Rex", "dinosaur", "jurassic park"),
    row("🚀", "1F680", "rocket", "space", "ship it"),
  ],
};

export const tr: Pack = {
  ...en,
  locale: "tr",
  emoji: [
    row("👍", "1F44D", "baş parmak yukarıda", "tamam", "", 1),
    row("🦖", "1F996", "T-Rex", "dinozor"),
    row("🚀", "1F680", "roket", "uzay"),
  ],
};

export function packFetch() {
  return async (url: string | URL | Request) =>
    new Response(JSON.stringify(String(url).endsWith("pack.tr.json") ? tr : en));
}

export const enExt: Pack = {
  ...en,
  part: "ext",
  emoji: [["🚀", "1F680", 0, 1, 0, "", "", "", "to infinity and beyond", "", ""]],
};

export const PARROT_URL = "https://api.test/v1/custom/app1/e1";

/** An app's custom emoji, as GET /v1/custom-pack serves them. */
export const custom: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "custom-00000001",
  locale: "und",
  part: "custom",
  emojiVersion: "",
  groups: ["custom"],
  emoji: [[":party_parrot:", "C-e1", 0, 0, 0, "party_parrot", "party parrot", "", "celebrate", "", ""]],
  images: { "C-e1": PARROT_URL },
};

export function packFetchWithExt() {
  return async (url: string | URL | Request) => {
    const u = String(url);
    const body = u.endsWith("pack.en.ext.json")
      ? enExt
      : u.includes(".ext.")
        ? { ...tr, part: "ext", emoji: [] }
        : u.endsWith("pack.tr.json")
          ? tr
          : en;
    return new Response(JSON.stringify(body));
  };
}

/** Culture: "jurassic park" adds 🚀 after 🦖; a featured season always lists 👍 and 🚀. */
export const culture: Culture = {
  format: "emojisense-culture",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  from: "2026-01-01",
  until: "2026-01-15",
  entries: [
    {
      id: "season",
      kind: "seasonal",
      context: "A season",
      when: { from: "01-01", to: "12-31", recurs: "yearly" },
      regions: ["*"],
      triggers: [],
      emoji: [
        ["👍", "1F44D", 0.9],
        ["🚀", "1F680", 0.5],
      ],
      featured: true,
    },
    {
      id: "dino-film",
      kind: "lasting",
      context: "The dinosaur film series",
      when: null,
      regions: ["*"],
      triggers: ["jurassic park"],
      emoji: [["🚀", "1F680", 0.6]],
    },
  ],
  relevantNow: ["season"],
};

/** Packs, plus the English culture file under /culture/. */
export function packAndCultureFetch() {
  const packs = packFetch();
  return async (url: string | URL | Request) =>
    String(url).endsWith("/culture/culture.en.json") ? new Response(JSON.stringify(culture)) : packs(url);
}
