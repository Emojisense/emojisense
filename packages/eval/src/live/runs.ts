/**
 * Stored runs of a live eval (one JSON file per label, e.g. reports/photos.before.json) and the
 * Markdown report that compares them side by side.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApiResult } from "./api.ts";
import { canonicalEmoji, type Judged, type PrecisionSummary } from "./precision.ts";

export type LiveKind = "photos" | "reactions";

export interface LiveItem {
  id: string;
  /** Caption (photos) or message text (reactions). */
  input: string;
  answers: string[];
  forbid?: string[];
  judged: Judged;
  results: Pick<ApiResult, "emoji" | "source">[];
  keywords?: string[];
  ms?: number;
  error?: string;
}

export interface LiveRun {
  kind: LiveKind;
  label: string;
  date: string;
  api: string;
  summary: PrecisionSummary;
  failed: number;
  items: LiveItem[];
}

const LABEL = /^[\w-]{1,32}$/;
const ORDER = ["before", "after"];

export function runPath(dir: string, kind: LiveKind, label: string): string {
  if (!LABEL.test(label)) throw new Error(`--label must be 1–32 letters, digits, "-" or "_"`);
  return join(dir, `${kind}.${label}.json`);
}

export function saveRun(dir: string, run: LiveRun): string {
  const path = runPath(dir, run.kind, run.label);
  writeFileSync(path, `${JSON.stringify(run, null, 1)}\n`);
  return path;
}

/** All stored runs of one kind: "before" first, "after" second, then the others by date. */
export function loadRuns(dir: string, kind: LiveKind): LiveRun[] {
  if (!existsSync(dir)) return [];
  const pattern = new RegExp(`^${kind}\\.([\\w-]+)\\.json$`);
  const runs = readdirSync(dir)
    .filter((f) => pattern.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as LiveRun);
  const rank = (run: LiveRun) => {
    const i = ORDER.indexOf(run.label);
    return i === -1 ? ORDER.length : i;
  };
  return runs.sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date));
}

/** "🐶✓ 🐕✓ 😸 🐩": the top 4, acceptable ones marked, traps marked with ✗. */
export function markTop(item: LiveItem): string {
  if (item.error) return `error: ${item.error.slice(0, 40)}`;
  const ok = new Set(item.answers.map(canonicalEmoji));
  const traps = new Set((item.forbid ?? []).map(canonicalEmoji));
  const marked = item.judged.top.map((e) => {
    const c = canonicalEmoji(e);
    return ok.has(c) ? `${e}✓` : traps.has(c) ? `${e}✗` : e;
  });
  return marked.join(" ") || "–";
}

export interface ReportText {
  title: string;
  intro: string[];
  itemName: string;
  /** Extra notes under the summary table. */
  notes?: string[];
}

export function renderComparison(runs: LiveRun[], text: ReportText): string {
  const lines = [`# ${text.title}`, "", ...text.intro, ""];
  const row = (cells: (string | number)[]) => lines.push(`| ${cells.join(" | ")} |`);
  row(["Run", "Date", "Items", "P@1", "P@4", "Hit@4", "Trap@4", "P@4 ceiling", "Failed"]);
  row(["---", "---", "--:", "--:", "--:", "--:", "--:", "--:", "--:"]);
  for (const run of runs) {
    const s = run.summary;
    row([run.label, run.date.slice(0, 10), s.n, s.p1, s.p4, s.hit4, s.trap4, s.ceiling4, run.failed]);
  }
  if (text.notes?.length) lines.push("", ...text.notes);

  const ids = [...new Set(runs.flatMap((run) => run.items.map((item) => item.id)))];
  lines.push("", `## Per ${text.itemName}`, "", "✓ = acceptable, ✗ = known trap.", "");
  row([text.itemName, "Acceptable", ...runs.map((run) => `${run.label} (top 4)`)]);
  row(["---", "---", ...runs.map(() => "---")]);
  for (const id of ids) {
    const items = runs.map((run) => run.items.find((item) => item.id === id));
    const first = items.find((item) => item !== undefined) as LiveItem;
    row([id, first.answers.join(""), ...items.map((item) => (item ? markTop(item) : "–"))]);
  }

  const last = runs.at(-1);
  if (last) {
    lines.push("", `## Inputs (${last.label})`, "");
    row([text.itemName, "Input", "Keywords"]);
    row(["---", "---", "---"]);
    for (const item of last.items) {
      row([item.id, item.input.replace(/\|/g, "/"), (item.keywords ?? []).join(", ") || "–"]);
    }
  }
  return `${lines.join("\n")}\n`;
}
