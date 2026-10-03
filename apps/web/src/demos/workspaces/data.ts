/**
 * Three invented customer workspaces (tenants) of one chat product. Each has its own custom emoji
 * set; the art lives in `public/demo/custom/<workspace id>/<name>.svg`.
 */
import type { DemoMessages } from "../../i18n/demos";

export interface CustomEmoji {
  /** Shortcode without colons, e.g. "shipit-rocket". Also the file name of the art. */
  name: string;
  /** Phrases people type for it, in the words of that workspace. */
  aliases: string[];
}

/** A reaction already on the message: a custom emoji by name, or a standard one. */
export type SeedReaction =
  | { custom: string; count: number }
  | { emoji: string; id: string; label: string; count: number };

export interface ChannelMessage {
  author: string;
  /** Minutes after midnight on the mock clock. */
  minute: number;
  text: string;
  reactions: SeedReaction[];
}

export interface Workspace {
  id: "acme" | "bloom" | "guild";
  name: string;
  monogram: string;
  /** What the workspace is, for the rail tooltip and the header. */
  kind: string;
  channel: string;
  /** Tenant id on the platform side. */
  tenant: string;
  /** Where the set came from, when it was imported. */
  importedFrom?: "Slack";
  message: ChannelMessage;
  emoji: CustomEmoji[];
}

export const WORKSPACES: Workspace[] = [
  {
    id: "acme",
    name: "Acme Rockets",
    monogram: "AR",
    kind: "Engineering",
    channel: "releases",
    tenant: "acme-rockets",
    importedFrom: "Slack",
    message: {
      author: "Mara Okafor",
      minute: 16 * 60 + 12,
      text: "v4.2 is rolling out to 100%. Thanks to everyone who stayed for the last review.",
      reactions: [
        { custom: "shipit-rocket", count: 4 },
        { emoji: "🎉", id: "1F389", label: "party popper", count: 3 },
      ],
    },
    emoji: [
      {
        name: "shipit-rocket",
        aliases: ["ship it", "shipit", "launch", "deploy", "release", "send it", "liftoff"],
      },
      { name: "lgtm", aliases: ["looks good to me", "approved", "approve", "code review", "ship it"] },
      {
        name: "launch-party",
        aliases: ["celebrate", "party", "launch day", "we did it", "congrats", "milestone"],
      },
      {
        name: "plus-one",
        aliases: ["+1", "plus one", "agree", "same", "kudos", "nice work", "gg", "well done"],
      },
      {
        name: "cold-brew",
        aliases: ["coffee", "cold brew", "iced coffee", "caffeine", "fuel", "need coffee"],
      },
      {
        name: "on-call",
        aliases: ["on call", "oncall", "pager", "paged", "pager went off", "incident", "sev1", "alert"],
      },
      {
        name: "deploy-friday",
        aliases: ["friday deploy", "deploy on friday", "yolo", "risky", "this is fine", "living dangerously"],
      },
      {
        name: "merge-conflict",
        aliases: ["merge conflict", "conflict", "git", "rebase", "merge", "it broke"],
      },
    ],
  },
  {
    id: "bloom",
    name: "Bloom Café",
    monogram: "BC",
    kind: "Coffee shops",
    channel: "front-of-house",
    tenant: "bloom-cafe",
    message: {
      author: "Theo Martin",
      minute: 7 * 60 + 48,
      text: "Oat milk delivery is in, and the almond croissants are out of the oven.",
      reactions: [
        { custom: "fresh-bake", count: 3 },
        { emoji: "🙌", id: "1F64C", label: "raising hands", count: 2 },
      ],
    },
    emoji: [
      {
        name: "order-up",
        aliases: ["order up", "ship it", "ready", "pickup", "send it", "ding", "out the door"],
      },
      { name: "latte-art", aliases: ["latte", "coffee", "flat white", "cappuccino", "heart", "pour"] },
      {
        name: "espresso-shot",
        aliases: ["espresso", "coffee", "double shot", "caffeine", "wake up", "energy"],
      },
      {
        name: "fresh-bake",
        aliases: ["fresh bake", "croissant", "pastry", "bakery", "fresh out of the oven", "warm", "bread"],
      },
      { name: "cake-day", aliases: ["celebrate", "birthday", "cake", "cupcake", "party", "treat yourself"] },
      { name: "rush-hour", aliases: ["rush hour", "busy", "slammed", "queue", "line out the door", "hurry"] },
      { name: "oat-milk", aliases: ["oat milk", "dairy free", "vegan", "milk", "alt milk", "oat"] },
      { name: "tip-jar", aliases: ["tips", "tip jar", "thanks", "thank you", "grateful", "appreciate"] },
    ],
  },
  {
    id: "guild",
    name: "Pixel Guild",
    monogram: "PG",
    kind: "Gaming community",
    channel: "raid-planning",
    tenant: "pixel-guild",
    message: {
      author: "Kai Ito",
      minute: 20 * 60 + 3,
      text: "Raid starts at 9. Bring potions, we are going for the dragon this time.",
      reactions: [
        { custom: "raid-night", count: 5 },
        { emoji: "⚔️", id: "2694", label: "crossed swords", count: 2 },
      ],
    },
    emoji: [
      { name: "gg", aliases: ["gg", "good game", "well played", "wp", "ggwp", "victory"] },
      {
        name: "level-up",
        aliases: ["level up", "celebrate", "ding", "promotion", "achievement", "congrats"],
      },
      { name: "raid-night", aliases: ["raid", "raid night", "tonight", "lfg", "squad up", "boss fight"] },
      { name: "loot", aliases: ["loot", "treasure", "drop", "reward", "chest", "rare drop"] },
      { name: "mana-potion", aliases: ["mana", "potion", "coffee", "energy", "caffeine", "refill"] },
      { name: "patch-notes", aliases: ["patch notes", "ship it", "update", "release", "changelog", "patch"] },
      { name: "respawn", aliases: ["respawn", "brb", "be right back", "try again", "retry"] },
      { name: "crit", aliases: ["crit", "critical hit", "big damage", "insane", "huge"] },
    ],
  },
];

/**
 * Queries that make the point: the same words, a different answer in every workspace. The last one
 * is a sentence no alias list covers: the standard emoji under it come from meaning search.
 */
export const MEANING_PRESET = { query: "pager went off at 3am", target: "1F4DF" } as const;
export const PRESET_QUERIES = ["ship it", "celebrate", "coffee", MEANING_PRESET.query] as const;

type PresetKey = keyof DemoMessages["workspaces"]["presets"];
const PRESET_KEYS: Record<(typeof PRESET_QUERIES)[number], PresetKey> = {
  "ship it": "shipIt",
  celebrate: "celebrate",
  coffee: "coffee",
  "pager went off at 3am": "pager",
};

export interface LocalizedWorkspaces {
  workspaces: Workspace[];
  /** The preset chips in the page's language. */
  presets: string[];
}

/**
 * The workspaces in the page's language. The custom sets keep their English names and aliases
 * (each workspace's admins wrote them), and every emoji with an alias that starts an English preset
 * ("pager went off" in "pager went off at 3am") also learns the translated preset, so a chip finds
 * the same custom emoji in every language.
 */
export function localizeWorkspaces(words: DemoMessages["workspaces"]): LocalizedWorkspaces {
  const presets = PRESET_QUERIES.map((preset) => words.presets[PRESET_KEYS[preset]]);
  const workspaces = WORKSPACES.map((workspace) => ({
    ...workspace,
    kind: words.kinds[workspace.id],
    message: { ...workspace.message, text: words.texts[workspace.id] },
    emoji: workspace.emoji.map((item) => {
      const extra = PRESET_QUERIES.filter((preset) =>
        item.aliases.some((alias) => preset === alias || preset.startsWith(`${alias} `)),
      )
        .map((preset) => words.presets[PRESET_KEYS[preset]])
        // On the English page the alias that already matches stays the one the footer names.
        .filter((translated) => !(PRESET_QUERIES as readonly string[]).includes(translated));
      return { ...item, aliases: [...new Set([...item.aliases, ...extra])] };
    }),
  }));
  return { workspaces, presets };
}

export function customEmojiSrc(workspace: Workspace, name: string): string {
  return `/demo/custom/${workspace.id}/${name}.svg`;
}
