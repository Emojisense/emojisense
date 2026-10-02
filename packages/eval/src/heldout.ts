/**
 * The held-out suite: queries written and labelled by a model family other than the alias
 * authors (DECISIONS.md, "the current eval set and the aliases were both written by Claude").
 * Same metrics as the in-house suite, reported per locale.
 */
import { readFileSync } from "node:fs";
import { LOCALE_CODES } from "@emojisense/data/locales";
import { normalize } from "emojisense";
import { macroAverage, type QueryOutcome, type Summary, summarize } from "./metrics.ts";
import type { EvalQuery } from "./queries.ts";

export interface HeldoutQuery extends EvalQuery {
  /** Who the generator simulated, e.g. "an office worker in a team chat in Brazil". */
  persona: string;
  /** The model that wrote the query and its answers. */
  labelled_by: string;
  /** What the generator was asked to write about, when it was given a topic. */
  topic?: string;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function problemOf(q: Partial<HeldoutQuery>): string | undefined {
  if (!isText(q.id)) return "missing id";
  if (!isText(q.q) || normalize(q.q) === "") return `${q.id}: missing or empty q`;
  if (!isText(q.locale) || !LOCALE_CODES.includes(q.locale)) {
    return `${q.id}: locale "${q.locale}" is not one of ${LOCALE_CODES.join(", ")}`;
  }
  if (!Array.isArray(q.answers) || q.answers.length === 0 || !q.answers.every(isText)) {
    return `${q.id}: answers must be a non-empty list of emoji`;
  }
  if (!isText(q.persona)) return `${q.id}: missing persona`;
  if (!isText(q.labelled_by)) return `${q.id}: missing labelled_by`;
  if (q.cat !== undefined && q.cat !== `heldout-${q.locale}`) {
    return `${q.id}: cat must be "heldout-${q.locale}"`;
  }
  return undefined;
}

/** Parse heldout.jsonl. Throws on the first invalid line, a duplicate id or a duplicate query. */
export function parseHeldout(text: string, source = "heldout.jsonl"): HeldoutQuery[] {
  const lineOfId = new Map<string, number>();
  const lineOfQuery = new Map<string, number>();
  const queries: HeldoutQuery[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const lineNo = index + 1;
    let parsed: Partial<HeldoutQuery>;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`${source} line ${lineNo}: not valid JSON`);
    }
    const problem = problemOf(parsed);
    if (problem) throw new Error(`${source} line ${lineNo}: ${problem}`);
    const q = { ...parsed, cat: `heldout-${parsed.locale}` } as HeldoutQuery;
    const firstId = lineOfId.get(q.id);
    if (firstId) throw new Error(`${source} line ${lineNo}: duplicate id ${q.id} (first on line ${firstId})`);
    const key = `${q.locale}\t${normalize(q.q)}`;
    const firstQuery = lineOfQuery.get(key);
    if (firstQuery) {
      throw new Error(`${source} line ${lineNo}: "${q.q}" (${q.locale}) repeats line ${firstQuery}`);
    }
    lineOfId.set(q.id, lineNo);
    lineOfQuery.set(key, lineNo);
    queries.push(q);
  });
  return queries;
}

export function loadHeldout(path: string): HeldoutQuery[] {
  return parseHeldout(readFileSync(path, "utf8"), path.split("/").at(-1));
}

/** Locales of the queries, in LOCALE_CODES order. */
export function localesOf(queries: readonly HeldoutQuery[]): string[] {
  const present = new Set(queries.map((q) => q.locale));
  return LOCALE_CODES.filter((code) => present.has(code));
}

/** Overall (every query counts once), macro (every locale counts once) and per-locale scores. */
export interface LocaleScores {
  overall: Summary;
  macro: Summary;
  byLocale: Record<string, Summary>;
}

export function scoreByLocale(
  queries: readonly HeldoutQuery[],
  outcomes: readonly QueryOutcome[],
): LocaleScores {
  const localeOf = new Map(queries.map((q) => [q.id, q.locale]));
  const byLocale: Record<string, Summary> = {};
  for (const locale of localesOf(queries)) {
    byLocale[locale] = summarize(outcomes.filter((o) => localeOf.get(o.id) === locale));
  }
  return { overall: summarize([...outcomes]), macro: macroAverage(Object.values(byLocale)), byLocale };
}

export interface Miss {
  id: string;
  /** Rank in the mode the misses are taken from (0 = not in the list). */
  rank: number;
  /** Rank of the same query in the comparison mode, when there is one. */
  otherRank?: number;
  top: string[];
}

/** Larger = worse. A query that is not in the list at all is worse than any rank. */
const severity = (rank: number | undefined) =>
  rank === undefined ? -1 : rank === 0 ? Number.MAX_SAFE_INTEGER : rank;

/**
 * Queries with no acceptable answer in the top `k`, worst first: not in the list at all, then
 * found further down. Ties go to the query the comparison mode also misses, then to the id.
 */
export function worstMisses(
  outcomes: readonly QueryOutcome[],
  options: { k?: number; limit?: number; compareWith?: readonly QueryOutcome[] } = {},
): Miss[] {
  const { k = 5, limit = 10, compareWith = [] } = options;
  const other = new Map(compareWith.map((o) => [o.id, o.rank]));
  return outcomes
    .filter((o) => o.rank === 0 || o.rank > k)
    .map((o) => ({
      id: o.id,
      rank: o.rank,
      ...(other.has(o.id) ? { otherRank: other.get(o.id) } : {}),
      top: o.top,
    }))
    .sort(
      (a, b) =>
        severity(b.rank) - severity(a.rank) ||
        severity(b.otherRank) - severity(a.otherRank) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

// ── Soft gate ─────────────────────────────────────────────────────────────────────────────

/** mode → ("all" | locale) → score. Stored as reports/heldout-baseline.json. */
export type HeldoutBaseline = Record<string, Record<string, { n: number; r5: number; mrr: number }>>;

export function toBaseline(modes: readonly { name: string; scores: LocaleScores }[]): HeldoutBaseline {
  const pick = ({ n, r5, mrr }: Summary) => ({ n, r5, mrr });
  return Object.fromEntries(
    modes.map(({ name, scores }) => [
      name,
      {
        all: pick(scores.overall),
        ...Object.fromEntries(Object.entries(scores.byLocale).map(([l, s]) => [l, pick(s)])),
      },
    ]),
  );
}

/**
 * Recall@5 drops against the baseline. One locale has few queries, so its tolerance is wider
 * than the overall one. Modes or locales missing on either side are not compared.
 */
export function heldoutRegressions(
  current: HeldoutBaseline,
  baseline: HeldoutBaseline,
  tolerance = { overall: 2, locale: 5 },
): string[] {
  const messages: string[] = [];
  for (const [mode, scores] of Object.entries(current)) {
    for (const [scope, score] of Object.entries(scores)) {
      const before = baseline[mode]?.[scope];
      if (!before) continue;
      const allowed = scope === "all" ? tolerance.overall : tolerance.locale;
      if (score.r5 < before.r5 - allowed) {
        messages.push(
          `held-out ${mode} [${scope}]: recall@5 ${score.r5} < baseline ${before.r5} − ${allowed} (n=${score.n})`,
        );
      }
    }
  }
  return messages;
}
