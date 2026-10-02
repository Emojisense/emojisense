/**
 * Image → emoji eval: a captioner writes a caption and a likely reaction per photo, both go
 * through normal text search, and the result is scored against photos/labels.jsonl.
 *
 *   pnpm --filter @emojisense/eval eval:images [-- --captioner sidecar|workers-ai|filename]
 *     [--captions photos/captions.json] [--vision-model @cf/llava-hf/llava-1.5-7b-hf] [--offline]
 *
 * With no labelled photos it prints how to add them and exits 0. Text search uses the alias
 * engine, fused with the production model when its vectors exist (--offline: cached query
 * embeddings only). Writes reports/images.md and reports/images.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readPackConfig } from "@emojisense/data/config";
import { disposeEmbeddings, embedTexts, runWorkersAI } from "@emojisense/data/embeddings";
import { formatQuery, getModel } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import {
  createEngine,
  decodeVectors,
  l2normalize,
  normalize,
  type Pack,
  type SearchResult,
  searchVectors,
} from "emojisense";
import { EVAL_ROOT } from "./cost-inputs.ts";
import {
  type Caption,
  type Captioner,
  filenameCaptioner,
  sidecarCaptioner,
  workersAiCaptioner,
} from "./images/captioners.ts";
import { loadPhotoSet, MAX_IMAGE_BYTES } from "./images/labels.ts";
import { rankForCaption, type SemanticSearch } from "./images/search.ts";
import { judge, summarize } from "./metrics.ts";

const PHOTOS_DIR = join(EVAL_ROOT, "photos");
const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    photos: { type: "string", default: PHOTOS_DIR },
    captioner: { type: "string", default: "sidecar" },
    captions: { type: "string", default: join(PHOTOS_DIR, "captions.json") },
    "vision-model": { type: "string", default: "@cf/llava-hf/llava-1.5-7b-hf" },
    offline: { type: "boolean", default: false },
  },
});

const set = loadPhotoSet(args.photos as string);
for (const file of set.missing) console.warn(`⚠ ${file} is in labels.jsonl but not in ${args.photos}`);
for (const file of set.oversized)
  console.warn(`⚠ ${file} is over ${MAX_IMAGE_BYTES / 1024} KB; downscale it`);
if (set.photos.length === 0) {
  console.log("eval:images: no labelled photos yet. Add some as described in photos/README.md. Skipping.");
  process.exit(0);
}

function createCaptioner(kind: string): Captioner {
  if (kind === "sidecar") return sidecarCaptioner(args.captions as string);
  if (kind === "filename") return filenameCaptioner();
  if (kind === "workers-ai") return workersAiCaptioner(args["vision-model"] as string, runWorkersAI);
  throw new Error(`unknown captioner "${kind}" (sidecar, workers-ai, filename)`);
}

const config = readPackConfig();
const packDir = join(DATA_ROOT, "dist", "packs", config.packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`No pack in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}
const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const engine = createEngine(["en", "tr", "en.ext", "tr.ext"].map(readPack));

/** Semantic search with the production model, or a note why it is off. */
async function createSemantic(texts: string[]): Promise<{ search?: SemanticSearch; note: string }> {
  const model = getModel(config.model.key);
  const tag = `${model.key}@${config.model.dims}`;
  const file = join(packDir, `vectors.${tag.replace("@", ".")}.bin`);
  if (!existsSync(file)) return { note: `alias only (no ${file.split("/").at(-1)})` };
  const index = decodeVectors(readFileSync(file));
  const queries = [...new Set(texts.map((t) => normalize(t)).filter(Boolean))];
  try {
    const { vectors } = await embedTexts(
      model,
      queries.map((q) => formatQuery(model, q)),
      "query",
      { offline: args.offline },
    );
    const byQuery = new Map(queries.map((q, i) => [q, vectors[i] as Float32Array]));
    const search: SemanticSearch = (text) => {
      const vector = byQuery.get(normalize(text));
      if (!vector) return undefined;
      return searchVectors(index, l2normalize(vector.slice(0, index.dims)), 24).map(
        (m): SearchResult => ({
          emoji: engine.get(m.id)?.emoji ?? "",
          id: m.id,
          score: m.score,
          source: "semantic",
        }),
      );
    };
    return { search, note: `alias + ${tag}` };
  } catch (error) {
    return { note: `alias only (${(error as Error).message})` };
  }
}

const captioner = createCaptioner(args.captioner as string);
const captions = new Map<string, Caption>();
const failures: string[] = [];
try {
  for (const photo of set.photos) {
    try {
      captions.set(photo.label.file, await captioner.caption(photo));
    } catch (error) {
      failures.push(`${photo.label.file}: ${(error as Error).message}`);
    }
  }
  const semantic = await createSemantic([...captions.values()].flatMap((c) => [c.caption, c.reaction]));

  const outcomes = set.photos.map((photo) => {
    const caption = captions.get(photo.label.file) ?? { caption: "", reaction: "" };
    const ranked = rankForCaption(engine, caption, semantic.search);
    const query = { id: photo.label.file, q: caption.caption, locale: "en" as const, cat: "image" };
    return { photo, caption, outcome: judge({ ...query, answers: photo.label.answers }, ranked) };
  });
  const summary = summarize(outcomes.map((o) => o.outcome));

  const lines = [
    "# Image → emoji eval",
    "",
    `- Date: ${new Date().toISOString().slice(0, 10)} · ${set.photos.length} photos · captioner: ${captioner.name} · search: ${semantic.note}`,
    `- **R@5 ${summary.r5}** · R@1 ${summary.r1} · R@10 ${summary.r10} · MRR ${summary.mrr}`,
    ...failures.map((f) => `- ⚠ caption failed: ${f}`),
    "",
    "| Photo | Caption | Reaction | Expected | Got (top 5) | Rank |",
    "| --- | --- | --- | --- | --- | --: |",
    ...outcomes.map(
      ({ photo, caption, outcome }) =>
        `| ${photo.label.file} | ${caption.caption} | ${caption.reaction} | ${photo.label.answers.join("")} | ` +
        `${outcome.top.join(" ") || "–"} | ${outcome.rank || "–"} |`,
    ),
  ];
  writeFileSync(join(EVAL_ROOT, "reports", "images.md"), `${lines.join("\n")}\n`);
  const json = {
    date: new Date().toISOString(),
    captioner: captioner.name,
    search: semantic.note,
    summary,
    photos: outcomes.map(({ photo, caption, outcome }) => ({
      file: photo.label.file,
      ...caption,
      ...outcome,
    })),
    failures,
  };
  writeFileSync(join(EVAL_ROOT, "reports", "images.json"), `${JSON.stringify(json, null, 1)}\n`);
  console.log(lines.slice(0, 4 + failures.length).join("\n"));
} finally {
  await disposeEmbeddings();
}
