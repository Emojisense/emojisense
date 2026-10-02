/**
 * Tier 3: learn aliases from real misses. Run nightly (cron) or by hand.
 *
 *   tsx src/mine.ts --from analytics [--days 1] [--min-count 5] [--provider workers-ai] [--apply]
 *   tsx src/mine.ts --from misses.jsonl …          (rows: {"q": "...", "locale": "en", "n": 12})
 *
 * 1. Load aggregated low-confidence queries (Analytics Engine `blob5 = 'miss'`). Only queries seen
 *    at least --min-count times are used (k-anonymity: rare strings may be personal).
 * 2. Build candidates per query: today's alias results + the semantic tier's (when vectors are local).
 * 3. An LLM picks 0–3 candidates the query should map to (provider "none" = candidates only).
 * 4. Gate: rebuild the alias engine with the proposals and rerun the eval. Recall@5 must not drop
 *    and forbidden hits must not rise.
 * 5. --apply appends accepted proposals to packages/data/enrichment/mined.json; then rebuild the
 *    pack (pnpm data:build) and ship a new pack version.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runWorkersAI } from "@emojisense/data/embeddings";
import { DATA_ROOT } from "@emojisense/data/paths";
import { type AliasEngine, createEngine, normalize, type Pack, ROW_INDEX } from "emojisense";
import { judge, summarize } from "./metrics.ts";
import { loadQueries } from "./queries.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    from: { type: "string", default: "analytics" },
    days: { type: "string", default: "1" },
    "min-count": { type: "string", default: "5" },
    provider: { type: "string", default: "workers-ai" },
    model: { type: "string", default: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    limit: { type: "string", default: "200" },
    apply: { type: "boolean", default: false },
  },
});

interface Miss {
  q: string;
  locale: "en" | "tr";
  n: number;
}
interface Proposal extends Miss {
  hexcode: string;
  emoji: string;
}

const EVAL_ROOT = new URL("..", import.meta.url).pathname;
const MINED_PATH = join(DATA_ROOT, "enrichment", "mined.json");
const minCount = Number(args["min-count"]);
const packVersion = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8")).packVersion;
const packDir = join(DATA_ROOT, "dist", "packs", packVersion);
const packs: Pack[] = ["en", "tr"].map((l) =>
  JSON.parse(readFileSync(join(packDir, `pack.${l}.json`), "utf8")),
);
const engine = createEngine(packs);

async function loadMisses(): Promise<Miss[]> {
  if (args.from !== "analytics") {
    return readFileSync(args.from as string, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Miss);
  }
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
  if (!token || !account)
    throw new Error("--from analytics needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID");
  const sql = `
    SELECT blob1 AS q, blob2 AS locale, SUM(_sample_interval) AS n
    FROM emojisense_search
    WHERE blob5 = 'miss' AND timestamp > NOW() - INTERVAL '${Number(args.days)}' DAY
    GROUP BY q, locale
    HAVING n >= ${minCount}
    ORDER BY n DESC
    LIMIT ${Number(args.limit)}
    FORMAT JSON`;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: sql,
    },
  );
  if (!response.ok) throw new Error(`Analytics Engine SQL: HTTP ${response.status} ${await response.text()}`);
  return ((await response.json()) as { data: Miss[] }).data;
}

function candidates(miss: Miss) {
  return engine
    .search(miss.q, { locale: miss.locale, limit: 15, prefix: false })
    .results.map((r) => ({ hexcode: r.id, emoji: r.emoji, label: r.label }));
}

async function pick(miss: Miss, options: ReturnType<typeof candidates>): Promise<string[]> {
  if (args.provider === "none" || options.length === 0) return [];
  const list = options.map((o) => `${o.hexcode} ${o.emoji} ${o.label}`).join("\n");
  const prompt = [
    `People typed "${miss.q}" (${miss.locale === "tr" ? "Turkish" : "English"}) into an emoji search box.`,
    "Which of these emoji did they most likely want? Pick 0 to 3. Pick none if no candidate fits.",
    list,
    'Answer with JSON only: {"picks": ["HEXCODE", ...]}',
  ].join("\n\n");
  const output = (await runWorkersAI(args.model as string, {
    messages: [{ role: "user", content: prompt }],
    max_tokens: 100,
    temperature: 0,
  })) as { response?: string | { picks?: string[] } };
  const raw = output.response;
  const parsed =
    typeof raw === "string"
      ? (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { picks?: string[] })
      : raw;
  const allowed = new Set(options.map((o) => o.hexcode));
  return (parsed?.picks ?? []).filter((h) => allowed.has(h)).slice(0, 3);
}

function withAliases(base: Pack[], proposals: Proposal[]): AliasEngine {
  const patched = base.map((pack) => ({
    ...pack,
    emoji: pack.emoji.map((row) => {
      const extra = proposals.filter((p) => p.locale === pack.locale && p.hexcode === row[ROW_INDEX.hexcode]);
      if (extra.length === 0) return row;
      const copy = [...row] as typeof row;
      copy[ROW_INDEX.alias] = [row[ROW_INDEX.alias], ...extra.map((p) => normalize(p.q))]
        .filter(Boolean)
        .join("|");
      return copy;
    }),
  }));
  return createEngine(patched);
}

function gate(candidate: AliasEngine) {
  const queries = loadQueries(join(EVAL_ROOT, "queries", "queries.jsonl")).filter(
    (q) => q.answers.length > 0,
  );
  const run = (e: AliasEngine) =>
    summarize(
      queries.map((q) =>
        judge(
          q,
          e.search(q.q, { locale: q.locale, limit: 10 }).results.map((r) => r.emoji),
        ),
      ),
    );
  return { before: run(engine), after: run(candidate) };
}

const misses = (await loadMisses())
  .map((m) => ({ ...m, q: normalize(m.q) }))
  .filter((m) => m.q !== "" && m.n >= minCount && engine.search(m.q, { locale: m.locale }).confidence < 0.6);
console.log(`mine: ${misses.length} misses with n ≥ ${minCount} still below confidence 0.6`);

const proposals: Proposal[] = [];
for (const miss of misses) {
  const options = candidates(miss);
  for (const hexcode of await pick(miss, options)) {
    proposals.push({ ...miss, hexcode, emoji: engine.get(hexcode)?.emoji ?? "" });
  }
}
writeFileSync(
  join(DATA_ROOT, "build", "proposals.csv"),
  [
    "q,locale,n,emoji,hexcode",
    ...proposals.map((p) => `"${p.q}",${p.locale},${p.n},${p.emoji},${p.hexcode}`),
  ].join("\n"),
);

const { before, after } = gate(withAliases(packs, proposals));
const passed = after.r5 >= before.r5 && after.forbidRate <= before.forbidRate;
console.log(
  `mine: ${proposals.length} proposals | eval R@5 ${before.r5} → ${after.r5}, forbid@3 ${before.forbidRate} → ${after.forbidRate} | ${passed ? "✔ gate passed" : "✘ gate failed"}`,
);

if (args.apply && passed && proposals.length > 0) {
  const existing = existsSync(MINED_PATH) ? JSON.parse(readFileSync(MINED_PATH, "utf8")) : [];
  const minedAt = new Date().toISOString().slice(0, 10);
  const added = proposals.map(({ hexcode, locale, q, n }) => ({
    hexcode,
    locale,
    alias: q,
    count: n,
    minedAt,
  }));
  writeFileSync(MINED_PATH, `${JSON.stringify([...existing, ...added], null, 1)}\n`);
  console.log(
    `mine: appended ${added.length} aliases to ${MINED_PATH}. Next: pnpm data:build, bump packVersion.`,
  );
}
process.exit(passed ? 0 : 1);
