import type { KeyKind, Metric, PlanId } from "@emojisense/platform";

/** An API key joined with its app's plan: everything a request needs to be authorized. */
export interface ApiKey {
  id: string;
  appId: string;
  kind: KeyKind;
  plan: PlanId;
  /** Publishable keys only. Empty = any origin (development keys). */
  allowedOrigins: string[];
  revoked: boolean;
}

export interface UsageDelta {
  appId: string;
  /** "YYYY-MM", UTC (periodOf). */
  period: string;
  metric: Metric;
  count: number;
}

export type UsageCounts = Partial<Record<Metric, number>>;

/** The Worker's view of the hosted-service database (packages/platform/migrations). */
export interface Store {
  findKeyByHash(hash: string): Promise<ApiKey | undefined>;
  readUsage(appId: string, period: string): Promise<UsageCounts>;
  /** Adds the deltas to usage_monthly in one batch. */
  addUsage(deltas: readonly UsageDelta[]): Promise<void>;
}

/**
 * The subset of the D1 API this module uses. Declared structurally so the store can be tested
 * against a plain SQLite database (test/d1-store.test.ts) without the Workers runtime.
 */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}

export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

interface KeyJoinRow {
  id: string;
  app_id: string;
  kind: KeyKind;
  allowed_origins: string;
  revoked_at: number | null;
  plan: PlanId;
}

const FIND_KEY = `
  SELECT k.id, k.app_id, k.kind, k.allowed_origins, k.revoked_at, a.plan
  FROM api_keys k JOIN apps a ON a.id = k.app_id
  WHERE k.hash = ?`;
const READ_USAGE = "SELECT metric, count FROM usage_monthly WHERE app_id = ? AND period = ?";
const ADD_USAGE = `
  INSERT INTO usage_monthly (app_id, period, metric, count) VALUES (?, ?, ?, ?)
  ON CONFLICT (app_id, period, metric) DO UPDATE SET count = count + excluded.count`;

/** Matches no real Origin header. An empty list would mean "any origin". */
const NO_ORIGIN = ["null:deny"];

function parseOrigins(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every((o) => typeof o === "string")) return value;
  } catch {
    // Fall through.
  }
  // A corrupt row must not open the key to every origin.
  return NO_ORIGIN;
}

export function createD1Store(db: D1Like): Store {
  return {
    async findKeyByHash(hash) {
      const row = await db.prepare(FIND_KEY).bind(hash).first<KeyJoinRow>();
      if (!row) return undefined;
      return {
        id: row.id,
        appId: row.app_id,
        kind: row.kind,
        plan: row.plan,
        allowedOrigins: parseOrigins(row.allowed_origins),
        revoked: row.revoked_at !== null,
      };
    },
    async readUsage(appId, period) {
      const { results } = await db
        .prepare(READ_USAGE)
        .bind(appId, period)
        .all<{ metric: Metric; count: number }>();
      return Object.fromEntries(results.map((r) => [r.metric, r.count]));
    },
    async addUsage(deltas) {
      if (deltas.length === 0) return;
      const statement = db.prepare(ADD_USAGE);
      await db.batch(deltas.map((d) => statement.bind(d.appId, d.period, d.metric, d.count)));
    },
  };
}

/** For tests and local runs without D1. Keys are registered by hash, like the real table. */
export function createMemoryStore(keys: Record<string, ApiKey> = {}) {
  const keysByHash = new Map(Object.entries(keys));
  const usage = new Map<string, number>();
  const usageKey = (appId: string, period: string, metric: string) => `${appId}|${period}|${metric}`;
  const store: Store & {
    keys: Map<string, ApiKey>;
    usage: Map<string, number>;
    usageOf(appId: string, period: string, metric: Metric): number;
  } = {
    keys: keysByHash,
    usage,
    usageOf: (appId, period, metric) => usage.get(usageKey(appId, period, metric)) ?? 0,
    async findKeyByHash(hash) {
      // A copy, like a fresh D1 row: callers may cache it while the "table" changes.
      const key = keysByHash.get(hash);
      return key && { ...key, allowedOrigins: [...key.allowedOrigins] };
    },
    async readUsage(appId, period) {
      const prefix = `${appId}|${period}|`;
      return Object.fromEntries(
        [...usage].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]),
      );
    },
    async addUsage(deltas) {
      for (const d of deltas) {
        const key = usageKey(d.appId, d.period, d.metric);
        usage.set(key, (usage.get(key) ?? 0) + d.count);
      }
    },
  };
  return store;
}
