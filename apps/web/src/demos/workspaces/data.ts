/**
 * Three invented customer workspaces (tenants) of one chat product. Each has its own custom emoji
 * set; the art lives in `public/demo/custom/<workspace id>/<name>.svg`.
 */

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
  time: string;
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
      time: "4:12 PM",
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
      { name: "on-call", aliases: ["on call", "oncall", "pager", "paged", "incident", "sev1", "alert"] },
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
      time: "7:48 AM",
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
      time: "8:03 PM",
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

/** Queries that make the point: the same words, a different answer in every workspace. */
export const PRESET_QUERIES = ["ship it", "celebrate", "coffee", "gg"] as const;

export function customEmojiSrc(workspace: Workspace, name: string): string {
  return `/demo/custom/${workspace.id}/${name}.svg`;
}
