import type { Pack, PackRow } from "emojisense";
import { vi } from "vitest";

const row = (
  emoji: string,
  hexcode: string,
  group: number,
  label: string,
  keyword: string,
  alias = "",
  skins: 0 | 1 = 0,
): PackRow => [emoji, hexcode, group, 1, skins, label, "", keyword, alias, "", ""];

const groups = ["smileys-emotion", "people-body", "animals-nature", "travel-places"];

/** Groups of 2, 2, 2 and 1 emoji, so keyboard rows break at group boundaries. */
export const en: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups,
  emoji: [
    row("😀", "1F600", 0, "grinning face", "smile|happy"),
    row("😂", "1F602", 0, "face with tears of joy", "laugh|lol"),
    row("👍", "1F44D", 1, "thumbs up", "good|like", "lgtm", 1),
    row("👋", "1F44B", 1, "waving hand", "wave|hello", "", 1),
    row("🦖", "1F996", 2, "T-Rex", "dinosaur", "jurassic park"),
    row("🐐", "1F410", 2, "goat", "animal", "greatest of all time"),
    row("🚀", "1F680", 3, "rocket", "space", "ship it"),
  ],
};

export const tr: Pack = {
  ...en,
  locale: "tr",
  emoji: [
    row("😀", "1F600", 0, "sırıtan yüz", "gülümseme"),
    row("😂", "1F602", 0, "sevinç gözyaşları", "kahkaha"),
    row("👍", "1F44D", 1, "başparmak yukarı", "tamam", "", 1),
    row("👋", "1F44B", 1, "el sallama", "merhaba", "", 1),
    row("🦖", "1F996", 2, "T-Rex", "dinozor"),
    row("🐐", "1F410", 2, "keçi", "hayvan"),
    row("🚀", "1F680", 3, "roket", "uzay"),
  ],
};

/** A language the tests' user does not speak: "foguete" is only Portuguese. */
export const pt: Pack = {
  ...en,
  locale: "pt",
  emoji: [row("🚀", "1F680", 3, "foguete", "espaço")],
};

const enExt: Pack = {
  ...en,
  part: "ext",
  emoji: [["🚀", "1F680", 3, 1, 0, "", "", "", "to infinity and beyond", "", ""]],
};

const shardIndex = {
  format: "emojisense-shards",
  formatVersion: 1,
  packVersion: "test",
  model: "m@256",
  keys: ["sp"],
};
const shard = { key: "sp", entries: { "spaceship launch party": [["🚀", "1F680", 0.8]] } };
const apiBody = {
  results: [{ emoji: "🐐", id: "1F410", score: 0.7, source: "semantic" }],
  packVersion: "test",
  cached: false,
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

/** A culture file: "goat" adds 🚀 after the top result; a featured season lists 😂 and 👋. */
export const culture = {
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
      triggers: ["season"],
      emoji: [
        ["😂", "1F602", 0.9],
        ["👋", "1F44B", 0.5],
      ],
      featured: true,
    },
    {
      id: "goat-test",
      kind: "lasting",
      context: "A test association",
      when: null,
      regions: ["*"],
      triggers: ["goat"],
      emoji: [["🚀", "1F680", 0.8]],
    },
  ],
  relevantNow: ["season"],
};

export const CULTURE_URL = "https://cdn.test/v1/culture/test";

/**
 * A fake network: packs under /v1/pack/test/, culture under /v1/culture/test/, shards under
 * /p/test/, the API at /v1/search and /v1/custom-pack.
 */
export function serve({ packs = true } = {}) {
  const files: Record<string, unknown> = {
    "/v1/culture/test/culture.en.json": culture,
    "/v1/pack/test/pack.en.json": en,
    "/v1/pack/test/pack.tr.json": tr,
    "/v1/pack/test/pack.en.ext.json": enExt,
    "/v1/pack/test/pack.tr.ext.json": { ...tr, part: "ext", emoji: [] },
    "/v1/pack/test/pack.pt.json": pt,
    "/v1/pack/test/pack.pt.ext.json": { ...pt, part: "ext", emoji: [] },
    "/p/test/index.json": shardIndex,
    "/p/test/sp.json": shard,
    "/v1/search": apiBody,
    "/v1/custom-pack": custom,
  };
  return vi.fn(async (input: string | URL | Request) => {
    const { pathname } = new URL(String(input));
    const body = files[pathname];
    if (!body || (!packs && pathname.startsWith("/v1/pack/"))) return new Response("", { status: 404 });
    return new Response(JSON.stringify(body));
  });
}

export const PACK_URL = "https://cdn.test/v1/pack/test";
