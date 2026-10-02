// The tests are type-checked without Node types (tsconfig `types: []`). These declare the two
// Node/Vite features the store tests use to run the real migrations on SQLite.

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
  glob<T>(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, T>;
}
