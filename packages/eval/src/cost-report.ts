import {
  type CostAssumptions,
  computeLayeredCost,
  type MeasuredRate,
  sensitivity,
  shareGrid,
  withValue,
} from "./cost.ts";

export const usd = (v: number) => (v === 0 ? "$0" : `$${v.toFixed(v < 0.1 ? 4 : v < 10 ? 3 : 2)}`);
export const count = (v: number) =>
  v >= 1e9
    ? `${+(v / 1e9).toFixed(2)}B`
    : v >= 1e6
      ? `${+(v / 1e6).toFixed(2)}M`
      : v >= 1e3
        ? `${+(v / 1e3).toFixed(1)}k`
        : `${+v.toFixed(1)}`;
const pct = (v: number) => `${+(v * 100).toFixed(1)}%`;
const fmtValue = (path: string, v: number) =>
  /Share|Rate/.test(path) ? pct(v) : path === "monthlySearches" ? count(v) : String(+v.toPrecision(4));

const GRID_DEVICE = [0.4, 0.6, 0.8, 0.9];
const GRID_SHARD = [0, 0.25, 0.5, 0.75, 0.9];
const VOLUMES = [1e6, 1e7, 1e8, 1e9];

export interface CostReportOptions {
  /** Markdown heading level of the section title. */
  level?: number;
  measured?: MeasuredRate | undefined;
}

/** The layered cost section: headline, per-layer breakdown, cost lines and sensitivity tables. */
export function renderCostReport(a: CostAssumptions, options: CostReportOptions = {}): string[] {
  const h = "#".repeat(options.level ?? 2);
  const sub = `${h}#`;
  const cost = computeLayeredCost(a);
  const { price, volumes: v } = cost;
  const per1M = (x: number) => (x / v.searches) * 1e6;
  const lines: string[] = [];
  const row = (cells: (string | number)[]) => lines.push(`| ${cells.join(" | ")} |`);

  const deviceSource =
    a.useMeasuredDeviceShare && options.measured ? `measured: ${options.measured.source}` : "assumption";
  const warnings = [
    ...(price.source === "assumed"
      ? [`model price is not published; ${usd(price.pricePerMTokens)} / 1M tokens assumed`]
      : []),
    ...(a.images.perSearch > 0
      ? [`image price ${usd(a.images.pricePerImage)} per image is an assumption`]
      : []),
    `Analytics Engine billing ${a.analyticsEngine.billingStarted ? "is on" : `has not started (it would add ${usd(per1M(cost.analyticsEngineIfBilled))} per 1M searches)`}`,
  ];

  lines.push(
    `${h} Layered cost per 1M searches`,
    "",
    `Model \`${price.id}\` at ${usd(price.pricePerMTokens)} / 1M tokens (${price.source}). ` +
      `L0 share ${pct(a.deviceShare)} (${deviceSource}), L2 share ${pct(a.shardHitShare)} of semantic requests, ` +
      `L3 Cache API hit rate ${pct(a.cacheHitRate)}, ${a.requestsPerSemanticSearch} requests per semantic search.`,
    "",
    `- **Search, all layers L0–L3: ${usd(cost.searchPerMillion)} per 1M searches** (usage beyond the included quotas).`,
    `- With reaction suggestions and images: ${usd(cost.marginalPerMillion)} per 1M searches.`,
    `- All-in at ${count(v.searches)} searches / month: ${usd(cost.allInMonthly)} / month = ` +
      `${usd(cost.allInPerMillion)} per 1M (plan fee and included quotas counted).`,
    ...warnings.map((w) => `- ⚠ ${w}.`),
    "",
  );

  row(["Layer", "Volume per 1M searches", "$ per 1M searches"]);
  row(["---", "--:", "--:"]);
  for (const layer of cost.layers) {
    const unit = layer.layer.startsWith("L0") ? "searches" : "requests";
    row([layer.layer, `${count(per1M(layer.volume))} ${unit}`, usd(per1M(layer.usd))]);
  }
  row([
    "**Total**",
    `${count(per1M(v.workerRequests))} Worker requests`,
    `**${usd(cost.marginalPerMillion)}**`,
  ]);

  lines.push("");
  row(["Cost line", "$ per 1M searches"]);
  row(["---", "--:"]);
  row(["Worker requests", usd(per1M(cost.lines.requests))]);
  row(["Worker CPU", usd(per1M(cost.lines.cpu))]);
  row(["Workers AI embeddings", usd(per1M(cost.lines.embeddings))]);
  row(["Image model", usd(per1M(cost.lines.images))]);
  row(["Analytics Engine", usd(per1M(cost.lines.analyticsEngine))]);
  row(["Workers Logs", usd(per1M(cost.lines.logs))]);
  row(["D1 query counts", usd(per1M(cost.lines.d1))]);
  row(["Shards on the CDN (L2), on device (L0)", "$0"]);

  lines.push("", `${sub} Sensitivity (one input at a time)`, "");
  row(["Input", "Low", "Base", "High", "$ / 1M at low", "at base", "at high"]);
  row(["---", "--:", "--:", "--:", "--:", "--:", "--:"]);
  for (const s of sensitivity(a)) {
    // Volume changes only the all-in figure; every other input changes the marginal one.
    const shown = s.path === "monthlySearches" ? s.allIn : s.marginal;
    row([
      s.path === "monthlySearches" ? `${s.path} (all-in)` : s.path,
      ...s.values.map((x) => fmtValue(s.path, x)),
      ...shown.map(usd),
    ]);
  }

  lines.push("", `${sub} L0 share × L2 share ($ per 1M searches)`, "");
  row(["L0 ↓ / L2 →", ...GRID_SHARD.map(pct)]);
  row(["---", ...GRID_SHARD.map(() => "--:")]);
  shareGrid(a, GRID_DEVICE, GRID_SHARD).forEach((cells, i) => {
    row([pct(GRID_DEVICE[i] as number), ...cells.map(usd)]);
  });

  lines.push("", `${sub} All-in by volume`, "");
  row(["Searches / month", "$ / month", "$ per 1M searches"]);
  row(["---", "--:", "--:"]);
  for (const volume of VOLUMES) {
    const at = computeLayeredCost(withValue(a, "monthlySearches", volume));
    row([count(volume), usd(at.allInMonthly), usd(at.allInPerMillion)]);
  }
  return lines;
}
