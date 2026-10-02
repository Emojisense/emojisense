// The tests are type-checked with the Workers types only. These declare the Node/Vite features
// the tests use: SQLite and raw imports for the real migrations (test/sqlite-d1.ts), and
// `import.meta.url` to find wrangler.jsonc (test/shards-miniflare.test.ts).

declare module "node:sqlite" {
  export class StatementSync {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): { changes: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

interface ImportMeta {
  readonly url: string;
  glob<T>(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, T>;
}

// Raw text imports (Vite): the culture policy files in test/culture-admin-fixtures.ts.
declare module "*?raw" {
  const text: string;
  export default text;
}
