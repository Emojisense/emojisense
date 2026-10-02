import type { Pack, PackRow } from "emojisense";

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
