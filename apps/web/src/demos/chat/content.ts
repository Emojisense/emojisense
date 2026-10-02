/** Mock workspace content for the chat demo. The people and messages are fiction. */

export type PersonId = "priya" | "marcus" | "lena" | "you";

export interface Person {
  name: string;
  initials: string;
  /** Neutral avatar shade, 1–4. Emoji stay the only color in the window. */
  tone: 1 | 2 | 3 | 4;
  presence?: "online" | "away";
}

export const PEOPLE: Record<PersonId, Person> = {
  priya: { name: "Priya Natarajan", initials: "PN", tone: 2, presence: "online" },
  marcus: { name: "Marcus Webb", initials: "MW", tone: 3, presence: "online" },
  lena: { name: "Lena Okafor", initials: "LO", tone: 4, presence: "away" },
  you: { name: "You", initials: "Y", tone: 1 },
};

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
  /** Changes on every count change, so the glyph pops again. */
  bump: number;
}

export interface Message {
  id: string;
  author: PersonId;
  /** Minutes after midnight on the mock clock. */
  minute: number;
  text: string;
  reactions: Reaction[];
  fresh?: boolean;
}

const seedReaction = (emoji: string, count: number): Reaction => ({ emoji, count, mine: false, bump: 0 });

export const SEED_MESSAGES: Message[] = [
  {
    id: "seed-1",
    author: "priya",
    minute: 10 * 60 + 2,
    text: "RC `2.14.0-rc.3` is green on staging. All 412 end-to-end tests passed on the first run.",
    reactions: [seedReaction("✅", 4), seedReaction("🙌", 2)],
  },
  {
    id: "seed-2",
    author: "marcus",
    minute: 10 * 60 + 14,
    text: "Welcome email is final. “Get started” is now “Set up your workspace”, it won the copy test by a mile.",
    reactions: [seedReaction("🔥", 3)],
  },
  {
    id: "seed-3",
    author: "lena",
    minute: 10 * 60 + 21,
    text: "Rollout hit 100%. Signups are up 18% this morning, great work everyone 📈",
    reactions: [seedReaction("👀", 2)],
  },
];

/** What the autoplay sends. Reduced motion shows this message as already sent. */
export const AUTOPLAY_MESSAGE = "shipped the new onboarding 🎉 thanks team 🐐";

export type AutoplayStep =
  | { kind: "type"; text: string }
  | { kind: "insert"; text: string }
  | { kind: "pause"; ms: number }
  /** Wait for this emoji (Emojibase id) in the ":" popup, highlight it, then pick it. */
  | { kind: "pick"; id: string }
  | { kind: "send" };

export const AUTOPLAY_STEPS: AutoplayStep[] = [
  { kind: "type", text: "shipped the new onboarding " },
  { kind: "pause", ms: 320 },
  // Typed with the system emoji keyboard, so it lands in one keystroke.
  { kind: "insert", text: "🎉" },
  { kind: "pause", ms: 220 },
  { kind: "type", text: " thanks team " },
  { kind: "pause", ms: 380 },
  { kind: "type", text: ":goat" },
  { kind: "pick", id: "1F410" },
  { kind: "pause", ms: 700 },
  { kind: "send" },
];

export const CHANNELS = [
  { name: "general" },
  { name: "design-crit" },
  { name: "eng-web", unread: 3 },
  { name: "launch", active: true },
  { name: "support" },
] as const;

export function formatClock(minute: number): string {
  const hours = Math.floor(minute / 60) % 24;
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}
