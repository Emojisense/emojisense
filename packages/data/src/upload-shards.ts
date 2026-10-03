/**
 * Publish a base build (build-base-shards.ts) to the CDN bucket of an environment
 * (PACK_FORMAT.md §6):
 *
 *   tsx src/upload-shards.ts --env dev|production [--dir dist/shards-base/<packVersion>]
 *
 * Uploads the files the bucket does not have yet (they are named by content), writes the
 * manifest, then names each locale's base index in its live index, writing an empty live index
 * where none exists, so clients read the base at once rather than after the next nightly build.
 * Needs `wrangler login`: R2 through remote bindings (wrangler.upload.jsonc).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readPackConfig } from "./config.ts";
import { DATA_ROOT } from "./paths.ts";
import {
  BASE_MANIFEST_FILE,
  cdnVersionDir,
  liveIndexDir,
  liveIndexPath,
  relativeTo,
  SHARD_FILES_DIR,
  type ShardBaseManifest,
  stateVersionDir,
} from "./shards/publish.ts";
import type { ShardIndex } from "./shards/types.ts";

/** The part of R2Bucket the upload uses. */
interface Bucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(
    key: string,
    value: string,
    options: { httpMetadata: { contentType: string; cacheControl: string } },
  ): Promise<unknown>;
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { env: { type: "string" }, dir: { type: "string" } },
});
const binding = { dev: "CDN_DEV", production: "CDN_PRODUCTION" }[args.env ?? ""];
if (!binding) {
  console.error("upload-shards: pass --env dev or --env production");
  process.exit(2);
}
const config = readPackConfig();
const dir = args.dir ?? join(DATA_ROOT, "dist", "shards-base", config.packVersion);
const manifest = JSON.parse(readFileSync(join(dir, BASE_MANIFEST_FILE), "utf8")) as ShardBaseManifest;
if (manifest.model.startsWith("fake@")) {
  console.error("upload-shards: this is a dry-run build (fake resolver); it is never published");
  process.exit(2);
}

const JSON_TYPE = "application/json; charset=utf-8";
// Keep in sync with SHARD_FILE_CACHE and SHARD_INDEX_BROWSER_CACHE (packages/worker/src/config.ts).
const FILE_CACHE = "public, max-age=31536000, immutable";
const INDEX_CACHE = "public, max-age=3600";

const { getPlatformProxy } = await import("wrangler");
const proxy = await getPlatformProxy<Record<string, Bucket>>({
  configPath: join(DATA_ROOT, "wrangler.upload.jsonc"),
});
try {
  const bucket = proxy.env[binding] as Bucket;
  const version = cdnVersionDir(manifest.packVersion);

  const existing = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: version + SHARD_FILES_DIR, ...(cursor ? { cursor } : {}) });
    for (const { key } of page.objects) existing.add(key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const names = readdirSync(join(dir, SHARD_FILES_DIR)).filter((name) => name.endsWith(".json"));
  const missing = names.filter((name) => !existing.has(`${version}${SHARD_FILES_DIR}${name}`));
  let done = 0;
  const lane = async () => {
    while (missing.length > 0) {
      const name = missing.pop() as string;
      const json = readFileSync(join(dir, SHARD_FILES_DIR, name), "utf8");
      await bucket.put(`${version}${SHARD_FILES_DIR}${name}`, json, {
        httpMetadata: { contentType: JSON_TYPE, cacheControl: FILE_CACHE },
      });
      if (process.stdout.isTTY) process.stdout.write(`\rupload: ${++done}`);
    }
  };
  const uploads = missing.length;
  await Promise.all(Array.from({ length: 8 }, lane));
  if (process.stdout.isTTY && uploads > 0) process.stdout.write("\n");

  await bucket.put(
    `${stateVersionDir(manifest.packVersion)}${BASE_MANIFEST_FILE}`,
    JSON.stringify(manifest),
    {
      httpMetadata: { contentType: JSON_TYPE, cacheControl: "no-store" },
    },
  );

  const named: string[] = [];
  for (const [locale, indexPath] of Object.entries(manifest.locales)) {
    const key = version + liveIndexPath(locale);
    const stored = await bucket.get(key);
    const live = stored ? (JSON.parse(await stored.text()) as ShardIndex) : undefined;
    if (live && live.model !== manifest.model) {
      console.warn(
        `upload-shards: ${locale}: live index is for ${live.model}, base is ${manifest.model}; not named`,
      );
      continue;
    }
    const index: ShardIndex = {
      ...(live ?? {
        format: "emojisense-shards",
        formatVersion: 1,
        packVersion: manifest.packVersion,
        model: manifest.model,
        keys: [],
        files: {},
      }),
      base: relativeTo(liveIndexDir(locale), indexPath),
    };
    await bucket.put(key, JSON.stringify(index), {
      httpMetadata: { contentType: JSON_TYPE, cacheControl: INDEX_CACHE },
    });
    named.push(locale);
  }
  console.log(
    `upload-shards (${args.env}): ${uploads} of ${names.length} files uploaded, manifest written, ` +
      `base named in ${named.length} live indexes (${named.join(", ")})`,
  );
} finally {
  await proxy.dispose();
}
