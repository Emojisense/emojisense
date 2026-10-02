/**
 * Fixture data for mock mode (VITE_MOCK=1, dev server only). One account, three apps, custom
 * emoji, tenants, webhooks, a team and 90 days of analytics. Numbers are made up but shaped like
 * a real chat product; they never reach a production build.
 */
import { METRICS, type Metric, PLANS, type PlanId, periodOf } from "@emojisense/platform";
import type { AppMetricUsage, KeySummary, MetricUsage } from "../../shared/contract";
import type {
  AnalyticsDay,
  AnalyticsResponse,
  App,
  CustomEmoji,
  Me,
  TeamInviteSummary,
  TeamMemberSummary,
  Tenant,
  Webhook,
  WebhookDelivery,
} from "../api";

const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number, hours = 0) => NOW - days * DAY - hours * 3_600_000;

const images = import.meta.glob<string>("./emoji/*/*.svg", { query: "?url", import: "default", eager: true });
const imageFor = (set: string, file: string) =>
  images[`./emoji/${set}/${file}.svg`] ??
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#d3d3db"/></svg>`,
  )}`;

export interface MockDb {
  /** The signed-in account's own plan. Team apps keep their owner's plan (`App.plan`). */
  plan: PlanId;
  waitlistPlan: PlanId | null;
  me: Omit<Me, "plan" | "appCount" | "waitlistPlan">;
  apps: Omit<App, "activeKeyCount">[];
  keys: KeySummary[];
  emoji: (CustomEmoji & { appId: string })[];
  tenants: (Omit<Tenant, "emojiCount"> & { appId: string })[];
  /** `lastDelivery` is derived from `deliveries` when a webhook is served. */
  webhooks: Omit<Webhook, "lastDelivery">[];
  /** Newest first, per webhook id. */
  deliveries: Record<string, WebhookDelivery[]>;
  /** The own team; the first member is the owner. */
  members: TeamMemberSummary[];
  invites: TeamInviteSummary[];
  /** Ada Park's team, which the signed-in account joined as a developer. */
  otherTeam: { ownerId: string; members: TeamMemberSummary[] };
  /** Share of each limit used this month, per app. */
  usageShare: Record<string, Partial<Record<Metric, number>>>;
}

/** A small seeded random generator (mulberry32), so every load shows the same numbers. */
export function seeded(seed: string): () => number {
  let state =
    [...seed].reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 2654435761), 1779033703) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RELAY = "app_relay_prod";
const STAGING = "app_relay_staging";
const LAB = "app_emoji_lab";
const OWN = { role: "owner", ownerId: "acc_maya", ownerName: "Maya Chen" } as const;

type Seed = [set: string, file: string, shortcode: string, aliases: string[], source: CustomEmoji["source"]];

const APP_WIDE: Seed[] = [
  ["acme", "shipit-rocket", "shipit", ["ship it", "launch", "deploy"], "upload"],
  ["acme", "lgtm", "lgtm", ["looks good to me", "approved"], "slack"],
  ["acme", "on-call", "on-call", ["pager", "on call", "incident"], "slack"],
  ["acme", "deploy-friday", "deploy-friday", ["friday deploy", "yolo"], "upload"],
  ["acme", "merge-conflict", "merge-conflict", ["git conflict", "rebase"], "slack"],
  ["acme", "cold-brew", "cold-brew", ["coffee", "iced coffee"], "upload"],
  ["acme", "plus-one", "plus-one", ["+1", "agree", "same"], "slack"],
  ["acme", "launch-party", "launch-party", ["celebrate", "party", "launch"], "upload"],
  ["guild", "crit", "crit", ["critical hit", "nat 20"], "discord"],
  ["guild", "gg", "gg", ["good game", "well played"], "discord"],
  ["guild", "level-up", "level-up", ["ding", "level up"], "discord"],
  ["guild", "loot", "loot", ["treasure", "drop"], "discord"],
  ["guild", "mana-potion", "mana-potion", ["mana", "potion"], "discord"],
  ["guild", "patch-notes", "patch-notes", ["changelog", "release notes"], "discord"],
  ["guild", "raid-night", "raid-night", ["raid", "tonight"], "discord"],
  ["guild", "respawn", "respawn", ["revive", "back again"], "discord"],
];

const BLOOM: Seed[] = [
  ["bloom", "cake-day", "cake-day", ["birthday", "anniversary"], "api"],
  ["bloom", "espresso-shot", "espresso-shot", ["espresso", "coffee"], "api"],
  ["bloom", "fresh-bake", "fresh-bake", ["bread", "fresh"], "api"],
  ["bloom", "latte-art", "latte-art", ["latte", "coffee art"], "api"],
  ["bloom", "oat-milk", "oat-milk", ["oat", "dairy free"], "api"],
  ["bloom", "order-up", "order-up", ["order ready", "pickup"], "api"],
  ["bloom", "rush-hour", "rush-hour", ["busy", "rush"], "api"],
  ["bloom", "tip-jar", "tip-jar", ["tips", "thank you"], "api"],
];

function emojiFrom(seeds: Seed[], appId: string, tenantId: string | null, offset: number): MockDb["emoji"] {
  return seeds.map(([set, file, shortcode, aliases, source], index) => ({
    id: `emo_${set}_${index}`,
    appId,
    shortcode,
    aliases,
    imageUrl: imageFor(set, file),
    tenantId,
    source,
    bytes: 640 + ((index * 337) % 900),
    createdAt: ago(offset + index * 2, index),
  }));
}

function key(
  id: string,
  appId: string,
  kind: KeySummary["kind"],
  prefix: string,
  allowedOrigins: string[],
  createdDaysAgo: number,
  revokedDaysAgo?: number,
): KeySummary {
  return {
    id,
    appId,
    kind,
    prefix,
    allowedOrigins,
    createdAt: ago(createdDaysAgo),
    revokedAt: revokedDaysAgo === undefined ? null : ago(revokedDaysAgo),
  };
}

export function createDb(plan: PlanId, waitlistPlan: PlanId | null): MockDb {
  const rows: [WebhookDelivery["event"], number | null, number | null, number][] = [
    ["custom_emoji.created", 200, 142, 0.2],
    ["custom_emoji.created", 200, 118, 3],
    ["tenant.created", 200, 96, 9],
    ["usage.threshold", 200, 131, 20],
    ["custom_emoji.deleted", 500, 2104, 26],
    ["custom_emoji.deleted", 200, 155, 26.1],
    ["custom_emoji.created", null, null, 50],
    ["custom_emoji.created", 200, 109, 50.3],
  ];
  const deliveries: WebhookDelivery[] = rows.map(([event, status, durationMs, hoursAgo], index) => ({
    id: `dlv_${index}`,
    event,
    status,
    ok: status !== null && status >= 200 && status < 300,
    durationMs,
    createdAt: NOW - hoursAgo * 3_600_000,
  }));

  return {
    plan,
    waitlistPlan,
    me: {
      account: {
        id: "acc_maya",
        name: "Maya Chen",
        email: "maya@relay.chat",
        githubLinked: true,
        createdAt: Date.UTC(2026, 2, 2),
      },
      teams: [{ ownerId: "acc_ada", ownerName: "Ada Park", role: "developer" }],
    },
    apps: [
      {
        ...OWN,
        id: RELAY,
        name: "Relay",
        environment: "prod",
        plan,
        createdAt: Date.UTC(2026, 2, 14),
        emojiSet: "native",
      },
      {
        ...OWN,
        id: STAGING,
        name: "Relay",
        environment: "staging",
        plan,
        createdAt: Date.UTC(2026, 5, 2),
        emojiSet: "native",
      },
      {
        id: LAB,
        name: "Emoji lab",
        environment: "dev",
        // A team app runs on its owner's plan, whatever the signed-in account pays for.
        plan: "pro",
        createdAt: Date.UTC(2026, 8, 21),
        emojiSet: "twemoji",
        role: "developer",
        ownerId: "acc_ada",
        ownerName: "Ada Park",
      },
    ],
    keys: [
      key(
        "key_relay_pk",
        RELAY,
        "publishable",
        "pk_live_R3lA",
        ["https://relay.chat", "https://*.relay.chat"],
        182,
      ),
      key("key_relay_sk", RELAY, "secret", "sk_live_9xQe", [], 120),
      key("key_relay_old", RELAY, "publishable", "pk_live_Ol7d", ["https://beta.relay.chat"], 201, 150),
      key("key_staging_pk", STAGING, "publishable", "pk_live_St4g", ["https://staging.relay.chat"], 90),
      key("key_lab_pk", LAB, "publishable", "pk_live_L4bz", [], 11),
    ],
    emoji: [...emojiFrom(APP_WIDE, RELAY, null, 4), ...emojiFrom(BLOOM, RELAY, "ten_bloom", 1)],
    tenants: [
      { id: "ten_bloom", appId: RELAY, externalId: "bloom-bakery", name: "Bloom Bakery", createdAt: ago(40) },
      {
        id: "ten_northwind",
        appId: RELAY,
        externalId: "northwind",
        name: "Northwind Ops",
        createdAt: ago(18),
      },
      { id: "ten_orbit", appId: RELAY, externalId: "org_8f2k1", name: null, createdAt: ago(3) },
    ],
    webhooks: [
      {
        id: "whk_relay_main",
        appId: RELAY,
        url: "https://api.relay.chat/hooks/emojisense",
        events: [
          "custom_emoji.created",
          "custom_emoji.deleted",
          "tenant.created",
          "tenant.deleted",
          "usage.threshold",
        ],
        enabled: true,
        createdAt: ago(60),
        disabledAt: null,
      },
      {
        id: "whk_relay_ops",
        appId: RELAY,
        url: "https://ops.relay.chat/alerts/usage",
        events: ["usage.threshold"],
        enabled: false,
        createdAt: ago(33),
        disabledAt: ago(2),
      },
    ],
    deliveries: { whk_relay_main: deliveries, whk_relay_ops: [] },
    members: [
      {
        id: "acc_maya",
        name: "Maya Chen",
        email: "maya@relay.chat",
        role: "owner",
        createdAt: Date.UTC(2026, 2, 2),
      },
      { id: "acc_jonas", name: "Jonas Weber", email: "jonas@relay.chat", role: "admin", createdAt: ago(140) },
      {
        id: "acc_priya",
        name: "Priya Raman",
        email: "priya@relay.chat",
        role: "developer",
        createdAt: ago(64),
      },
      { id: "acc_leo", name: "Leo Martins", email: "leo@relay.chat", role: "viewer", createdAt: ago(12) },
    ],
    invites: [
      { id: "inv_sam", role: "developer", email: "sam@relay.chat", createdAt: ago(2), expiresAt: ago(-5) },
      { id: "inv_link", role: "viewer", email: null, createdAt: ago(5), expiresAt: ago(-2) },
    ],
    otherTeam: {
      ownerId: "acc_ada",
      members: [
        {
          id: "acc_ada",
          name: "Ada Park",
          email: "ada@parklabs.dev",
          role: "owner",
          createdAt: Date.UTC(2025, 10, 4),
        },
        {
          id: "acc_maya",
          name: "Maya Chen",
          email: "maya@relay.chat",
          role: "developer",
          createdAt: ago(30),
        },
        {
          id: "acc_tom",
          name: "Tomás Ruiz",
          email: "tomas@parklabs.dev",
          role: "admin",
          createdAt: ago(210),
        },
      ],
    },
    usageShare: {
      [RELAY]: { semantic_calls: 0.83, image_classifications: 0.41 },
      [STAGING]: { semantic_calls: 0.04, image_classifications: 0.01 },
      [LAB]: { semantic_calls: 0.002 },
    },
  };
}

export function measure(metric: Metric, used: number, limit: number): MetricUsage {
  if (!Number.isFinite(limit)) return { metric, used, limit: null, percent: 0, status: "ok" };
  if (limit <= 0) return { metric, used, limit: 0, percent: 0, status: "not_included" };
  const percent = Math.min(100, Math.floor((used / limit) * 1000) / 10);
  const status = used >= limit ? "over_limit" : percent >= 80 ? "near_limit" : "ok";
  return { metric, used, limit, percent, status };
}

/** One app's own count of a metric in a period. Custom emoji are rows: the stored count. */
export function appCount(db: MockDb, appId: string, metric: Metric, period: string): number {
  if (metric === "custom_emoji") return db.emoji.filter((emoji) => emoji.appId === appId).length;
  const limits = PLANS[db.apps.find((app) => app.id === appId)?.plan ?? db.plan].limits;
  // Earlier months are a little lower, so switching months shows a change.
  const factor = period === periodOf() ? 1 : 0.74 + seeded(`${appId}:${period}`)() * 0.2;
  const share = db.usageShare[appId]?.[metric] ?? 0;
  const limit = Number.isFinite(limits[metric]) ? limits[metric] : PLANS.scale.limits[metric];
  return Math.round(limit * share * factor);
}

/** Ids of every app of the account that owns `appId`: plan limits count all of them. */
export function accountAppIds(db: MockDb, appId: string): string[] {
  const ownerId = db.apps.find((item) => item.id === appId)?.ownerId;
  return db.apps.filter((item) => item.ownerId === ownerId).map((item) => item.id);
}

/** What the custom emoji limit counts: every emoji of every app of the owning account. */
export function accountEmojiCount(db: MockDb, appId: string): number {
  const appIds = new Set(accountAppIds(db, appId));
  return db.emoji.filter((emoji) => appIds.has(emoji.appId)).length;
}

/** `lgtm` and `plus-one` exist in Relay already, so an import there skips them as `exists`. */
const IMPORT_NAMES = [
  "lgtm",
  "plus-one",
  "blob-wave",
  "party-parrot",
  "this-is-fine",
  "catjam",
  "kekw",
  "pog",
  "sadge",
  "nyan",
  "yay",
  "nod",
  "salute",
  "coffee-time",
  "eyes-wide",
  "big-brain",
  "hype",
  "facepalm-hd",
];

export interface ImportListing {
  candidates: { shortcode: string; imageUrl: string; bytes: number }[];
  /** Slack aliases of other emoji, never imported. */
  aliases: number;
  /** Entries whose name breaks the shortcode rules. */
  invalid: number;
}

/**
 * A made-up Slack workspace or Discord server. The same token lists the same emoji every time,
 * and there are more than one import batch (50) of them, so the dialog shows its progress.
 */
export function importListing(source: "slack" | "discord", token: string): ImportListing {
  const random = seeded(`${source}:${token}`);
  const urls = Object.values(images);
  const count = 60 + Math.floor(random() * 80);
  const candidates = Array.from({ length: count }, (_, index) => {
    const name = IMPORT_NAMES[index % IMPORT_NAMES.length] ?? "emoji";
    const round = Math.floor(index / IMPORT_NAMES.length);
    return {
      shortcode: round === 0 ? name : `${name}-${round + 1}`,
      imageUrl: urls[index % urls.length] ?? imageFor("acme", "lgtm"),
      bytes: 900 + Math.floor(random() * 4_000),
    };
  });
  return {
    candidates,
    aliases: source === "slack" ? 2 + Math.floor(random() * 5) : 0,
    invalid: Math.floor(random() * 3),
  };
}

/**
 * `GET /api/apps/:id/usage`: metering is per account, so `used` sums every app of the owner and
 * `appUsed` is this app's part. Custom emoji are the rows stored now, in every period.
 */
export function usageFor(db: MockDb, appId: string, period: string): AppMetricUsage[] {
  const app = db.apps.find((item) => item.id === appId);
  const limits = PLANS[app?.plan ?? db.plan].limits;
  const siblings = accountAppIds(db, appId);
  return METRICS.map((metric) => {
    const used = siblings.reduce((sum, id) => sum + appCount(db, id, metric, period), 0);
    return { ...measure(metric, used, limits[metric]), appUsed: appCount(db, appId, metric, period) };
  });
}

const QUERIES = [
  "lol",
  "thanks",
  "ship it",
  "party",
  "fire",
  "love",
  "yes",
  "coffee",
  "sad",
  "eyes",
  "ok",
  "lgtm",
  "facepalm",
  "clap",
  "100",
  "rocket",
  "pray",
  "skull",
  "wave",
  "deadline",
];
const MISSES = [
  "rizz",
  "relay logo",
  "standup",
  "delulu",
  "hotfix",
  "touch grass",
  "sprint demo",
  "brb",
  "big brain",
  "slay",
  "ngl",
  "mid",
];

export function analyticsFor(appId: string, requested: number, retention: number): AnalyticsResponse {
  const window = Math.min(requested, retention);
  const random = seeded(`analytics:${appId}`);
  const base = appId === RELAY ? 1_380 : appId === STAGING ? 64 : 9;
  // 90 days are generated so that a shorter window is the tail of the same series.
  const all: AnalyticsDay[] = Array.from({ length: 90 }, (_, index) => {
    const date = new Date(NOW - (89 - index) * DAY);
    const weekday = date.getUTCDay();
    const weekly = weekday === 0 || weekday === 6 ? 0.62 : weekday === 1 ? 1.08 : 1;
    const trend = 0.72 + (index / 89) * 0.42;
    const spike = index === 61 ? 1.9 : 1;
    const searches = Math.round(base * weekly * trend * spike * (0.88 + random() * 0.24));
    const misses = Math.round(searches * (0.05 + random() * 0.035));
    return { day: date.toISOString().slice(0, 10), searches, misses };
  });
  const days = all.slice(-window);
  const total = days.reduce((sum, day) => sum + day.searches, 0);
  const totalMisses = days.reduce((sum, day) => sum + day.misses, 0);
  const share = (index: number, count: number) => 1 / (index + 1.6) ** 1.15 / (count / 4);
  return {
    days,
    topQueries: QUERIES.map((query, index) => ({
      query,
      searches: Math.max(5, Math.round(total * 0.42 * share(index, QUERIES.length))),
    })),
    topMisses: MISSES.map((query, index) => ({
      query,
      misses: Math.max(5, Math.round(totalMisses * 0.6 * share(index, MISSES.length))),
    })),
  };
}
