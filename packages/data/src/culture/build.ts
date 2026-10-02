/**
 * Approved culture entries → dist/culture/<packVersion>/culture.<locale>.json (docs/PACK_FORMAT.md §9).
 *
 *   tsx src/culture/build.ts [--date YYYY-MM-DD] [--days 366] [--out DIR]
 *
 * Each file holds the lasting and regional entries plus the seasonal and event entries active on
 * any day of [date, date + days], with their exact windows. 366 days = at least 12 months, so the
 * SDKs and the search API switch entries on and off by their own day and no daily rebuild is
 * needed. The Worker sync (`pnpm --filter @emojisense/worker sync`) runs the same build and
 * publishes the directory with `Cache-Control: max-age=3600`. Approving new entries still needs a
 * sync and a deploy.
 */
import { parseArgs } from "node:util";
import { localDay } from "emojisense";
import { buildCultureFiles, CultureValidationError } from "./build-files.ts";
import { CULTURE_DAYS } from "./compile.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    date: { type: "string" },
    days: { type: "string", default: String(CULTURE_DAYS) },
    out: { type: "string" },
  },
});

try {
  const build = buildCultureFiles({
    from: args.date ?? localDay(),
    days: Number(args.days),
    ...(args.out ? { outDir: args.out } : {}),
  });
  const kb = (n: number) => (n / 1024).toFixed(1).padStart(5);
  for (const [locale, summary] of Object.entries(build.locales)) {
    console.log(
      `culture: ${locale.padEnd(3)} ${String(summary.entries).padStart(3)} entries ` +
        `${kb(summary.bytes)} KB raw ${kb(summary.gzipBytes)} KB gz` +
        (summary.featuredOnFrom.length > 0 ? `  on ${build.from}: ${summary.featuredOnFrom.join(", ")}` : ""),
    );
  }
  console.log(
    `culture: ${build.approved} approved entries, ${build.from} → ${build.until} → ${build.outDir}`,
  );
} catch (error) {
  if (error instanceof CultureValidationError) {
    for (const e of error.errors) console.error(`✘ ${e.id}: ${e.message}`);
  }
  console.error(`culture:build: ${(error as Error).message}`);
  process.exit(error instanceof CultureValidationError ? 1 : 2);
}
