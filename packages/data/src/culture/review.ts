/**
 * Review culture entries: preview what each trigger returns with and without the entry, then
 * approve or retire. Git history is the audit trail.
 *
 *   tsx src/culture/review.ts                          drafts, every targeted locale
 *   tsx src/culture/review.ts --status all --id goat-football --locale es
 *   tsx src/culture/review.ts --approve <id> --reviewer <name>
 *   tsx src/culture/review.ts --retire <id> --reviewer <name>
 *
 * Needs the built packs (pnpm data:build). Previews ignore the entry's window and region, so a
 * December entry can be reviewed in October.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type AliasEngine, createEngine, type Pack } from "emojisense";
import { readPackConfig } from "../config.ts";
import { DATA_ROOT } from "../paths.ts";
import { loadCatalog } from "./catalog.ts";
import { compileCulture } from "./compile.ts";
import { loadExclusions } from "./exclusions.ts";
import { loadRecords, writeRecord } from "./records.ts";
import { probeRegions } from "./regional.ts";
import type { CultureRecord, RecordStatus } from "./types.ts";
import { targetLocales, validateRecord } from "./validate.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    status: { type: "string", default: "draft" },
    id: { type: "string" },
    locale: { type: "string" },
    limit: { type: "string", default: "8" },
    approve: { type: "string" },
    retire: { type: "string" },
    reviewer: { type: "string" },
  },
});

const catalog = loadCatalog();
const exclusions = loadExclusions();
const loaded = loadRecords();
const { packVersion } = readPackConfig();

function setStatus(id: string, status: RecordStatus) {
  const found = loaded.find((l) => l.record.id === id);
  if (!found) throw new Error(`culture:review: no entry "${id}"`);
  if (!args.reviewer) throw new Error("culture:review: --reviewer <name> is required");
  const record: CultureRecord = { ...found.record, status, reviewedBy: args.reviewer };
  const errors = validateRecord(record, { catalog, exclusions, fileName: found.fileName }).filter(
    (i) => i.level === "error",
  );
  if (status === "approved" && errors.length > 0) {
    for (const e of errors) console.error(`✘ ${e.message}`);
    throw new Error(`culture:review: ${id} has ${errors.length} errors; fix them before approving`);
  }
  writeRecord(record);
  console.log(`culture: ${id} → ${status} (reviewed by ${args.reviewer}). Commit the file to record it.`);
}

if (args.approve || args.retire) {
  if (args.approve) setStatus(args.approve, "approved");
  if (args.retire) setStatus(args.retire, "retired");
  process.exit(0);
}

const packDir = join(DATA_ROOT, "dist", "packs", packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`culture:review: no packs in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}
const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const engines = new Map<string, AliasEngine>();
function engineFor(locale: string): AliasEngine {
  let engine = engines.get(locale);
  if (!engine) {
    const names = locale === "en" ? ["en", "en.ext"] : ["en", locale, "en.ext", `${locale}.ext`];
    engine = createEngine(names.map(readPack));
    engines.set(locale, engine);
  }
  return engine;
}

const limit = Number(args.limit);
const glyphs = (results: { emoji: string }[]) => results.map((r) => r.emoji).join(" ") || "—";
const selected = loaded
  .map((l) => l.record)
  .filter((r) => (args.id ? r.id === args.id : args.status === "all" || r.status === args.status));

for (const record of selected) {
  const where = record.regions.includes("*") ? "everywhere" : `regions ${record.regions.join(", ")}`;
  const when =
    record.when === null
      ? "always"
      : `${record.when.from} → ${record.when.to}${record.when.recurs ? " yearly" : ""}`;
  console.log(
    `\n■ ${record.id}  [${record.status}, ${record.kind}, ${when}, ${where}${record.featured ? ", featured" : ""}]`,
  );
  console.log(`  by ${record.createdBy}${record.reviewedBy ? `, reviewed by ${record.reviewedBy}` : ""}`);
  for (const issue of validateRecord(record, { catalog, exclusions })) {
    console.log(`  ${issue.level === "error" ? "✘" : "⚠"} ${issue.message}`);
  }
  if (record.exceptRegions?.length) console.log(`  except regions ${record.exceptRegions.join(", ")}`);
  if (!record.regions.includes("*"))
    console.log("  ⚠ regional: applies only when the app passes one of these regions");
  const probes = record.kind === "regional" ? probeRegions(record) : undefined;
  if (probes) {
    console.log(
      `  ⚠ regional sense: with a region in scope, its strongest emoji goes first when the query ` +
        `equals a trigger and the canonical top is one of: ${(record.outranks ?? []).map((h) => catalog.get(h) ?? h).join(" ")}`,
    );
  }
  const locales = targetLocales(record).filter((l) => !args.locale || l === args.locale);
  for (const locale of locales) {
    const triggers = record.triggers[locale] ?? [];
    console.log(`  ${locale}: ${record.context[locale] ?? "(no context)"}`);
    if (triggers.length === 0) continue;
    const culture = compileCulture([record], locale, {
      packVersion,
      from: "2000-01-01",
      catalog,
      statuses: [record.status],
      forceActive: true,
    });
    const engine = engineFor(locale);
    const withEntry = engine.withCulture(culture);
    for (const trigger of triggers) {
      const canonical = engine.search(trigger, { locale, limit, prefix: false, culture: false }).results;
      const boosted = withEntry.search(trigger, { locale, limit, prefix: false }).results;
      const added = boosted.filter((r) => r.source === "culture").length;
      const note =
        canonical.length === 0
          ? "  ⚠ no canonical answer: the culture emoji become the top answer"
          : added === 0
            ? "  (adds nothing new)"
            : "";
      console.log(
        `    "${trigger}"\n      now:  ${glyphs(canonical)}\n      with: ${glyphs(boosted)}${note}`,
      );
      if (!probes) continue;
      const scoped = engine.withCulture(
        compileCulture([record], locale, {
          packVersion,
          from: "2000-01-01",
          catalog,
          statuses: [record.status],
        }),
      );
      for (const region of [probes.inside, probes.outside]) {
        if (!region) continue;
        const regional = scoped.search(trigger, { locale, limit, prefix: false, region }).results;
        console.log(`      ${region}:   ${glyphs(regional)}`);
      }
    }
  }
}
console.log(
  `\nculture: ${selected.length} entries shown (${args.id ? `id ${args.id}` : `status ${args.status}`})`,
);
