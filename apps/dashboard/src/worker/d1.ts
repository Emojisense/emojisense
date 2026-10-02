/**
 * The subset of the D1 binding the dashboard uses. Declared here instead of importing
 * @cloudflare/workers-types, whose globals clash with the DOM types of the SPA and tests.
 * The runtime D1Database matches it structurally, and so does the test fake.
 */
export interface D1Meta {
  changes: number;
  last_row_id: number;
}

export interface D1Result<T> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export type D1Value = string | number | null;

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
