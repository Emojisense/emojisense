/**
 * Made-up data for locked features: the page renders it faded under the plan card, so people see
 * what they would get. It ships in the production bundle, so it stays small; mock mode has its own.
 */
import type { AnalyticsResponse, KeySummary, TeamResponse } from "../../shared/contract";
import type { Environment } from "./environments";

const DAY = 86_400_000;

export interface SampleEmoji {
  shortcode: string;
  glyph: string;
  tag: string;
}

export const SAMPLE_EMOJI: SampleEmoji[] = [
  { shortcode: "shipit", glyph: "🐿️", tag: "uploaded" },
  { shortcode: "partyparrot", glyph: "🦜", tag: "from slack" },
  { shortcode: "lgtm", glyph: "✅", tag: "uploaded" },
  { shortcode: "this-is-fine", glyph: "🔥", tag: "from slack" },
  { shortcode: "blobwave", glyph: "👋", tag: "from discord" },
  { shortcode: "catjam", glyph: "🐈", tag: "from discord" },
  { shortcode: "galaxy-brain", glyph: "🧠", tag: "uploaded" },
  { shortcode: "coffee-time", glyph: "☕", tag: "uploaded" },
  { shortcode: "launch", glyph: "🚀", tag: "via api" },
  { shortcode: "thanks-team", glyph: "🙏", tag: "from slack" },
  { shortcode: "big-mood", glyph: "🫠", tag: "uploaded" },
  { shortcode: "nailed-it", glyph: "💅", tag: "from slack" },
];

const ORIGINS: Record<Environment, string[]> = {
  prod: ["https://app.example.com"],
  staging: ["https://staging.example.com", "https://*.preview.example.com"],
  dev: [],
};

/** One publishable and one secret key of `environment`, for a locked Keys tab. */
export function sampleKeys(appId: string, environment: Environment, now = Date.now()): KeySummary[] {
  const short = environment === "staging" ? "Stg" : environment === "dev" ? "Dev" : "Prd";
  return [
    {
      id: `sample_${environment}_pk`,
      appId,
      kind: "publishable",
      environment,
      prefix: `pk_live_${short}4`,
      allowedOrigins: ORIGINS[environment],
      createdAt: now - 3 * DAY,
      revokedAt: null,
    },
    {
      id: `sample_${environment}_sk`,
      appId,
      kind: "secret",
      environment,
      prefix: `sk_live_${short}9`,
      allowedOrigins: [],
      createdAt: now - 12 * DAY,
      revokedAt: null,
    },
  ];
}

/** Thirty days of a busy chat app: weekdays higher, a slow rise, a few misses a day. */
export function sampleAnalytics(now = Date.now()): AnalyticsResponse {
  const today = Math.floor(now / DAY) * DAY;
  const days = Array.from({ length: 30 }, (_, index) => {
    const time = today - (29 - index) * DAY;
    const weekday = new Date(time).getUTCDay();
    const base = 900 + index * 22 + (weekday === 0 || weekday === 6 ? -260 : 120);
    const searches = base + ((index * 137) % 180);
    return { day: new Date(time).toISOString().slice(0, 10), searches, misses: Math.round(searches * 0.06) };
  });
  return {
    days,
    topQueries: [
      { query: "ship it", searches: 2_840 },
      { query: "facepalm", searches: 1_965 },
      { query: "no cap", searches: 1_412 },
      { query: "sleepy monday", searches: 1_108 },
      { query: "party", searches: 987 },
    ],
    topMisses: [
      { query: "deploy friday", misses: 214 },
      { query: "standup", misses: 168 },
      { query: "our mascot", misses: 121 },
    ],
    countries: [
      { country: "US", searches: 14_220, misses: 840 },
      { country: "BR", searches: 6_310, misses: 402 },
      { country: "DE", searches: 3_980, misses: 251 },
      { country: "IN", searches: 3_440, misses: 220 },
    ],
    locales: [
      { locale: "en", searches: 19_870, misses: 1_180 },
      { locale: "pt", searches: 6_020, misses: 380 },
      { locale: "de", searches: 3_610, misses: 230 },
    ],
    filters: { country: null, locale: null },
  };
}

export function sampleTeam(now = Date.now()): TeamResponse {
  return {
    ownerId: "sample_owner",
    role: "owner",
    members: [
      { id: "sample_owner", name: "You", email: null, role: "owner", createdAt: now - 90 * DAY },
      {
        id: "sample_dana",
        name: "Dana Ortiz",
        email: "dana@example.com",
        role: "admin",
        createdAt: now - 40 * DAY,
      },
      {
        id: "sample_kai",
        name: "Kai Tanaka",
        email: "kai@example.com",
        role: "developer",
        createdAt: now - 12 * DAY,
      },
      {
        id: "sample_lee",
        name: "Lee Moreau",
        email: "lee@example.com",
        role: "viewer",
        createdAt: now - 3 * DAY,
      },
    ],
    invites: [],
  };
}
