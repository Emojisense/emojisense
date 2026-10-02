import type { KeyKind, Metric, PlanId } from "@emojisense/platform";

/** An API key joined with the plan of the account that owns its app: all a request needs. */
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

/** A usage_monthly row right after a flush: `count` is the row's new total. */
export type UsageTotal = UsageDelta;

/** Searches of one app for one normalized query on one UTC day (query_daily). */
export interface QueryCount {
  appId: string;
  /** "YYYY-MM-DD", UTC (dayOf). */
  day: string;
  query: string;
  searches: number;
  misses: number;
}

/** The Worker's view of the hosted-service database (packages/platform/migrations). */
export interface Store {
  findKeyByHash(hash: string): Promise<ApiKey | undefined>;
  readUsage(appId: string, period: string): Promise<UsageCounts>;
  /**
   * Adds the deltas to usage_monthly in one batch and returns each row's new total (one atomic
   * UPSERT per row, so the total before this flush is `total - delta`).
   */
  addUsage(deltas: readonly UsageDelta[]): Promise<UsageTotal[]>;
  /** Adds the counts to query_daily in one batch. Rows of apps that no longer exist are skipped. */
  addQueryCounts(counts: readonly QueryCount[]): Promise<void>;
}

/**
 * The subset of the D1 API this module uses. Declared structurally so the store can be tested
 * against a plain SQLite database (test/sqlite-d1.ts) without the Workers runtime.
 */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
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

// The plan lives on the account (migration 0002); the legacy apps.plan column is not read.
const FIND_KEY = `
  SELECT k.id, k.app_id, k.kind, k.allowed_origins, k.revoked_at, acc.plan
  FROM api_keys k
  JOIN apps a ON a.id = k.app_id
  JOIN accounts acc ON acc.id = a.account_id
  WHERE k.hash = ?`;
const READ_USAGE = "SELECT metric, count FROM usage_monthly WHERE app_id = ? AND period = ?";
const ADD_USAGE = `
  INSERT INTO usage_monthly (app_id, period, metric, count) VALUES (?, ?, ?, ?)
  ON CONFLICT (app_id, period, metric) DO UPDATE SET count = count + excluded.count
  RETURNING app_id, period, metric, count`;
/**
 * Selecting the app id from apps skips the row of a deleted app, instead of failing the whole
 * batch on the foreign key. (SQLite needs this WHERE to parse INSERT … SELECT … ON CONFLICT.)
 */
const ADD_QUERY_COUNT = `
  INSERT INTO query_daily (app_id, day, query, searches, misses)
  SELECT a.id, ?, ?, ?, ? FROM apps a WHERE a.id = ?
  ON CONFLICT (app_id, day, query) DO UPDATE SET
    searches = searches + excluded.searches,
    misses = misses + excluded.misses`;

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

/** The RETURNING rows of an addUsage batch (one D1 result per statement). */
function readTotals(results: unknown): UsageTotal[] {
  if (!Array.isArray(results)) return [];
  return results.flatMap((result) => {
    const rows = (result as { results?: unknown } | null)?.results;
    if (!Array.isArray(rows)) return [];
    return (rows as Array<{ app_id: string; period: string; metric: Metric; count: number }>).map((row) => ({
      appId: row.app_id,
      period: row.period,
      metric: row.metric,
      count: row.count,
    }));
  });
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
      if (deltas.length === 0) return [];
      const statement = db.prepare(ADD_USAGE);
      const results = await db.batch(deltas.map((d) => statement.bind(d.appId, d.period, d.metric, d.count)));
      return readTotals(results);
    },
    async addQueryCounts(counts) {
      if (counts.length === 0) return;
      const statement = db.prepare(ADD_QUERY_COUNT);
      await db.batch(counts.map((c) => statement.bind(c.day, c.query, c.searches, c.misses, c.appId)));
    },
  };
}

/** For tests and local runs without D1. Keys are registered by hash, like the real table. */
export function createMemoryStore(keys: Record<string, ApiKey> = {}) {
  const keysByHash = new Map(Object.entries(keys));
  const usage = new Map<string, number>();
  const usageKey = (appId: string, period: string, metric: string) => `${appId}|${period}|${metric}`;
  const queries = new Map<string, QueryCount>();
  const queryKey = (appId: string, day: string, query: string) => `${appId}|${day}|${query}`;
  const store: Store & {
    keys: Map<string, ApiKey>;
    usage: Map<string, number>;
    usageOf(appId: string, period: string, metric: Metric): number;
    queries: Map<string, QueryCount>;
    queryCountOf(appId: string, day: string, query: string): QueryCount | undefined;
  } = {
    keys: keysByHash,
    usage,
    usageOf: (appId, period, metric) => usage.get(usageKey(appId, period, metric)) ?? 0,
    queries,
    queryCountOf: (appId, day, query) => queries.get(queryKey(appId, day, query)),
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
      return deltas.map((d) => {
        const key = usageKey(d.appId, d.period, d.metric);
        const count = (usage.get(key) ?? 0) + d.count;
        usage.set(key, count);
        return { ...d, count };
      });
    },
    async addQueryCounts(counts) {
      for (const c of counts) {
        const key = queryKey(c.appId, c.day, c.query);
        const current = queries.get(key);
        if (current) {
          current.searches += c.searches;
          current.misses += c.misses;
        } else {
          queries.set(key, { ...c });
        }
      }
    },
  };
  return store;
}
