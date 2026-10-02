/**
 * Benchmark runner: Tier 0 alone, Tier 1 alone (per model × dims), and fused (always / gated).
 *
 *   pnpm eval                       full run (embeds missing queries via Workers AI)
 *   pnpm eval -- --offline          cached embeddings only; skips engines without them
 *   pnpm eval -- --ci               also fail when recall@5 drops > 2 points vs reports/baseline.json
 *   pnpm eval -- --write-baseline   store this run as the new baseline (both suites)
 *
 * Two suites: the in-house set (queries/queries.jsonl → reports/latest.md, latest.json) and the
 * held-out set (queries/heldout.jsonl → reports/heldout.md, heldout.json; alias and fused with
 * the production model, per locale). Only the in-house suite can fail the run; the held-out
 * gate warns. `pnpm eval:heldout` runs the held-out suite alone.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { disposeEmbeddings, embedTexts, measureLatency } from "@emojisense/data/embeddings";
import { formatQuery, getModel, MODELS } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import { parseVectorFileName, vectorFileName } from "@emojisense/data/vector-files";
import {
  type AliasEngine,
  type AliasSearchOutput,
  createEngine,
  DEFAULT_SEMANTIC_CALIBRATION,
  fuse,
  l2normalize,
  type Pack,
  ROW_INDEX,
  type SearchResult,
  type SemanticCalibration,
  shouldUseSemantic,
} from "emojisense";
import { computeLayeredCost, type MeasuredRate, withValue } from "./cost.ts";
import { ASSUMPTIONS_PATH, loadCostInputs } from "./cost-inputs.ts";
import { renderCostReport, usd } from "./cost-report.ts";
import { runAndReportHeldout } from "./heldout-run.ts";
import {
  calibrateSemantic,
  judge,
  percentile,
  type QueryOutcome,
  type Summary,
  summarize,
} from "./metrics.ts";
import { type EvalQuery, loadQueries } from "./queries.ts";
import { loadVectorLayout, type VectorLayout } from "./vector-layout.ts";

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
    "alias-caps": { type: "string", default: "8,16,24" },
    "min-coverage": { type: "string", default: "0.5,0.6" },
  },
});

const packConfig: { packVersion: string; model: { key: string; dims: number } } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);
const { packVersion } = packConfig;
const packDir = args.pack ?? join(DATA_ROOT, "dist", "packs", packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`No pack in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}
const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const corePacks = [readPack("en"), readPack("tr")];
const extPacks = [readPack("en.ext"), readPack("tr.ext")];
/** What a client has after the idle-time load: core + ext. All fused engines use this. */
const packs = [corePacks[0], extPacks[0], corePacks[1], extPacks[1]] as Pack[];
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
/** Simulate a core pack that keeps `maxAliases` aliases (from the merged core + ext order). */
function simulateCore(core: Pack, ext: Pack, maxAliases: number): Pack {
  return {
    ...core,
    emoji: core.emoji.map((row, i) => {
      const extRow = ext.emoji[i] as typeof row;
      const merged = [row[ROW_INDEX.alias], extRow[ROW_INDEX.alias]].filter(Boolean).join("|");
      const copy = [...row] as typeof row;
      copy[ROW_INDEX.alias] = merged.split("|").slice(0, maxAliases).join("|");
      return copy;
    }),
  };
}

const gz = (value: unknown) => gzipSync(JSON.stringify(value), { level: 9 }).length;
const buildStarted = performance.now();
const engine = createEngine(packs);
const buildMs = performance.now() - buildStarted;
const coreEngine = createEngine(corePacks);

const aliasOutputs = new Map<string, AliasSearchOutput>();
const aliasSearch = (e: AliasEngine, q: EvalQuery) => e.search(q.q, { locale: q.locale, limit: 24 });
for (const q of queries) aliasOutputs.set(q.id, aliasSearch(engine, q));

const results: EngineResult[] = [];
const sizes: { variant: string; enGz: number; trGz: number }[] = [
  { variant: "core (shipped)", enGz: gz(corePacks[0]), trGz: gz(corePacks[1]) },
  { variant: "ext (loaded when idle)", enGz: gz(extPacks[0]), trGz: gz(extPacks[1]) },
];
results.push(
  evaluate("alias (core + ext)", "alias", (q) =>
    (aliasOutputs.get(q.id) as AliasSearchOutput).results.slice(0, LIMIT).map((r) => r.emoji),
  ),
  evaluate("alias (core only, first load)", "alias", (q) =>
    aliasSearch(coreEngine, q)
      .results.slice(0, LIMIT)
      .map((r) => r.emoji),
  ),
);
for (const cap of (args["alias-caps"] ?? "").split(",").filter(Boolean).map(Number)) {
  const simulated = [0, 1].map((i) => simulateCore(corePacks[i] as Pack, extPacks[i] as Pack, cap));
  const variant = `core with ≤${cap} aliases`;
  sizes.push({ variant, enGz: gz(simulated[0]), trGz: gz(simulated[1]) });
  const simulatedEngine = createEngine(simulated);
  results.push(
    evaluate(`alias (${variant})`, "alias", (q) =>
      aliasSearch(simulatedEngine, q)
        .results.slice(0, LIMIT)
        .map((r) => r.emoji),
    ),
  );
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
// The client's gate needs only the alias output, so the semantic-call rate is measured even
// without vectors. `pnpm cost` reads it from latest.json.
const gateRate =
  scored.filter((q) => shouldUseSemantic(aliasOutputs.get(q.id) as AliasSearchOutput)).length / scored.length;

// ── Tier 1 + fusion ───────────────────────────────────────────────────────────────────────
// One engine per shared file; its locale files join it in loadVectorLayout.
const vectorFiles = readdirSync(packDir)
  .map(parseVectorFileName)
  .filter((f) => f !== undefined && f.locale === undefined)
  .map((f) => ({ model: getModel(f?.modelKey as string), dims: f?.dims as number }))
  .filter((v) => !args.models || args.models.split(",").includes(v.model.key))
  .sort((a, b) => MODELS.indexOf(a.model) - MODELS.indexOf(b.model) || b.dims - a.dims);

const latency: { model: string; p50: number; p95: number; n: number }[] = [];
const queryTokens: Record<string, number> = {};
const skipped: string[] = [];
const calibrations: {
  tag: string;
  measured: SemanticCalibration;
  used: SemanticCalibration;
  shipped: boolean;
}[] = [];

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

  for (const { model, dims } of vectorFiles) {
    const vectors = queryVectors.get(model.key);
    if (!vectors) continue;
    // The shared file plus the locale files next to it (PACK_FORMAT §5): tr queries search both.
    const layout = loadVectorLayout(packDir, model, dims) as VectorLayout;
    const semantic = new Map<string, SearchResult[]>();
    scored.forEach((q, i) => {
      const query = l2normalize((vectors[i] as Float32Array).slice(0, dims));
      semantic.set(
        q.id,
        layout.search(q.locale, query, 24).map((m) => ({
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
    // Cosine scales differ per model and dims. The shipped model fuses with the client's
    // default; every other vector file with its own measurement, so the rows compare fairly.
    const measured = calibrateSemantic(
      scored.map((q) => {
        const list = semantic.get(q.id) as SearchResult[];
        const { rank } = judge(
          q,
          list.slice(0, LIMIT).map((r) => r.emoji),
        );
        return { best: list[0]?.score ?? 0, hit: rank > 0 && rank <= 5 };
      }),
    );
    const shipped = model.key === packConfig.model.key && dims === packConfig.model.dims;
    const calibration = shipped ? DEFAULT_SEMANTIC_CALIBRATION : measured;
    calibrations.push({ tag, measured, used: calibration, shipped });
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
          fuse(
            aliasOutputs.get(q.id) as AliasSearchOutput,
            semantic.get(q.id) as SearchResult[],
            LIMIT,
            calibration,
          ).map((r) => r.emoji),
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
          return fuse(alias, semantic.get(q.id) as SearchResult[], LIMIT, calibration).map((r) => r.emoji);
        },
        base,
      ),
    );
    (results.at(-1) as EngineResult).semanticRate = gated / scored.length;
  }
} finally {
  await disposeEmbeddings();
}

// ── Held-out suite (labels by another model; the gate only warns) ─────────────────────────
const production = packConfig.model;
const heldout = await runAndReportHeldout({
  packDir,
  packVersion,
  model: production,
  offline: args.offline,
  writeBaseline: args["write-baseline"],
  inHouse: {
    source: "this run",
    alias: (results[0] as EngineResult).summary,
    fused: results.find((r) => r.name === `fused ${production.key}@${production.dims}`)?.summary,
  },
});

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

const measuredGate: MeasuredRate = {
  semanticRate: gateRate,
  source: `eval gate, ${scored.length} queries, this run`,
};
const costInputs = loadCostInputs(ASSUMPTIONS_PATH, measuredGate);
/** Same layer assumptions; this engine's model, measured query length and semantic-call rate. */
const costRows = results
  .filter((r) => r.kind === "fused-gated")
  .map((r) => {
    const a = structuredClone(costInputs);
    a.model = {
      ...a.model,
      id: r.model as string,
      pricePerMTokens: null,
      tokensPerQuery: queryTokens[r.model as string] ?? a.model.tokensPerQuery,
    };
    return { r, cost: computeLayeredCost(withValue(a, "deviceShare", 1 - (r.semanticRate ?? 1))) };
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

if (calibrations.length) {
  lines.push(
    "",
    "### Semantic calibration",
    "",
    "Fusion weights the semantic list by its best cosine, from 0 at `floor` to 1 at `ceiling`. " +
      "Measured here: floor = 25th percentile of the semantic misses' best cosine, ceiling = median " +
      "of the hits'. The shipped model uses the client default (`DEFAULT_SEMANTIC_CALIBRATION`).",
    "",
  );
  row(["Vectors", "Measured floor–ceiling", "Used"]);
  row(["---", "--:", "--:"]);
  const range = (c: SemanticCalibration) => `${c.floor.toFixed(2)}–${c.ceiling.toFixed(2)}`;
  for (const c of calibrations) {
    row([c.tag, range(c.measured), c.shipped ? `${range(c.used)} (client default)` : range(c.used)]);
  }
}

lines.push(
  "",
  "## Held-out suite",
  "",
  `${heldout.queries.length} queries in ${heldout.locales.length} locales, written and labelled by another ` +
    "model (not the alias author). Per locale and worst misses: [heldout.md](heldout.md).",
  "",
);
row(["Mode", "R@1", "R@5", "MRR", "Macro R@5"]);
row(["---", "--:", "--:", "--:", "--:"]);
for (const m of heldout.modes) {
  const s = m.scores.overall;
  row([m.name, s.r1, s.r5, s.mrr, m.scores.macro.r5]);
}
if (heldout.skipped.length) lines.push("", ...heldout.skipped.map((s) => `> Skipped ${s}`));

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
// Locale files are summed per model and dims: one row instead of ten.
const vectorSizes = new Map<string, { bytes: number; gzipBytes: number; files: number }>();
for (const [name, f] of Object.entries(
  manifest.files as Record<string, { bytes: number; gzipBytes: number }>,
)) {
  const file = parseVectorFileName(name);
  if (!file) continue;
  const label = file.locale
    ? vectorFileName(file.modelKey, file.dims, "<locale>")
    : vectorFileName(file.modelKey, file.dims);
  const sum = vectorSizes.get(label) ?? { bytes: 0, gzipBytes: 0, files: 0 };
  vectorSizes.set(label, {
    bytes: sum.bytes + f.bytes,
    gzipBytes: sum.gzipBytes + f.gzipBytes,
    files: sum.files + 1,
  });
}
for (const [label, s] of vectorSizes) {
  row([s.files > 1 ? `${label} × ${s.files}` : label, kb(s.bytes), kb(s.gzipBytes)]);
}

lines.push(
  "",
  ...renderCostReport(costInputs, { level: 2, measured: measuredGate }),
  "",
  "Inputs: `cost.assumptions.json`. Recompute with `pnpm --filter @emojisense/eval cost`.",
);
if (costRows.length) {
  lines.push(
    "",
    "### Per engine",
    "",
    "Same layer assumptions; query tokens ≈ chars / 4 of the formatted query.",
    "",
  );
  row(["Engine", "Tier 1 calls", "$ / 1M tokens", "Search $ / 1M searches", "All layers $ / 1M searches"]);
  row(["---", "--:", "--:", "--:", "--:"]);
  for (const { r, cost } of costRows) {
    const flag = cost.price.source === "assumed" ? " ⚠" : "";
    row([
      r.name,
      `${Math.round((r.semanticRate ?? 0) * 100)}%`,
      `${usd(cost.price.pricePerMTokens)}${flag}`,
      usd(cost.searchPerMillion),
      usd(cost.marginalPerMillion),
    ]);
  }
  lines.push("", "⚠ = model price is not published; `model.assumedPricePerMTokens` is used.");
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
  gate: { semanticRate: gateRate, n: scored.length },
  engines: results.map(({ outcomes, ...rest }) => ({ ...rest, outcomes })),
  latency: {
    keystroke: { p50: percentile(keystrokeMs, 50), p95: percentile(keystrokeMs, 95) },
    buildMs,
    workersAi: latency,
  },
  sizes,
  skipped,
  calibrations,
  heldout: {
    queries: heldout.queries.length,
    modes: heldout.modes.map((m) => ({ name: m.name, overall: m.scores.overall, macro: m.scores.macro })),
    skipped: heldout.skipped,
  },
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
