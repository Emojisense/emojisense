/**
 * The subset of the D1 binding that the shared modules use. Declared structurally, so the real
 * binding of both Workers, the dashboard's own D1 type and the SQLite fakes in tests all fit.
 */
export type SqlValue = string | number | null;

export interface D1StatementLike {
  bind(...values: SqlValue[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
  /** Runs the statements as one transaction. */
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
}

/** A validation result that the dashboard and the API map to their own error format. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; message: string };
