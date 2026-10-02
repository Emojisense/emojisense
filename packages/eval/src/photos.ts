/**
 * Photo → emoji eval against a running API (POST /v1/classify-image).
 *
 *   pnpm --filter @emojisense/eval photos [-- --api http://localhost:8788 --key pk_demo --label after]
 *
 * Sends every photo in photos/labels.jsonl (no X-Image-Hash, so nothing is cached), scores the
 * results against the acceptable emoji, and stores the run as reports/photos.<label>.json.
 * reports/photos.md compares all stored runs ("before" and "after" first).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import { EVAL_ROOT } from "./cost-inputs.ts";
import { loadPhotoSet } from "./images/labels.ts";
import { classifyImage } from "./live/api.ts";
import { judgeRanking, summarizePrecision } from "./live/precision.ts";
import { type LiveItem, loadRuns, renderComparison, saveRun } from "./live/runs.ts";

const REPORTS = join(EVAL_ROOT, "reports");
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    photos: { type: "string", default: join(EVAL_ROOT, "photos") },
    api: { type: "string", default: "http://localhost:8788" },
    key: { type: "string", default: "pk_demo" },
    label: { type: "string", default: "latest" },
    limit: { type: "string", default: "8" },
  },
});

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const set = loadPhotoSet(args.photos as string);
for (const file of set.missing) console.warn(`⚠ ${file} is in labels.jsonl but not in ${args.photos}`);
if (set.photos.length === 0) {
  console.log("photos: no labelled photos. See photos/README.md. Skipping.");
  process.exit(0);
}

const target = { api: (args.api as string).replace(/\/$/, ""), key: args.key as string };
const items: LiveItem[] = [];
for (const photo of set.photos) {
  const id = photo.label.file.replace(/\.\w+$/, "");
  const base = { id, answers: photo.label.answers };
  const type = TYPES[extname(photo.label.file).toLowerCase()];
  try {
    if (!type) throw new Error("only JPEG and WebP are accepted by the API");
    const { body, ms } = await classifyImage(target, readFileSync(photo.path), type, Number(args.limit));
    if (body.overLimit) throw new Error("over the plan limit: use a key with a larger plan (--key)");
    const ranked = body.results.map((r) => r.emoji);
    items.push({
      ...base,
      input: body.caption,
      ...(body.keywords ? { keywords: body.keywords } : {}),
      judged: judgeRanking(ranked, photo.label.answers),
      results: body.results.map(({ emoji, source }) => ({ emoji, source })),
      ms,
      ...(body.degraded ? { error: "degraded (Workers AI unavailable)" } : {}),
    });
    process.stdout.write(".");
  } catch (error) {
    items.push({
      ...base,
      input: "",
      judged: judgeRanking([], photo.label.answers),
      results: [],
      error: (error as Error).message,
    });
    process.stdout.write("x");
  }
}
process.stdout.write("\n");

const run = {
  kind: "photos" as const,
  label: args.label as string,
  date: new Date().toISOString(),
  api: target.api,
  summary: summarizePrecision(items.map((item) => item.judged)),
  failed: items.filter((item) => item.error).length,
  items,
};
const saved = saveRun(REPORTS, run);
const markdown = renderComparison(loadRuns(REPORTS, "photos"), {
  title: "Photo → emoji eval (live API)",
  intro: [
    `- ${set.photos.length} photos in \`photos/\` (CC0, credits in \`photos/CREDITS.md\`), 2–4 acceptable emoji each in \`photos/labels.jsonl\`.`,
    "- Each run sends every photo to `POST /v1/classify-image?limit=8&locale=en` without `X-Image-Hash`.",
    "- **P@1**: the top result is acceptable. **P@4**: share of the top 4 that is acceptable. Its ceiling is below 100 because some photos have fewer than 4 acceptable emoji. **Hit@4**: any acceptable emoji in the top 4.",
    "- The vision model is not deterministic: a rerun can move single photos.",
  ],
  itemName: "Photo",
});
writeFileSync(join(REPORTS, "photos.md"), markdown);
const s = run.summary;
console.log(`photos ${run.label}: P@1 ${s.p1} · P@4 ${s.p4} · Hit@4 ${s.hit4} · failed ${run.failed}/${s.n}`);
console.log(`wrote ${saved} and reports/photos.md`);
