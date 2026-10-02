import { localeInfo } from "@emojisense/data/locales";
import { type HeldoutQuery, worstMisses } from "./heldout.ts";
import type { HeldoutMode, HeldoutRun } from "./heldout-run.ts";
import { type Summary, summarize } from "./metrics.ts";

/** In-house suite scores of the same engines, to show next to the held-out ones. */
export interface InHouseScores {
  source: string;
  alias: Summary;
  fused?: Summary;
}

const rankCell = (rank: number | undefined) => (rank === undefined ? "" : rank === 0 ? "–" : String(rank));
const delta = (a: number, b: number) =>
  `${b - a >= 0 ? "+" : ""}${(Math.round((b - a) * 10) / 10).toFixed(1)}`;
const pipe = (text: string) => text.replace(/\|/g, "\\|");

export function renderHeldoutReport(
  run: HeldoutRun,
  context: {
    date: string;
    packVersion: string;
    inHouse?: InHouseScores;
    gate: { baseline: boolean; warnings: string[] };
  },
): string {
  const lines: string[] = [];
  const row = (cells: (string | number)[]) => lines.push(`| ${cells.join(" | ")} |`);
  const alias = run.modes.find((m) => m.kind === "alias") as HeldoutMode;
  const fused = run.modes.find((m) => m.kind === "fused");
  const primary = fused ?? alias;
  const byId = new Map(run.queries.map((q) => [q.id, q]));
  const labellers = [...new Set(run.queries.map((q) => q.labelled_by))];
  const personas = new Set(run.queries.map((q) => q.persona)).size;

  lines.push(
    "# Emojisense held-out eval",
    "",
    `- Date: ${context.date} · pack ${context.packVersion} · ${run.queries.length} queries in ` +
      `${run.locales.length} locales · ${personas} personas`,
    `- Queries and labels: ${labellers.map((l) => `\`${l}\``).join(", ")}. The aliases are written by ` +
      "Claude, so this set is not graded by the alias author. Disputed labels: " +
      "[queries/heldout-review.md](../queries/heldout-review.md) (not applied).",
    "- Engine per locale: en + that locale, core + ext (what a client loads). Hit = any label in the " +
      "top k. MRR over the top 10. Macro = mean of locales.",
    "",
    "## Per locale",
    "",
  );
  const modeHeads = (m: HeldoutMode) => [`${m.name} R@1`, "R@5", "MRR"];
  row(["Locale", "n", ...run.modes.flatMap(modeHeads), ...(fused ? ["Fused − alias R@5"] : [])]);
  row(["---", "--:", ...run.modes.flatMap(() => ["--:", "--:", "--:"]), ...(fused ? ["--:"] : [])]);
  const scoreRow = (label: string, pick: (m: HeldoutMode) => Summary) => {
    const s = pick(alias);
    row([
      label,
      s.n,
      ...run.modes.flatMap((m) => [pick(m).r1, pick(m).r5, pick(m).mrr]),
      ...(fused ? [delta(s.r5, pick(fused).r5)] : []),
    ]);
  };
  for (const locale of run.locales) {
    scoreRow(`${locale} ${localeInfo(locale).native}`, (m) => m.scores.byLocale[locale] as Summary);
  }
  scoreRow("**All (micro)**", (m) => m.scores.overall);
  scoreRow("**Mean of locales (macro)**", (m) => m.scores.macro);
  if (run.skipped.length) lines.push("", ...run.skipped.map((s) => `> Skipped ${s}`));

  if (context.inHouse) {
    const { inHouse } = context;
    const subset = (mode: HeldoutMode | undefined, locales: string[]) =>
      mode && summarize(mode.outcomes.filter((o) => locales.includes(byId.get(o.id)?.locale ?? "")));
    lines.push(
      "",
      "## Next to the in-house suite",
      "",
      `In-house numbers: ${inHouse.source}. The in-house set has only en and tr queries; the second ` +
        "row compares like with like.",
      "",
    );
    row(["Suite", "n", "Alias R@5", "Alias MRR", "Fused R@5", "Fused MRR"]);
    row(["---", "--:", "--:", "--:", "--:", "--:"]);
    const suiteRow = (label: string, a: Summary, f: Summary | undefined) =>
      row([label, a.n, a.r5, a.mrr, f?.r5 ?? "–", f?.mrr ?? "–"]);
    suiteRow("In-house (written by Claude)", inHouse.alias, inHouse.fused);
    suiteRow("Held-out, en + tr", subset(alias, ["en", "tr"]) as Summary, subset(fused, ["en", "tr"]));
    suiteRow("Held-out, all locales", alias.scores.overall, fused?.scores.overall);
  }

  lines.push("", "## Soft gate", "");
  if (!context.gate.baseline) {
    lines.push("No `reports/heldout-baseline.json` yet. Write one with `--write-baseline`.");
  } else if (context.gate.warnings.length === 0) {
    lines.push("No recall@5 drop beyond tolerance (2 points overall, 5 per locale) against the baseline.");
  } else {
    lines.push("Warnings only; the held-out gate does not fail the build.", "");
    for (const w of context.gate.warnings) lines.push(`- ${w}`);
  }

  lines.push(
    "",
    `## Worst misses per locale (${primary.name})`,
    "",
    "A miss has no label in the top 5. Worst first: not in the top 10, then lowest rank; ties go " +
      "to queries that the other mode also misses. – = not in the top 10.",
  );
  const other = run.modes.find((m) => m !== primary);
  for (const locale of run.locales) {
    const inLocale = (o: { id: string }) => byId.get(o.id)?.locale === locale;
    const misses = worstMisses(primary.outcomes.filter(inLocale), {
      compareWith: other?.outcomes.filter(inLocale),
    });
    const total = primary.outcomes.filter((o) => inLocale(o) && (o.rank === 0 || o.rank > 5)).length;
    const info = localeInfo(locale);
    lines.push(
      "",
      `### ${locale} — ${info.name} (${total} misses of ${primary.scores.byLocale[locale]?.n})`,
      "",
    );
    if (misses.length === 0) {
      lines.push("No misses.");
      continue;
    }
    row([
      "Query",
      "id",
      "Labels",
      `${primary.kind} rank`,
      ...(other ? [`${other.kind} rank`] : []),
      "Got (top 5)",
    ]);
    row(["---", "---", "---", "--:", ...(other ? ["--:"] : []), "---"]);
    for (const miss of misses) {
      const q = byId.get(miss.id) as HeldoutQuery;
      row([
        pipe(q.q),
        q.id,
        q.answers.join(""),
        rankCell(miss.rank),
        ...(other ? [rankCell(miss.otherRank)] : []),
        miss.top.join(" ") || "–",
      ]);
    }
  }
  return lines.join("\n");
}
