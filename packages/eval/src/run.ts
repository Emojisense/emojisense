/**
 * Benchmark runner: Tier 0 alone, Tier 1 alone (per model × dims), and fused (always / gated).
 *
 *   pnpm eval                       full run (embeds missing queries via Workers AI)
 *   pnpm eval -- --offline          cached embeddings only; skips engines without them
 *   pnpm eval -- --ci               also fail when recall@5 drops > 2 points vs reports/baseline.json
 *   pnpm eval -- --write-baseline   store this run as the new baseline
 *
 * Writes reports/latest.md and reports/latest.json.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { disposeEmbeddings, embedTexts, measureLatency } from "@emojisense/data/embeddings";
import { formatQuery, getModel, MODELS } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import {
  type AliasEngine,
  type AliasSearchOutput,
  createEngine,
  decodeVectors,
  fuse,
  l2normalize,
  type Pack,
  type SearchResult,
  searchVectors,
  shouldUseSemantic,
} from "emojisense";
import { costPerMillion } from "./cost.ts";
import { judge, percentile, type QueryOutcome, type Summary, summarize } from "./metrics.ts";
import { type EvalQuery, loadQueries } from "./queries.ts";

const EVAL_ROOT = new URL("..", import.meta.url).pathname;
const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    pack: { type: "string" },
    offline: { type: "boolean", default: false },
    ci: { type: "boolean", default: false },
    "write-baseline": { type: "boolean", default: false },
    models: { type: "string" },
    "alias-caps": { type: "string", default: "10,20,30" },
    "min-coverage": { type: "string", default: "0.5,0.6" },
  },
});

const packVersion = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8")).packVersion;
const packDir = args.pack ?? join(DATA_ROOT, "dist", "packs", packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`No pack in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}
const readPack = (locale: string): Pack =>
  JSON.parse(readFileSync(join(packDir, `pack.${locale}.json`), "utf8"));
const packs = [readPack("en"), readPack("tr")];
const queries = loadQueries(join(EVAL_ROOT, "queries", "queries.jsonl"));
const scored = queries.filter((q) => q.answers.length > 0);
const noise = queries.filter((q) => q.cat === "noise");
const LIMIT = 10;

interface EngineResult {
  name: string;
  kind: "alias" | "semantic" | "fused" | "fused-gated";
  model?: string;
  dims?: number;
  summary: Summary;
  byCategory: Record<string, Summary>;
  semanticRate?: number;
  outcomes: QueryOutcome[];
  note?: string;
}

function evaluate(
  name: string,
  kind: EngineResult["kind"],
  rank: (q: EvalQuery) => string[],
  extra: Partial<EngineResult> = {},
): EngineResult {
  const outcomes = scored.map((q) => judge(q, rank(q)));
  const byCategory: Record<string, Summary> = {};
  for (const cat of [...new Set(outcomes.map((o) => o.cat))]) {
    byCategory[cat] = summarize(outcomes.filter((o) => o.cat === cat));
  }
  return { name, kind, summary: summarize(outcomes), byCategory, outcomes, ...extra };
}

// ── Tier 0 ────────────────────────────────────────────────────────────────────────────────
function capPack(pack: Pack, maxAliases: number, dropLow: boolean): Pack {
  return {
    ...pack,
    emoji: pack.emoji.map((row) => {
      const copy = [...row] as typeof row;
      copy[8] = row[8].split("|").slice(0, maxAliases).join("|");
      if (dropLow) copy[10] = "";
      return copy;
    }),
  };
}

const gz = (value: unknown) => gzipSync(JSON.stringify(value), { level: 9 }).length;
const buildStarted = performance.now();
const engine = createEngine(packs);
const buildMs = performance.now() - buildStarted;

const aliasOutputs = new Map<string, AliasSearchOutput>();
const aliasSearch = (e: AliasEngine, q: EvalQuery) => e.search(q.q, { locale: q.locale, limit: 24 });
for (const q of queries) aliasOutputs.set(q.id, aliasSearch(engine, q));

const results: EngineResult[] = [];
const sizes: { variant: string; enGz: number; trGz: number }[] = [
  { variant: "full", enGz: gz(packs[0]), trGz: gz(packs[1]) },
];
results.push(
  evaluate("alias (full pack)", "alias", (q) =>
    (aliasOutputs.get(q.id) as AliasSearchOutput).results.slice(0, LIMIT).map((r) => r.emoji),
  ),
);
for (const cap of (args["alias-caps"] ?? "").split(",").filter(Boolean).map(Number)) {
  for (const dropLow of [false, true]) {
    const capped = packs.map((p) => capPack(p, cap, dropLow));
    const variant = `≤${cap} aliases${dropLow ? ", no low" : ""}`;
    sizes.push({ variant, enGz: gz(capped[0]), trGz: gz(capped[1]) });
    const cappedEngine = createEngine(capped);
    results.push(
      evaluate(`alias (${variant})`, "alias", (q) =>
        aliasSearch(cappedEngine, q)
          .results.slice(0, LIMIT)
          .map((r) => r.emoji),
      ),
    );
  }
}

for (const minCoverage of (args["min-coverage"] ?? "").split(",").filter(Boolean).map(Number)) {
  const tuned = createEngine(packs, { minCoverage });
  results.push(
    evaluate(`alias (min coverage ${minCoverage})`, "alias", (q) =>
      aliasSearch(tuned, q)
        .results.slice(0, LIMIT)
        .map((r) => r.emoji),
    ),
  );
}

// Keystroke latency: every prefix of every query, as if typed.
const keystrokeMs: number[] = [];
for (let round = 0; round < 3; round++) {
  for (const q of queries) {
    for (let i = 1; i <= q.q.length; i++) {
      const started = performance.now();
      engine.search(q.q.slice(0, i), { locale: q.locale });
      keystrokeMs.push(performance.now() - started);
    }
  }
}
const noiseConfident = noise.filter((q) => (aliasOutputs.get(q.id)?.confidence ?? 0) >= 0.6).length;

// ── Tier 1 + fusion ───────────────────────────────────────────────────────────────────────
const vectorFiles = readdirSync(packDir)
  .map((f) => /^vectors\.([\w-]+)\.(\d+)\.bin$/.exec(f))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => ({ file: m[0], model: getModel(m[1] as string), dims: Number(m[2]) }))
  .filter((v) => !args.models || args.models.split(",").includes(v.model.key))
  .sort((a, b) => MODELS.indexOf(a.model) - MODELS.indexOf(b.model) || b.dims - a.dims);

const latency: { model: string; p50: number; p95: number; n: number }[] = [];
const queryTokens: Record<string, number> = {};
const skipped: string[] = [];

try {
  const queryVectors = new Map<string, Float32Array[]>();
  for (const model of [...new Set(vectorFiles.map((v) => v.model))]) {
    const texts = scored.map((q) => formatQuery(model, q.q));
    queryTokens[model.id] = texts.reduce((s, t) => s + t.length / 4, 0) / texts.length;
    try {
      const { vectors } = await embedTexts(model, texts, "query", { offline: args.offline });
      queryVectors.set(model.key, vectors);
      if (!args.offline) {
        const sample = scored.slice(0, 15).map((q) => `${formatQuery(model, q.q)} `);
        const ms = await measureLatency(model, sample);
        latency.push({ model: model.key, p50: percentile(ms, 50), p95: percentile(ms, 95), n: ms.length });
      }
    } catch (error) {
      skipped.push(`${model.key}: ${(error as Error).message}`);
    }
  }

  for (const { file, model, dims } of vectorFiles) {
    const vectors = queryVectors.get(model.key);
    if (!vectors) continue;
    const index = decodeVectors(readFileSync(join(packDir, file)));
    const semantic = new Map<string, SearchResult[]>();
    scored.forEach((q, i) => {
      const query = l2normalize((vectors[i] as Float32Array).slice(0, dims));
      semantic.set(
        q.id,
        searchVectors(index, query, 24).map((m) => ({
          emoji: engine.get(m.id)?.emoji ?? "",
          id: m.id,
          score: m.score,
          source: "semantic" as const,
        })),
      );
    });
    const tag = `${model.key}@${dims}`;
    const note = !model.mrl && dims < model.nativeDims ? "truncated, model not MRL-trained" : undefined;
    const base = { model: model.id, dims, ...(note ? { note } : {}) };
    results.push(
      evaluate(
        `semantic ${tag}`,
        "semantic",
        (q) => (semantic.get(q.id) as SearchResult[]).slice(0, LIMIT).map((r) => r.emoji),
        base,
      ),
    );
    results.push(
      evaluate(
        `fused ${tag}`,
        "fused",
        (q) =>
          fuse(aliasOutputs.get(q.id) as AliasSearchOutput, semantic.get(q.id) as SearchResult[], LIMIT).map(
            (r) => r.emoji,
          ),
        base,
      ),
    );
    let gated = 0;
    results.push(
      evaluate(
        `fused-gated ${tag}`,
        "fused-gated",
        (q) => {
          const alias = aliasOutputs.get(q.id) as AliasSearchOutput;
          if (!shouldUseSemantic(alias)) return alias.results.slice(0, LIMIT).map((r) => r.emoji);
          gated++;
          return fuse(alias, semantic.get(q.id) as SearchResult[], LIMIT).map((r) => r.emoji);
        },
        base,
      ),
    );
    (results.at(-1) as EngineResult).semanticRate = gated / scored.length;
  }
} finally {
  await disposeEmbeddings();
}

// ── Report ────────────────────────────────────────────────────────────────────────────────
const manifestPath = join(packDir, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { files: {} };
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const fmt = (n: number) => (Number.isNaN(n) ? "–" : n.toFixed(n < 10 ? 2 : 0));
const categories = [...new Set(scored.map((q) => q.cat))];
const best = [...results].sort(
  (a, b) => b.summary.r5 - a.summary.r5 || b.summary.mrr - a.summary.mrr,
)[0] as EngineResult;
const aliasFull = results[0] as EngineResult;

const costRows = results
  .filter((r) => r.kind === "fused-gated")
  .map((r) => {
    const tokens = queryTokens[r.model as string] ?? 8;
    const at = (hit: number, rate = r.semanticRate ?? 1) =>
      costPerMillion({
        semanticRate: rate,
        requestsPerSemanticSearch: 1.5,
        cacheHitRate: hit,
        tokensPerQuery: tokens,
        modelId: r.model as string,
        cpuMsPerRequest: 2,
      });
    return { r, gated: at(0.7), worst: at(0.7, 1), cold: at(0.3) };
  });

const lines: string[] = [];
const row = (cells: (string | number)[]) => lines.push(`| ${cells.join(" | ")} |`);
lines.push(
  `# Emojisense eval report`,
  "",
  `- Date: ${new Date().toISOString().slice(0, 10)} · pack ${packVersion} · ${scored.length} scored queries ` +
    `(+${noise.length} noise) · ${queries.filter((q) => q.review).length} labels marked for human review`,
  `- Hit = any acceptable emoji in the top k. MRR over the top 10. forbid@3 = a forbidden emoji in the top 3 (hard negatives).`,
  "",
  "## Engines",
  "",
);
row(["Engine", "R@1", "R@5", "R@10", "MRR", "forbid@3", "Tier 1 calls", "Note"]);
row(["---", "--:", "--:", "--:", "--:", "--:", "--:", "---"]);
for (const r of results) {
  const s = r.summary;
  row([
    r === best ? `**${r.name}**` : r.name,
    s.r1,
    s.r5,
    s.r10,
    s.mrr,
    s.forbidRate,
    r.kind === "alias"
      ? "0%"
      : r.kind === "fused-gated"
        ? `${Math.round((r.semanticRate ?? 0) * 100)}%`
        : "100%",
    r.note ?? "",
  ]);
}
if (skipped.length) lines.push("", ...skipped.map((s) => `> Skipped ${s}`));

lines.push("", "## Recall@5 by category", "");
const shown = results.filter((r) => r.kind !== "fused" && !r.name.includes("≤"));
row(["Engine", ...categories.map((c) => `${c} (${aliasFull.byCategory[c]?.n ?? 0})`)]);
row(["---", ...categories.map(() => "--:")]);
for (const r of shown) row([r.name, ...categories.map((c) => r.byCategory[c]?.r5 ?? "–")]);

lines.push("", "## Latency", "");
row(["Measure", "p50", "p95", "max", "n"]);
row(["---", "--:", "--:", "--:", "--:"]);
row([
  "Tier 0 per keystroke (Node, this machine)",
  `${fmt(percentile(keystrokeMs, 50))} ms`,
  `${fmt(percentile(keystrokeMs, 95))} ms`,
  `${fmt(Math.max(...keystrokeMs))} ms`,
  keystrokeMs.length,
]);
row(["Tier 0 index build (en + tr)", `${fmt(buildMs)} ms`, "", "", 1]);
for (const l of latency) {
  row([
    `Workers AI round trip from this machine: ${l.model}`,
    `${fmt(l.p50)} ms`,
    `${fmt(l.p95)} ms`,
    "",
    l.n,
  ]);
}
lines.push(
  "",
  `Noise queries with a confident (≥ 0.6) alias result: ${noiseConfident}/${noise.length}.`,
  "",
  "## Sizes",
  "",
);
row(["Client pack", "en gz", "tr gz"]);
row(["---", "--:", "--:"]);
for (const s of sizes) row([s.variant, kb(s.enGz), kb(s.trGz)]);
lines.push("");
row(["Server file", "raw", "gz"]);
row(["---", "--:", "--:"]);
for (const [name, f] of Object.entries(
  manifest.files as Record<string, { bytes: number; gzipBytes: number }>,
)) {
  if (name.startsWith("vectors.")) row([name, kb(f.bytes), kb(f.gzipBytes)]);
}

if (costRows.length) {
  lines.push(
    "",
    "## Estimated cost per 1M searches (Workers Paid, beyond included quota)",
    "",
    "Assumptions: 1.5 debounced requests per semantic search, 2 ms CPU per request, query tokens ≈ chars / 4.",
    "",
  );
  row(["Engine", "Tier 1 calls", "Cache hit 70%", "Cache hit 30%", "Every search hits Tier 1, 70% hit"]);
  row(["---", "--:", "--:", "--:", "--:"]);
  for (const { r, gated, worst, cold } of costRows) {
    const flag = gated.priceAssumed ? " ⚠" : "";
    row([
      r.name,
      `${Math.round((r.semanticRate ?? 0) * 100)}%`,
      `$${gated.totalUsd.toFixed(3)}${flag}`,
      `$${cold.totalUsd.toFixed(3)}${flag}`,
      `$${worst.totalUsd.toFixed(3)}${flag}`,
    ]);
  }
  lines.push("", "⚠ = model price is not published; $0.02 / 1M tokens (bge-small rate) assumed.");
}

lines.push("", `## Misses of the best engine (${best.name})`, "");
row(["Query", "Category", "Expected", "Got (top 5)"]);
row(["---", "---", "---", "---"]);
for (const o of best.outcomes.filter((x) => x.rank === 0 || x.rank > 5)) {
  const q = scored.find((x) => x.id === o.id) as EvalQuery;
  row([`${q.q}${q.review ? " ⓡ" : ""}`, q.cat, q.answers.slice(0, 4).join(""), o.top.join(" ") || "–"]);
}
lines.push("", "ⓡ = label marked for human review in queries.jsonl.");

const report = lines.join("\n");
writeFileSync(join(EVAL_ROOT, "reports", "latest.md"), `${report}\n`);
const json = {
  date: new Date().toISOString(),
  packVersion,
  queries: { scored: scored.length, noise: noise.length },
  engines: results.map(({ outcomes, ...rest }) => ({ ...rest, outcomes })),
  latency: {
    keystroke: { p50: percentile(keystrokeMs, 50), p95: percentile(keystrokeMs, 95) },
    buildMs,
    workersAi: latency,
  },
  sizes,
  skipped,
};
writeFileSync(join(EVAL_ROOT, "reports", "latest.json"), `${JSON.stringify(json, null, 1)}\n`);
console.log(report.split("## Recall@5")[0]);

// ── CI gate ───────────────────────────────────────────────────────────────────────────────
const baselinePath = join(EVAL_ROOT, "reports", "baseline.json");
if (args["write-baseline"]) {
  const baseline = Object.fromEntries(results.map((r) => [r.name, { r5: r.summary.r5, mrr: r.summary.mrr }]));
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`baseline written: ${baselinePath}`);
}
if (args.ci) {
  if (!existsSync(baselinePath)) {
    console.error("--ci: no reports/baseline.json; run with --write-baseline first");
    process.exit(1);
  }
  const baseline: Record<string, { r5: number }> = JSON.parse(readFileSync(baselinePath, "utf8"));
  const regressions = results.filter(
    (r) => baseline[r.name] && r.summary.r5 < (baseline[r.name]?.r5 ?? 0) - 2,
  );
  for (const r of regressions) {
    console.error(`✘ ${r.name}: recall@5 ${r.summary.r5} < baseline ${baseline[r.name]?.r5} − 2`);
  }
  if (regressions.length) process.exit(1);
  console.log("✔ no recall@5 regression > 2 points");
}
