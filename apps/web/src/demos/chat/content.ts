/** Mock workspace content for the chat demo. The people and messages are fiction. */
import type { DemoMessages } from "../../i18n/demos";
import type { Translator } from "../../i18n/translate";

type T = Translator<DemoMessages>;

export type PersonId = "priya" | "marcus" | "lena" | "you";

export interface Person {
  name: string;
  initials: string;
  /** Neutral avatar shade, 1–4. Emoji stay the only color in the window. */
  tone: 1 | 2 | 3 | 4;
  presence?: "online" | "away";
}

/** The people of the mock workspace. Names stay as they are; "You" is in the page's language. */
export function people(t: T): Record<PersonId, Person> {
  const you = t.t("chat.you");
  return {
    priya: { name: "Priya Natarajan", initials: "PN", tone: 2, presence: "online" },
    marcus: { name: "Marcus Webb", initials: "MW", tone: 3, presence: "online" },
    lena: { name: "Lena Okafor", initials: "LO", tone: 4, presence: "away" },
    you: { name: you, initials: [...you][0]?.toLocaleUpperCase(t.locale) ?? "Y", tone: 1 },
  };
}

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

export function seedMessages(t: T): Message[] {
  return [
    {
      id: "seed-1",
      author: "priya",
      minute: 10 * 60 + 2,
      text: t.t("chat.seed.rc"),
      reactions: [seedReaction("✅", 4), seedReaction("🙌", 2)],
    },
    {
      id: "seed-2",
      author: "marcus",
      minute: 10 * 60 + 14,
      text: t.t("chat.seed.email"),
      reactions: [seedReaction("🔥", 3)],
    },
    {
      id: "seed-3",
      author: "lena",
      minute: 10 * 60 + 21,
      text: t.t("chat.seed.rollout"),
      reactions: [seedReaction("👀", 2)],
    },
  ];
}

/** What the autoplay sends. Reduced motion shows this message as already sent. */
export function autoplayMessage(t: T): string {
  return `${t.t("chat.autoplay.shipped")} 🎉 ${t.t("chat.autoplay.thanks")} 🐐`;
}

export type AutoplayStep =
  | { kind: "type"; text: string }
  | { kind: "insert"; text: string }
  | { kind: "pause"; ms: number }
  /** Wait for this emoji (Emojibase id) in the ":" popup, highlight it, then pick it. */
  | { kind: "pick"; id: string }
  | { kind: "send" };

/** The ":goat" code is the same in every language: shortcodes are English everywhere. */
export function autoplaySteps(t: T): AutoplayStep[] {
  return [
    { kind: "type", text: `${t.t("chat.autoplay.shipped")} ` },
    { kind: "pause", ms: 320 },
    // Typed with the system emoji keyboard, so it lands in one keystroke.
    { kind: "insert", text: "🎉" },
    { kind: "pause", ms: 220 },
    { kind: "type", text: ` ${t.t("chat.autoplay.thanks")} ` },
    { kind: "pause", ms: 380 },
    { kind: "type", text: ":goat" },
    { kind: "pick", id: "1F410" },
    { kind: "pause", ms: 700 },
    { kind: "send" },
  ];
}

export const CHANNELS = [
  { name: "general" },
  { name: "design-crit" },
  { name: "eng-web", unread: 3 },
  { name: "launch", active: true },
  { name: "support" },
] as const;

/**
 * The mock clock in the page's language: "10:02 AM" in English, "10:02" where 24-hour time is
 * usual. `short` drops the AM/PM part (the gutter of a grouped message).
 */
export function formatClock(minute: number, lang: string, short = false): string {
  const date = new Date(Date.UTC(2026, 8, 30, Math.floor(minute / 60) % 24, minute % 60));
  const parts = new Intl.DateTimeFormat(lang, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).formatToParts(date);
  return parts
    .filter((part) => !short || part.type === "hour" || part.type === "minute" || part.type === "literal")
    .map((part) => part.value)
    .join("")
    .trim();
}
