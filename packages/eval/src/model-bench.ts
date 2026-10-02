/**
 * Embedding models as a drop-in for the semantic tier: each variant (model-variants.ts) embeds the
 * queries its own way and searches its own document vectors (shared + per-locale files) and glyph
 * rows, scored like production (popularity prior + glyph term). Fusion with the alias tier uses
 * the learned reranker: the production weights for the production model, weights fitted for each
 * other variant (`rerank-fit.ts`; 5-fold cross-validated on the training sets, the full fit on
 * entities-dev, the examples and held-out, which it never saw). Semantic calibration per variant
 * as in `run.ts` (measured on the in-house suite; the production model keeps the client default).
 *
 *   pnpm --filter @emojisense/eval eval:models -- --variants bge-m3@1024,qwen3-task@512
 *       [--offline]          cached query vectors only
 *       [--concepts]         also the API's concept tier (LLM) on entities-dev and the examples
 *       [--latency 40]       time 40 single-query embedding calls per variant (Workers AI round trip)
 *       [--doc-tokens 200]   count the tokens of 200 documents per document model (one-time cost)
 *       [--heldout a,b]      held-out aggregates for these variants (never a query or a row)
 *
 * Before: the document and glyph vector files of each model and dims, e.g.
 *   pnpm --filter @emojisense/data embed -- --models qwen3 --dims 1024,512,256
 *   pnpm --filter @emojisense/data embed:glyph -- --model qwen3 --dims 512
 * Writes reports/models.md and reports/models.json.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { disposeEmbeddings, embedTexts, runWorkersAI } from "@emojisense/data/embeddings";
import { type EmbeddingModel, formatDocument, formatQuery } from "@emojisense/data/models";
import { BUILD_DIR, DATA_ROOT } from "@emojisense/data/paths";
import { semanticBonus } from "@emojisense/data/semantic-score";
import { glyphVectorFileName, vectorFileName } from "@emojisense/data/vector-files";
import {
  type AliasEngine,
  type AliasSearchOutput,
  assessConfidence,
  DEFAULT_SEMANTIC_CALIBRATION,
  embeddingText,
  fuse,
  mergeConcept,
  type Pack,
  RERANK_WEIGHTS,
  type RerankInput,
  type SearchResult,
  type SemanticCalibration,
  semanticConfidence,
} from "emojisense";
import { l2normalize, searchVectorSets, type VectorIndex } from "emojisense/vectors";
import { CONCEPT_MODEL } from "../../worker/src/concepts/config.ts";
import { type ConceptTierStats, runConceptTier, USD_PER_1K_NEURONS } from "./concept-tier.ts";
import { EVAL_ROOT } from "./cost-inputs.ts";
import { loadHeldout } from "./heldout.ts";
import { HELDOUT_PATH } from "./heldout-run.ts";
import { calibrateSemantic, judge, percentile, type Summary, summarize } from "./metrics.ts";
import { type ModelVariant, parseVariant } from "./model-variants.ts";
import { type EvalQuery, loadQueries } from "./queries.ts";
import { rankingEngine } from "./ranking.ts";
import { createRerankFit, rerankCandidates, roundWeights } from "./rerank-fit.ts";
import { loadVectorLayout, type VectorLayout } from "./vector-layout.ts";

const DEFAULT_VARIANTS = [
  "bge-m3@1024",
  "embeddinggemma@768",
  "embeddinggemma@512",
  "embeddinggemma@256",
  "qwen3@1024",
  "qwen3-default@1024",
  "qwen3-task@1024",
  "qwen3-task@512",
  "qwen3-task@256",
];
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    variants: { type: "string", default: DEFAULT_VARIANTS.join(",") },
    pack: { type: "string" },
    offline: { type: "boolean", default: false },
    concepts: { type: "boolean", default: false },
    latency: { type: "string", default: "0" },
    "doc-tokens": { type: "string", default: "0" },
    heldout: { type: "string", default: "" },
    concurrency: { type: "string", default: "4" },
  },
});

const LIMIT = 10;
const FOLDS = 5;
/** Sets in the report, in order. */
const SETS = ["in-house", "entities-dev", "semantic-dev", "sentences-dev", "romanized-dev"] as const;
const FILES: Record<string, string> = {
  "in-house": "queries.jsonl",
  "entities-dev": "entities-dev.jsonl",
  "semantic-dev": "semantic-dev.jsonl",
  "sentences-dev": "sentences-dev.jsonl",
  "romanized-dev": "romanized-dev.jsonl",
  "ranking-dev": "ranking-dev.jsonl",
};
/** The reranker's training sets (as rerank:train); entities-dev and held-out stay unseen. */
const TRAINING = new Set(["in-house", "semantic-dev", "romanized-dev", "sentences-dev", "ranking-dev"]);
/** Entity queries from the owner's brief, ranked as English. */
const EXAMPLES = [
  "kendrick lamar",
  "slim shady",
  "taylor swift",
  "elon musk",
  "messi",
  "bad bunny",
  "squid game",
  "minecraft",
  "barbie",
  "the godfather",
];
/** USD per million input tokens on Workers AI (developers.cloudflare.com/workers-ai/platform/pricing, 2026-10-02). */
const USD_PER_M_TOKENS: Record<string, number | undefined> = {
  "@cf/baai/bge-m3": 0.012,
  "@cf/qwen/qwen3-embedding-0.6b": 0.012,
  "@cf/google/embeddinggemma-300m": undefined,
};

const packConfig: { packVersion: string; model: { key: string; dims: number } } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);
const packDir = args.pack ?? join(DATA_ROOT, "dist", "packs", packConfig.packVersion);
const variants = args.variants.split(",").map((spec) => parseVariant(spec, packConfig.model));
const heldoutVariants = new Set(
  args.heldout
    .split(",")
    .filter(Boolean)
    .map((spec) => parseVariant(spec, packConfig.model).name),
);

// ── Queries and the alias tier (the same for every variant) ─────────────────────────────────
interface Item {
  set: string;
  q: EvalQuery;
  alias: AliasSearchOutput;
}
const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const en = [readPack("en"), readPack("en.ext")];
const engines = new Map<string, AliasEngine>();
const engineFor = (locale: string): AliasEngine => {
  let engine = engines.get(locale);
  if (!engine) {
    engine = rankingEngine(locale === "en" ? en : [...en, readPack(locale), readPack(`${locale}.ext`)]);
    engines.set(locale, engine);
  }
  return engine;
};
const toItem = (set: string, q: EvalQuery): Item => ({
  set,
  q,
  alias: engineFor(q.locale).search(q.q, { locale: q.locale, limit: 24 }),
});
const items: Item[] = Object.entries(FILES).flatMap(([set, file]) =>
  loadQueries(join(EVAL_ROOT, "queries", file))
    .filter((q) => q.answers.length > 0)
    .map((q) => toItem(set, q)),
);
const examples: Item[] = EXAMPLES.map((q, i) =>
  toItem("examples", { id: `example-${i}`, q, locale: "en", cat: "example", answers: [] }),
);
const heldout: Item[] = heldoutVariants.size
  ? loadHeldout(HELDOUT_PATH).map((q) => toItem("held-out", q))
  : [];

// ── One variant ──────────────────────────────────────────────────────────────────────────────
/** `refit`: the reranker fitted to this variant (5-fold CV on the training sets); `fused` for every variant but production. */
type Mode = "cos" | "sem" | "rrf" | "fused" | "refit";
interface Ranked {
  cos: SearchResult[];
  sem: SearchResult[];
  lists: Record<Mode, string[]>;
  fusedResults: SearchResult[];
  unsure: boolean;
}

function semanticLists(engine: AliasEngine, layout: VectorLayout, locale: string, vector: Float32Array) {
  const indexes = layout.indexesFor(locale);
  const toResults = (matches: { id: string; score: number }[]): SearchResult[] =>
    matches.map((m) => ({
      emoji: engine.get(m.id)?.emoji ?? "",
      id: m.id,
      score: m.score,
      source: "semantic" as const,
    }));
  const bonus = semanticBonus(engine.popularity, layout.glyph, vector);
  return {
    cos: toResults(searchVectorSets(indexes, vector, 24)),
    sem: toResults(searchVectorSets(indexes, vector, 24, { bonus })),
  };
}

const emojiOf = (results: readonly SearchResult[]) => results.slice(0, LIMIT).map((r) => r.emoji);

interface VariantRun {
  variant: ModelVariant;
  layout: VectorLayout;
  calibration: SemanticCalibration;
  weights: number[];
  ranked: Map<Item, Ranked>;
  /** Fused + the concept tier's results, for entities-dev and the examples (--concepts). */
  concept?: Map<Item, { lists: string[]; status?: string }>;
  memory: { sharedMB: number; glyphMB: number; localeMB: number; bundleMB: number; localeFileMB: number };
}

async function embedQueries(variant: ModelVariant, queries: readonly Item[]): Promise<Float32Array[]> {
  const model = variant.query;
  const { vectors } = await embedTexts(
    model,
    queries.map((it) => formatQuery(model, embeddingText(it.q.q))),
    "query",
    { offline: args.offline, concurrency: Number(args.concurrency) },
  );
  return vectors.map((v) => l2normalize(v.slice(0, variant.dims)));
}

const mb = (bytes: number) => Math.round((bytes / 1e6) * 10) / 10;
const indexBytes = (index: VectorIndex | undefined) =>
  index ? index.data.byteLength + index.signs.byteLength + index.ids.length * 8 : 0;
const fileBytes = (name: string) => {
  try {
    return statSync(join(packDir, name)).size;
  } catch {
    return 0;
  }
};

async function runVariant(variant: ModelVariant): Promise<VariantRun | string> {
  const layout = loadVectorLayout(packDir, variant.documents, variant.dims);
  if (!layout) return `no ${vectorFileName(variant.documents.key, variant.dims)} in ${packDir}`;
  const pool = [...items, ...examples, ...(heldoutVariants.has(variant.name) ? heldout : [])];
  const vectors = await embedQueries(variant, pool);
  const lists = new Map<Item, { cos: SearchResult[]; sem: SearchResult[] }>();
  pool.forEach((it, i) => {
    lists.set(it, semanticLists(engineFor(it.q.locale), layout, it.q.locale, vectors[i] as Float32Array));
  });

  // Cosine scales differ per model and dims (run.ts): calibrate on the in-house suite.
  const calibration = variant.shipped
    ? DEFAULT_SEMANTIC_CALIBRATION
    : calibrateSemantic(
        items
          .filter((it) => it.set === "in-house")
          .map((it) => {
            const sem = lists.get(it)?.sem ?? [];
            const { rank } = judge(it.q, emojiOf(sem));
            return { best: sem[0]?.score ?? 0, hit: rank > 0 && rank <= 5 };
          }),
      );
  const inputOf = (it: Item): RerankInput => {
    const sem = lists.get(it)?.sem ?? [];
    return {
      alias: it.alias,
      semantic: sem,
      semanticConfidence: semanticConfidence(sem, calibration),
      popularity: engineFor(it.q.locale).popularity,
    };
  };

  // Learned fusion: the production weights for the production model, else fitted for this one.
  const training = items.filter((it) => TRAINING.has(it.set));
  const candidates = training.map((it) => rerankCandidates(inputOf(it), it.q.answers));
  const train = createRerankFit(candidates);
  const refitWeights = roundWeights(train(candidates));
  const weights = variant.shipped ? [...RERANK_WEIGHTS] : refitWeights;
  const foldWeights = new Map<Item, number[]>();
  for (let fold = 0; fold < FOLDS; fold++) {
    const fitted = roundWeights(train(candidates.filter((_, i) => i % FOLDS !== fold)));
    training.forEach((it, i) => {
      if (i % FOLDS === fold) foldWeights.set(it, fitted);
    });
  }

  const ranked = new Map<Item, Ranked>();
  for (const it of pool) {
    const { cos, sem } = lists.get(it) as { cos: SearchResult[]; sem: SearchResult[] };
    const popularity = engineFor(it.q.locale).popularity;
    const refitResults = fuse(it.alias, sem, LIMIT, calibration, {
      popularity,
      weights: foldWeights.get(it) ?? refitWeights,
    });
    const fusedResults = variant.shipped
      ? fuse(it.alias, sem, LIMIT, calibration, { popularity, weights })
      : refitResults;
    ranked.set(it, {
      cos,
      sem,
      fusedResults,
      unsure: assessConfidence(it.alias, sem, calibration).unsure,
      lists: {
        cos: emojiOf(cos),
        sem: emojiOf(sem),
        rrf: emojiOf(fuse(it.alias, sem, LIMIT, calibration, { popularity, rerank: false })),
        fused: emojiOf(fusedResults),
        refit: emojiOf(refitResults),
      },
    });
  }

  const shared = layout.indexesFor("en")[0];
  const locale = layout.indexesFor("es")[1];
  const memory = {
    sharedMB: mb(indexBytes(shared)),
    glyphMB: mb(indexBytes(layout.glyph)),
    localeMB: mb(indexBytes(locale)),
    bundleMB: mb(
      fileBytes(vectorFileName(variant.documents.key, variant.dims)) +
        fileBytes(glyphVectorFileName(variant.documents.key, variant.dims)),
    ),
    localeFileMB: mb(fileBytes(vectorFileName(variant.documents.key, variant.dims, "es"))),
  };

  const run: VariantRun = { variant, layout, calibration, weights, ranked, memory };
  if (args.concepts) {
    const asked = [...items.filter((it) => it.set === "entities-dev"), ...examples];
    const { verdicts, stats } = await runConceptTier(
      asked.map((it) => ({
        query: it.alias.query,
        locale: it.q.locale,
        alias: it.alias,
        semantic: (ranked.get(it) as Ranked).sem,
      })),
      {
        packDir,
        model: { key: variant.documents.key, dims: variant.dims },
        offline: args.offline,
        calibration,
      },
    );
    conceptStats = stats;
    run.concept = new Map(
      asked.map((it, i) => {
        const verdict = verdicts[i];
        const merged = mergeConcept(
          (ranked.get(it) as Ranked).fusedResults,
          verdict?.concept?.results ?? [],
          it.alias,
          LIMIT,
        );
        return [
          it,
          { lists: emojiOf(merged), ...(verdict?.concept ? { status: verdict.concept.status } : {}) },
        ];
      }),
    );
  }
  return run;
}

// ── Latency and tokens (Workers AI round trips from this machine) ───────────────────────────
interface Usage {
  meta?: { cost_metric_value_1?: number };
  usage?: { prompt_tokens?: number };
}
const tokensOf = (output: unknown): number | undefined => {
  const { meta, usage } = (output ?? {}) as Usage;
  return usage?.prompt_tokens ?? meta?.cost_metric_value_1;
};

async function measureQueries(model: EmbeddingModel, count: number) {
  // Distinct texts the cache never saw: a dev-set query and a counter.
  const texts = items.slice(0, count).map((it, i) => formatQuery(model, embeddingText(`${it.q.q} ${i}`)));
  const ms: number[] = [];
  const tokens: number[] = [];
  for (const text of texts) {
    const started = performance.now();
    const output = await runWorkersAI(model.id, model.input([text], "query"));
    ms.push(performance.now() - started);
    const t = tokensOf(output);
    if (t !== undefined) tokens.push(t);
  }
  return {
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    n: ms.length,
    tokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) / tokens.length : undefined,
  };
}

async function measureDocuments(model: EmbeddingModel, count: number) {
  const documents: { docs: Record<string, { title: string; text: string }> }[] = JSON.parse(
    readFileSync(join(BUILD_DIR, "documents.json"), "utf8"),
  );
  const locales = Object.keys(documents[0]?.docs ?? {});
  const all = locales.flatMap((l) => documents.map((d) => d.docs[l] as { title: string; text: string }));
  const step = Math.max(1, Math.floor(all.length / count));
  const sample = all.filter((_, i) => i % step === 0).slice(0, count);
  let tokens = 0;
  let measured = 0;
  for (let start = 0; start < sample.length; start += model.maxBatch) {
    const batch = sample
      .slice(start, start + model.maxBatch)
      .map((d) => formatDocument(model, d.title, d.text));
    const t = tokensOf(await runWorkersAI(model.id, model.input(batch, "document")));
    if (t === undefined) return { documents: all.length, tokensPerDocument: undefined };
    tokens += t;
    measured += batch.length;
  }
  return { documents: all.length, tokensPerDocument: tokens / Math.max(1, measured) };
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────
const runs: VariantRun[] = [];
/** The concept tier's cached model calls (every call of this prompt version so far). */
let conceptStats: ConceptTierStats | undefined;
const skipped: string[] = [];
const latency = new Map<string, Awaited<ReturnType<typeof measureQueries>>>();
const docTokens = new Map<string, Awaited<ReturnType<typeof measureDocuments>>>();
try {
  for (const variant of variants) {
    process.stdout.write(`${variant.name} … `);
    const result = await runVariant(variant);
    if (typeof result === "string") {
      skipped.push(`${variant.name}: ${result}`);
      console.log("skipped");
      continue;
    }
    runs.push(result);
    console.log("done");
    if (Number(args.latency) > 0 && !latency.has(variant.query.key)) {
      latency.set(variant.query.key, await measureQueries(variant.query, Number(args.latency)));
    }
    if (Number(args["doc-tokens"]) > 0 && !docTokens.has(variant.documents.key)) {
      docTokens.set(
        variant.documents.key,
        await measureDocuments(variant.documents, Number(args["doc-tokens"])),
      );
    }
  }
} finally {
  await disposeEmbeddings();
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────
const lines: string[] = [];
const row = (cells: (string | number)[]) => lines.push(`| ${cells.join(" | ")} |`);
const header = (cells: string[], align: string[]) => {
  row(cells);
  row(align);
};
const scoreOf = (
  run: VariantRun,
  subset: readonly Item[],
  pick: (r: Ranked, it: Item) => string[],
): Summary => summarize(subset.map((it) => judge(it.q, pick(run.ranked.get(it) as Ranked, it))));
const pair = (s: Summary) => `${s.r1} / ${s.r5}`;
const inSet = (set: string) => items.filter((it) => it.set === set);
const pct = (n: number, of: number) => (of ? `${((100 * n) / of).toFixed(1)}%` : "–");
const json: Record<string, unknown> = {
  date: new Date().toISOString(),
  packVersion: packConfig.packVersion,
  skipped,
  variants: {},
};

lines.push(
  "# Embedding models for the semantic tier",
  "",
  `Pack ${packConfig.packVersion}, ${new Date().toISOString().slice(0, 10)}. \`pnpm --filter @emojisense/eval eval:models\` ` +
    "(src/model-bench.ts). Every variant searches its own document vectors (shared + 10 locale files) and glyph " +
    "rows with the production scoring (popularity prior + glyph term). R@1 / R@5.",
  "",
  "- **sem**: semantic tier alone. **fused**: with the alias tier through the learned reranker: production " +
    "weights for bge-m3@1024; for every other variant weights fitted to it on the training sets (in-house, " +
    "semantic-, sentences-, romanized-, ranking-dev), scored there by 5-fold cross-validation. entities-dev is " +
    "never trained on.",
  "- **unsure**: share of queries `assessConfidence` calls unsure with the variant's calibration (the API's " +
    "concept tier asks the LLM for these).",
  "",
  "## Recall by set",
  "",
);
header(
  ["Variant", ...SETS.flatMap((s) => [`${s} sem`, `${s} fused`])],
  ["---", ...SETS.flatMap(() => ["--:", "--:"])],
);
for (const run of runs) {
  row([
    run.variant.name,
    ...SETS.flatMap((set) => [
      pair(scoreOf(run, inSet(set), (r) => r.lists.sem)),
      pair(scoreOf(run, inSet(set), (r) => r.lists.fused)),
    ]),
  ]);
}

lines.push("", "## Ablation: raw cosine and reciprocal rank fusion (all sets together)", "");
header(
  [
    "Variant",
    "cosine only",
    "sem (prior + glyph)",
    "fused, RRF",
    "fused, reranker",
    "fused, reranker refit (CV)",
    "unsure (entities / controls)",
  ],
  ["---", "--:", "--:", "--:", "--:", "--:", "--:"],
);
const scored = items.filter((it) => (SETS as readonly string[]).includes(it.set));
for (const run of runs) {
  const entities = inSet("entities-dev");
  const controls = scored.filter((it) => it.set !== "entities-dev");
  const unsure = (subset: Item[]) => subset.filter((it) => run.ranked.get(it)?.unsure).length;
  row([
    run.variant.name,
    pair(scoreOf(run, scored, (r) => r.lists.cos)),
    pair(scoreOf(run, scored, (r) => r.lists.sem)),
    pair(scoreOf(run, scored, (r) => r.lists.rrf)),
    pair(scoreOf(run, scored, (r) => r.lists.fused)),
    pair(scoreOf(run, scored, (r) => r.lists.refit)),
    `${pct(unsure(entities), entities.length)} / ${pct(unsure(controls), controls.length)}`,
  ]);
}

const entityLocales = [...new Set(inSet("entities-dev").map((it) => it.q.locale))];
lines.push("", "## entities-dev by locale (fused)", "");
header(["Variant", ...entityLocales], ["---", ...entityLocales.map(() => "--:")]);
for (const run of runs) {
  row([
    run.variant.name,
    ...entityLocales.map((l) =>
      pair(
        scoreOf(
          run,
          inSet("entities-dev").filter((it) => it.q.locale === l),
          (r) => r.lists.fused,
        ),
      ),
    ),
  ]);
}

if (args.concepts) {
  lines.push(
    "",
    `## With the LLM concept tier (\`${CONCEPT_MODEL}\`) on entities-dev`,
    "",
    "fused + concept = the concept results merged after confident alias hits for unsure queries (the API).",
    "",
  );
  const calls = conceptStats?.calls ?? [];
  const priced = calls.filter((c) => c.usage?.neurons !== undefined);
  const neurons = priced.reduce((sum, c) => sum + (c.usage?.neurons ?? 0), 0) / Math.max(1, priced.length);
  const ms = calls.map((c) => c.ms);
  if (calls.length) {
    lines.push(
      `LLM call from this machine (n = ${calls.length}): p50 ${percentile(ms, 50).toFixed(0)} ms, p95 ` +
        `${percentile(ms, 95).toFixed(0)} ms; ${neurons.toFixed(2)} neurons → $${(((neurons * USD_PER_1K_NEURONS) / 1000) * 1e6).toFixed(0)} ` +
        "per 1M unsure queries that miss every cache, plus one bge-m3 embedding of the terms.",
      "",
    );
  }
  header(["Variant", "fused", "fused + concept", "LLM calls (unsure)"], ["---", "--:", "--:", "--:"]);
  for (const run of runs) {
    const subset = inSet("entities-dev");
    const withConcept = summarize(subset.map((it) => judge(it.q, run.concept?.get(it)?.lists ?? [])));
    row([
      run.variant.name,
      pair(scoreOf(run, subset, (r) => r.lists.fused)),
      pair(withConcept),
      pct(subset.filter((it) => run.ranked.get(it)?.unsure).length, subset.length),
    ]);
  }
  lines.push("");
  header(
    ["entities-dev by locale, fused + concept", ...entityLocales],
    ["---", ...entityLocales.map(() => "--:")],
  );
  for (const run of runs) {
    row([
      run.variant.name,
      ...entityLocales.map((l) =>
        pair(
          summarize(
            inSet("entities-dev")
              .filter((it) => it.q.locale === l)
              .map((it) => judge(it.q, run.concept?.get(it)?.lists ?? [])),
          ),
        ),
      ),
    ]);
  }
}

if (heldoutVariants.size) {
  lines.push("", "## Held-out (aggregates only)", "");
  header(
    ["Variant", "n", "alias", "sem", "fused", "MRR fused", "unsure"],
    ["---", "--:", "--:", "--:", "--:", "--:", "--:"],
  );
  for (const run of runs.filter((r) => heldoutVariants.has(r.variant.name))) {
    const fused = scoreOf(run, heldout, (r) => r.lists.fused);
    row([
      run.variant.name,
      heldout.length,
      pair(summarize(heldout.map((it) => judge(it.q, emojiOf(it.alias.results))))),
      pair(scoreOf(run, heldout, (r) => r.lists.sem)),
      pair(fused),
      fused.mrr,
      pct(heldout.filter((it) => run.ranked.get(it)?.unsure).length, heldout.length),
    ]);
  }
}

lines.push("", "## Size, memory, latency and cost", "");
lines.push(
  "Worker memory: decoded Float32 rows. Bundled = the shared document file and the glyph file (int8 on disk); " +
    "each locale's file is read on first use and two stay resident (LOCALE_VECTOR_CACHE_SIZE). Latency: " +
    "single-query Workers AI calls from this machine through wrangler's remote AI binding (network to " +
    "Cloudflare included; in a Worker the round trip is shorter). Cost: measured input tokens per query × the " +
    "published price.",
  "",
);
header(
  [
    "Variant",
    "dims",
    "bundle MB (shared + glyph)",
    "isolate MB (shared + glyph + 2 locales)",
    "query tokens",
    "p50 / p95 ms",
    "USD per 1M queries",
    "one-time documents",
  ],
  ["---", "--:", "--:", "--:", "--:", "--:", "--:", "---"],
);
for (const run of runs) {
  const { variant, memory } = run;
  const lat = latency.get(variant.query.key);
  const price = USD_PER_M_TOKENS[variant.query.id];
  const docs = docTokens.get(variant.documents.key);
  const docPrice = USD_PER_M_TOKENS[variant.documents.id];
  const glyphRows = run.layout.glyph?.ids.length ?? 0;
  const docCost =
    docs?.tokensPerDocument !== undefined && docPrice !== undefined
      ? `${docs.documents + glyphRows} texts ≈ ${((docs.documents * docs.tokensPerDocument) / 1e6).toFixed(2)}M tokens ≈ $${((docs.documents * docs.tokensPerDocument * docPrice) / 1e6).toFixed(3)}`
      : docs
        ? `${docs.documents + glyphRows} texts (model reports no tokens; unpriced)`
        : "–";
  row([
    variant.name,
    variant.dims,
    memory.bundleMB,
    Math.round((memory.sharedMB + memory.glyphMB + 2 * memory.localeMB) * 10) / 10,
    lat?.tokens !== undefined ? lat.tokens.toFixed(1) : "–",
    lat ? `${lat.p50.toFixed(0)} / ${lat.p95.toFixed(0)}` : "–",
    price === undefined
      ? "unpriced"
      : lat?.tokens !== undefined
        ? `$${(lat.tokens * price).toFixed(2)}`
        : "–",
    docCost,
  ]);
}

lines.push("", "## Example entity queries (en, fused top 5)", "");
const exampleColumns = [
  ...runs.map((r) => r.variant.name),
  ...(args.concepts && runs[0] ? [`${runs[0].variant.name} + concept`] : []),
];
header(["Query", ...exampleColumns], ["---", ...exampleColumns.map(() => "---")]);
for (const it of examples) {
  row([
    it.q.q,
    ...runs.map((run) => (run.ranked.get(it)?.lists.fused ?? []).slice(0, 5).join(" ")),
    ...(args.concepts && runs[0] ? [(runs[0].concept?.get(it)?.lists ?? []).slice(0, 5).join(" ")] : []),
  ]);
}

lines.push("", "## Calibration and fitted reranker weights", "");
header(["Variant", "floor", "ceiling", "weights"], ["---", "--:", "--:", "---"]);
for (const run of runs) {
  row([run.variant.name, run.calibration.floor, run.calibration.ceiling, `[${run.weights.join(", ")}]`]);
}
if (skipped.length) lines.push("", "Skipped:", ...skipped.map((s) => `- ${s}`));

for (const run of runs) {
  (json.variants as Record<string, unknown>)[run.variant.name] = {
    note: run.variant.note,
    sets: Object.fromEntries(
      SETS.map((set) => [
        set,
        {
          sem: scoreOf(run, inSet(set), (r) => r.lists.sem),
          fused: scoreOf(run, inSet(set), (r) => r.lists.fused),
          unsure: inSet(set).filter((it) => run.ranked.get(it)?.unsure).length,
        },
      ]),
    ),
    ...(heldoutVariants.has(run.variant.name)
      ? {
          heldout: {
            sem: scoreOf(run, heldout, (r) => r.lists.sem),
            fused: scoreOf(run, heldout, (r) => r.lists.fused),
          },
        }
      : {}),
    calibration: run.calibration,
    weights: run.weights,
    memory: run.memory,
    latency: latency.get(run.variant.query.key),
    documents: docTokens.get(run.variant.documents.key),
  };
}
if (args.concepts) json.conceptModel = CONCEPT_MODEL;
json.usdPer1kNeurons = USD_PER_1K_NEURONS;

const report = lines.join("\n");
writeFileSync(join(EVAL_ROOT, "reports", "models.md"), `${report}\n`);
writeFileSync(join(EVAL_ROOT, "reports", "models.json"), `${JSON.stringify(json, null, 1)}\n`);
console.log(report);
