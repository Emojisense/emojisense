import type { D1Like } from "../store.ts";
import { CONCEPT_KINDS, type ConceptAnswer, type ConceptKind } from "./model.ts";

/** A stored concept answer: `answer` undefined = negative ("none"). */
export interface StoredConcept {
  answer: ConceptAnswer | undefined;
  /** The ranking for `contentHash`; another deployment ranks `answer` again. */
  ranked?: { contentHash: string; results: [string, number][]; display: string[] } | undefined;
  createdAt: number;
}

interface ConceptRow {
  status: string;
  answer: string | null;
  ranked: string | null;
  content_hash: string | null;
  created_at: number;
}

/** SHA-256 hex of "<locale>\n<normalized query>": the store never holds query text. */
export async function conceptKey(query: string, locale: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${locale}\n${query}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

function parseAnswer(raw: string | null): ConceptAnswer | undefined {
  if (!raw) return undefined;
  const value = JSON.parse(raw) as Partial<Record<keyof ConceptAnswer, unknown>>;
  const kind = (CONCEPT_KINDS as readonly string[]).includes(value.kind as string)
    ? (value.kind as ConceptKind)
    : "other";
  const answer = { kind, terms: strings(value.terms), emoji: strings(value.emoji) };
  return answer.terms.length > 0 || answer.emoji.length > 0 ? answer : undefined;
}

function parseRanked(raw: string | null, contentHash: string | null): StoredConcept["ranked"] {
  if (!raw || !contentHash) return undefined;
  const value = JSON.parse(raw) as { results?: unknown; display?: unknown };
  const results = Array.isArray(value.results)
    ? value.results.filter(
        (r): r is [string, number] =>
          Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "number",
      )
    : [];
  return { contentHash, results, display: strings(value.display) };
}

/** D1 `concept_cache` and `concept_daily` (packages/platform/migrations/0007_concept_cache.sql). */
export function createConceptStore(db: D1Like) {
  return {
    async get(key: string, version: string): Promise<StoredConcept | undefined> {
      const row = await db
        .prepare(
          "SELECT status, answer, ranked, content_hash, created_at FROM concept_cache WHERE query_hash = ? AND version = ?",
        )
        .bind(key, version)
        .first<ConceptRow>();
      if (!row) return undefined;
      try {
        const answer = row.status === "ok" ? parseAnswer(row.answer) : undefined;
        return { answer, ranked: parseRanked(row.ranked, row.content_hash), createdAt: row.created_at };
      } catch {
        // A row this code cannot read is treated as missing; the next answer replaces it.
        return undefined;
      }
    },

    async put(key: string, version: string, stored: StoredConcept): Promise<void> {
      const { answer, ranked } = stored;
      await db
        .prepare(
          `INSERT INTO concept_cache (query_hash, version, status, answer, ranked, content_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (query_hash, version) DO UPDATE SET status = excluded.status, answer = excluded.answer,
             ranked = excluded.ranked, content_hash = excluded.content_hash, created_at = excluded.created_at`,
        )
        .bind(
          key,
          version,
          answer ? "ok" : "none",
          answer ? JSON.stringify(answer) : null,
          ranked ? JSON.stringify({ results: ranked.results, display: ranked.display }) : null,
          ranked?.contentHash ?? null,
          stored.createdAt,
        )
        .run();
    },

    /**
     * Count one model call of `day` unless the day already has `cap`. True = the call may go
     * ahead. One statement, so isolates racing each other cannot pass the cap together.
     */
    async takeDailyCall(day: string, cap: number): Promise<boolean> {
      if (cap <= 0) return false;
      const row = await db
        .prepare(
          `INSERT INTO concept_daily (day, calls) VALUES (?, 1)
           ON CONFLICT (day) DO UPDATE SET calls = calls + 1 WHERE calls < ?
           RETURNING calls`,
        )
        .bind(day, cap)
        .first<{ calls: number }>();
      return row !== null;
    },

    /** Delete answers created before `before` (ms) and counters of days before `beforeDay`. */
    async prune(before: number, beforeDay: string): Promise<number> {
      const deleted = await db.prepare("DELETE FROM concept_cache WHERE created_at < ?").bind(before).run();
      await db.prepare("DELETE FROM concept_daily WHERE day < ?").bind(beforeDay).run();
      return deleted.meta.changes;
    },
  };
}

export type ConceptStore = ReturnType<typeof createConceptStore>;
