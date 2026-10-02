/**
 * Checks the hosted emoji set mapping (src/sets) for every emoji in pack.en.json, and every
 * single-tone variant the pickers make, against the file listings of the pinned upstreams.
 *
 *   pnpm --filter @emojisense/worker sets              writes src/sets/upstreams.json and
 *                                                      reports/sets-coverage.md
 *   pnpm --filter @emojisense/worker sets -- --check   exits 1 when either file is out of date
 *
 * Listings come from jsDelivr's listing API. It refuses repositories over 50 MB (HTTP 403), which
 * noto-emoji and fluentui-emoji are, so for those the GitHub git trees API lists the same commit.
 * Set GITHUB_TOKEN for a higher GitHub rate limit. Fluent file names do not follow from the code
 * points, so each Fluent folder's metadata.json (fetched once, cached in .cache/) maps them.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type HostedEmojiSet, type Pack, ROW_INDEX, type SkinTone } from "emojisense";
import { createSetCatalog, parseHexcode, type SetEmoji } from "../src/sets/catalog.ts";
import {
  createUpstreamResolver,
  type FluentData,
  fluentPath,
  notoPath,
  type RuleSetData,
  twemojiPath,
  UPSTREAMS,
  type UpstreamData,
  upstreamUrl,
} from "../src/sets/upstreams.ts";

const WORKER = new URL("../", import.meta.url);
const PACK_FILE = new URL("src/generated/pack.en.json", WORKER);
const DATA_FILE = new URL("src/sets/upstreams.json", WORKER);
const REPORT_FILE = new URL("reports/sets-coverage.md", WORKER);
const CACHE_DIR = new URL(".cache/sets/", WORKER);
const CHECK = process.argv.includes("--check");
const METADATA_CONCURRENCY = 16;

/** Repository directories that hold each set's SVGs. */
const DIRECTORIES: Record<HostedEmojiSet, string[]> = {
  twemoji: ["assets/svg"],
  noto: ["2D/svg", "third_party/region-flags/waved-svg"],
  fluent: ["assets"],
};

const TONE_NAMES: Record<SkinTone, string> = {
  none: "",
  light: "light skin tone",
  "medium-light": "medium-light skin tone",
  medium: "medium skin tone",
  "medium-dark": "medium-dark skin tone",
  dark: "dark skin tone",
};

interface Listing {
  files: Set<string>;
  source: string;
}

interface Coverage {
  set: HostedEmojiSet;
  source: string;
  base: { covered: number; total: number };
  variants: { covered: number; total: number };
  overrides: number;
  missing: SetEmoji[];
}

const pack = JSON.parse(await readFile(PACK_FILE, "utf8")) as Pack;
const labels = new Map(pack.emoji.map((row) => [row[ROW_INDEX.hexcode], row[ROW_INDEX.label]]));
const catalog = createSetCatalog(pack.emoji);
const data = {} as UpstreamData;
const listings = {} as Record<HostedEmojiSet, Listing>;

for (const set of ["twemoji", "noto"] as const) {
  listings[set] = await listRepository(set);
  data[set] = ruleSetData(set, listings[set]);
}
listings.fluent = await listRepository("fluent");
data.fluent = await fluentData(listings.fluent);

const coverage = (Object.keys(UPSTREAMS) as HostedEmojiSet[]).map((set) => verify(set));
const json = `${JSON.stringify(data, null, 2)}\n`;
const report = renderReport(coverage);
for (const line of coverage) {
  const total = line.base.total + line.variants.total;
  console.log(
    `${line.set.padEnd(8)} base ${line.base.covered}/${line.base.total}  tones ${line.variants.covered}/${line.variants.total}  all ${percent(total - line.missing.length, total)}  (${line.source})`,
  );
}

if (CHECK) {
  const changed: string[] = [];
  for (const [file, content] of [
    [DATA_FILE, json],
    [REPORT_FILE, report],
  ] as const) {
    if ((await readOrEmpty(file)) !== content) changed.push(file.pathname);
  }
  if (changed.length > 0) {
    console.error(`Out of date, run \`pnpm --filter @emojisense/worker sets\`: ${changed.join(", ")}`);
    process.exit(1);
  }
} else {
  await mkdir(new URL("reports/", WORKER), { recursive: true });
  await writeFile(DATA_FILE, json);
  await writeFile(REPORT_FILE, report);
  console.log(`Wrote ${DATA_FILE.pathname} and ${REPORT_FILE.pathname}`);
}

/** Twemoji and Noto: the naming rule, plus overrides found by matching names without U+FE0F. */
function ruleSetData(set: "twemoji" | "noto", listing: Listing): RuleSetData {
  const rule = set === "twemoji" ? twemojiPath : notoPath;
  const byKey = new Map<string, string>();
  for (const file of listing.files) {
    const key = keyOfFile(set, file);
    if (key) byKey.set(key, file);
  }
  const overrides: Record<string, string> = {};
  const missing: Record<string, string> = {};
  for (const entry of catalog.all) {
    if (listing.files.has(rule(entry.emoji))) continue;
    const other = byKey.get(keyOf(entry.hexcode));
    if (other) overrides[entry.hexcode] = other;
    else missing[entry.hexcode] = labelOf(entry);
  }
  return { commit: UPSTREAMS[set].commit, overrides, missing };
}

/** "assets/svg/1f3f3-fe0f-200d-1f308.svg" or ".../emoji_u1f3f3_200d_1f308.svg" → lookup key. */
function keyOfFile(set: "twemoji" | "noto", file: string): string | undefined {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const match =
    set === "twemoji" ? /^([0-9a-f-]+)\.svg$/.exec(name) : /^emoji_u([0-9a-f_]+)\.svg$/.exec(name);
  return match?.[1] ? keyOf(match[1].replaceAll("_", "-")) : undefined;
}

/** Hexcode without U+FE0F, uppercase, 4-digit minimum: equal for every spelling of one emoji. */
function keyOf(hexcode: string): string {
  return (parseHexcode(hexcode) ?? [])
    .filter((codePoint) => codePoint !== 0xfe0f)
    .map((codePoint) => codePoint.toString(16).toUpperCase().padStart(4, "0"))
    .join("-");
}

interface FluentMetadata {
  unicode: string;
  unicodeSkintones?: string[];
}

/** Fluent: folder metadata (`unicode`) → the folder's Flat SVG, Default tone when it has tones. */
async function fluentData(listing: Listing): Promise<FluentData> {
  const folders = [...listing.files]
    .map((file) => /^assets\/([^/]+)\/metadata\.json$/.exec(file)?.[1])
    .filter((folder): folder is string => folder !== undefined)
    .sort();
  const metadata = await fluentMetadata(folders);
  const files: Record<string, string> = {};
  const unmatched: string[] = [];
  for (const folder of folders) {
    const meta = metadata[folder];
    const entry = meta ? catalog.find(meta.unicode.trim().replaceAll(" ", "-")) : undefined;
    if (entry?.tone !== "none") {
      unmatched.push(folder);
      continue;
    }
    const svg = flatSvg(listing, folder);
    if (!svg) throw new Error(`fluent: no Flat SVG in assets/${folder}`);
    if (files[entry.base]) throw new Error(`fluent: ${entry.base} is in two folders (${files[entry.base]})`);
    files[entry.base] = svg;
  }
  if (unmatched.length > 0) {
    console.log(`fluent: ${unmatched.length} folders are not pack emoji: ${unmatched.join(", ")}`);
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const missing: Record<string, string> = {};
  for (const entry of catalog.all) {
    const path = fluentPath(entry, sorted);
    if (!path || !listing.files.has(path)) missing[entry.hexcode] = labelOf(entry);
  }
  return { commit: UPSTREAMS.fluent.commit, files: sorted, missing };
}

function flatSvg(listing: Listing, folder: string): string | undefined {
  const candidates = [`assets/${folder}/Flat/`, `assets/${folder}/Default/Flat/`];
  const svgs = [...listing.files].filter(
    (file) =>
      file.endsWith(".svg") &&
      candidates.some((dir) => file.startsWith(dir) && !file.includes("/", dir.length)),
  );
  if (svgs.length > 1) throw new Error(`fluent: several Flat SVGs in assets/${folder}: ${svgs.join(", ")}`);
  return svgs[0];
}

async function fluentMetadata(folders: string[]): Promise<Record<string, FluentMetadata>> {
  const cacheFile = new URL(`fluent-metadata-${UPSTREAMS.fluent.commit}.json`, CACHE_DIR);
  const cached = JSON.parse((await readOrEmpty(cacheFile)) || "{}") as Record<string, FluentMetadata>;
  const todo = folders.filter((folder) => !cached[folder]);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const folder = todo[next++] as string;
      cached[folder] = (await fetchJson(
        upstreamUrl("fluent", `assets/${folder}/metadata.json`),
      )) as FluentMetadata;
    }
  };
  await Promise.all(Array.from({ length: METADATA_CONCURRENCY }, worker));
  if (todo.length > 0) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(cached));
  }
  return cached;
}

/** Every emoji resolves to a listed file, or is listed as missing. Fails loudly otherwise. */
function verify(set: HostedEmojiSet): Coverage {
  const resolve = createUpstreamResolver(data);
  const listing = listings[set];
  const missing: SetEmoji[] = [];
  const base = { covered: 0, total: 0 };
  const variants = { covered: 0, total: 0 };
  for (const entry of catalog.all) {
    const path = resolve(set, entry);
    if (path !== undefined && !listing.files.has(path)) {
      throw new Error(`${set}: ${entry.hexcode} maps to ${path}, which ${UPSTREAMS[set].repo} does not have`);
    }
    if (path === undefined && !(entry.hexcode in data[set].missing)) {
      throw new Error(`${set}: ${entry.hexcode} has no path and is not listed as missing`);
    }
    const counter = entry.tone === "none" ? base : variants;
    counter.total++;
    if (path) counter.covered++;
    else missing.push(entry);
  }
  const overrides = "overrides" in data[set] ? Object.keys((data[set] as RuleSetData).overrides).length : 0;
  return { set, source: listing.source, base, variants, overrides, missing };
}

async function listRepository(set: HostedEmojiSet): Promise<Listing> {
  const { repo, commit } = UPSTREAMS[set];
  const directories = DIRECTORIES[set];
  const inDirectories = (file: string) => directories.some((dir) => file.startsWith(`${dir}/`));
  const response = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${repo}@${commit}?structure=flat`);
  if (response.ok) {
    const body = (await response.json()) as { files: { name: string }[] };
    const files = body.files.map((file) => file.name.replace(/^\//, "")).filter(inDirectories);
    return { files: new Set(files), source: "jsDelivr listing API" };
  }
  if (response.status !== 403) throw new Error(`jsDelivr listing of ${repo}: HTTP ${response.status}`);
  const reason = ((await response.json()) as { message?: string }).message ?? "HTTP 403";
  console.log(`${set}: jsDelivr refuses to list ${repo} (${reason}); using the GitHub git trees API`);
  const files = new Set<string>();
  for (const dir of directories)
    for (const file of await listGitHubDirectory(repo, commit, dir)) files.add(file);
  return { files, source: "GitHub git trees API (jsDelivr: over 50 MB)" };
}

interface GitTree {
  tree: { path: string; type: "blob" | "tree" | "commit"; sha: string }[];
  truncated: boolean;
}

async function listGitHubDirectory(repo: string, commit: string, dir: string): Promise<string[]> {
  let sha = commit;
  for (const segment of dir.split("/")) {
    const tree = (await fetchJson(
      `https://api.github.com/repos/${repo}/git/trees/${sha}`,
      githubHeaders(),
    )) as GitTree;
    const entry = tree.tree.find((item) => item.path === segment && item.type === "tree");
    if (!entry) throw new Error(`${repo}@${commit} has no directory ${dir}`);
    sha = entry.sha;
  }
  const tree = (await fetchJson(
    `https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`,
    githubHeaders(),
  )) as GitTree;
  if (tree.truncated) throw new Error(`GitHub truncated the listing of ${repo}/${dir}`);
  return tree.tree.filter((item) => item.type === "blob").map((item) => `${dir}/${item.path}`);
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "emojisense-check-sets",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchJson(url: string, headers: Record<string, string> = {}, attempts = 3): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return await response.json();
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

async function readOrEmpty(file: URL): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

function labelOf(entry: SetEmoji): string {
  const label = labels.get(entry.base) ?? entry.base;
  return entry.tone === "none" ? label : `${label}: ${TONE_NAMES[entry.tone]}`;
}

function percent(part: number, total: number): string {
  return `${((100 * part) / total).toFixed(1)}%`;
}

function count(part: number, total: number): string {
  return `${part.toLocaleString("en")} / ${total.toLocaleString("en")} (${percent(part, total)})`;
}

function renderReport(lines: Coverage[]): string {
  const first = lines[0] as Coverage;
  const out = [
    "# Hosted emoji set coverage",
    "",
    "Generated by `pnpm --filter @emojisense/worker sets` (`scripts/check-sets.ts`). Do not edit.",
    "",
    `Checked: every emoji of pack ${pack.packVersion} (\`pack.en.json\`, Emoji ${pack.emojiVersion}): ` +
      `${first.base.total.toLocaleString("en")} base emoji and ${first.variants.total.toLocaleString("en")} ` +
      "skin-tone variants (one tone for every person, as the pickers apply it). An emoji is covered when " +
      "its mapped path is in the file listing of the pinned commit.",
    "",
    "| Set | Upstream (pinned) | Listing | Base emoji | Skin-tone variants | All | Overrides |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const line of lines) {
    const { repo, commit, release } = UPSTREAMS[line.set];
    const total = line.base.total + line.variants.total;
    out.push(
      `| ${line.set} | [${repo}](https://github.com/${repo}/tree/${commit}) ${release} (\`${commit.slice(0, 7)}\`) ` +
        `| ${line.source} | ${count(line.base.covered, line.base.total)} ` +
        `| ${count(line.variants.covered, line.variants.total)} ` +
        `| ${count(total - line.missing.length, total)} | ${line.overrides} |`,
    );
  }
  out.push(
    "",
    "**Overrides** are emoji whose file name does not follow the set's naming rule (usually a U+FE0F " +
      "difference); `src/sets/upstreams.json` maps them. The route answers `404 not_in_set` for missing " +
      "emoji, and the pickers fall back to the native emoji.",
  );
  for (const line of lines) {
    const missingBase = line.missing.filter((entry) => entry.tone === "none");
    const missingBases = new Set(missingBase.map((entry) => entry.base));
    const missingTones = line.missing.filter(
      (entry) => entry.tone !== "none" && !missingBases.has(entry.base),
    );
    out.push("", `## ${line.set}: ${line.missing.length.toLocaleString("en")} missing`, "");
    if (line.missing.length === 0) {
      out.push("Every emoji is covered.");
      continue;
    }
    const tonesOfMissing = line.missing.length - missingBase.length - missingTones.length;
    if (missingBase.length > 0) {
      out.push(
        `${missingBase.length} base emoji` +
          (tonesOfMissing > 0 ? ` (and their ${tonesOfMissing} skin-tone variants)` : "") +
          ":",
        "",
        "| Hexcode | Emoji | Label |",
        "| --- | --- | --- |",
        ...missingBase.map((entry) => `| \`${entry.hexcode}\` | ${entry.emoji} | ${labelOf(entry)} |`),
        "",
      );
    }
    if (missingTones.length > 0) {
      out.push(
        `${missingTones.length} skin-tone variants of covered emoji:`,
        "",
        "| Hexcode | Emoji | Label |",
        "| --- | --- | --- |",
        ...missingTones.map((entry) => `| \`${entry.hexcode}\` | ${entry.emoji} | ${labelOf(entry)} |`),
        "",
      );
    }
    if (out.at(-1) === "") out.pop();
  }
  return `${out.join("\n")}\n`;
}
