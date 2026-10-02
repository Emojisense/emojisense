/**
 * Publish: the deployed culture files (git entries, built at deploy) + the approved live entries
 * (D1) → a new build in R2 → the pointer. The route then serves it at /v1/culture/<packVersion>/…
 * within CULTURE_POINTER_TTL_MS, without a deploy. Every live entry is validated and gated again,
 * because a deploy can bring new packs or a stricter validator; one that fails stays out of the
 * build and is listed in `skipped`. Logs counts and ids only.
 */
import { type CultureRecord, gateFailed, mergeLiveEntries } from "@emojisense/data/culture-core";
import type { CulturePublishReport } from "@emojisense/platform";
import type { Env } from "../env.ts";
import { CULTURE_LIVE_GZIP_BUDGET } from "./config.ts";
import { type CultureRuntime, gateIssues, runGateEach, validate } from "./runtime.ts";
import {
  CULTURE_INDEX_FILE,
  type CultureIndex,
  type CulturePointer,
  gzipBytes,
  liveHash,
  pruneCultureBuilds,
  readCulturePointer,
  readDeployedCulture,
  readDeployedIndex,
  sha256Hex,
  writeCultureBuild,
  writeCulturePointer,
} from "./storage.ts";
import { createCultureStore } from "./store.ts";

export type PublishReason = "nightly" | "manual" | "sync";

/** Live entries that pass validation and the gate now; the others with the reason. */
async function checkLive(runtime: CultureRuntime, env: Env, records: readonly CultureRecord[]) {
  const skipped: { id: string; reason: string }[] = [];
  const valid = records.filter((record) => {
    const error = validate(runtime, record).find((i) => i.level === "error");
    if (error) skipped.push({ id: record.id, reason: `invalid: ${error.message}` });
    return !error;
  });
  const gates = await runGateEach(runtime, env, valid);
  const passing = valid.filter((record) => {
    const result = gates.get(record.id);
    if (!result || !gateFailed(result)) return true;
    const first = gateIssues(result).find((i) => i.level === "error");
    skipped.push({ id: record.id, reason: `gate: ${first?.message ?? "failed"}` });
    return false;
  });
  if (passing.length < valid.length) {
    // For the editors: ids only.
    console.warn(
      JSON.stringify({
        event: "culture_live_gated",
        ids: valid.filter((r) => !passing.includes(r)).map((r) => r.id),
      }),
    );
  }
  return { valid: passing, skipped };
}

export async function runCulturePublish(
  env: Env,
  runtime: CultureRuntime,
  options: { now: number; reason: PublishReason },
): Promise<CulturePublishReport> {
  const started = Date.now();
  const skip = (reason: string): CulturePublishReport => {
    console.log(JSON.stringify({ event: "culture_publish_skipped", reason }));
    return { status: "skipped", reason };
  };
  if (!env.DB) return skip("no database");
  if (!env.SHARDS) return skip("no bucket");
  if (!env.ASSETS) return skip("no assets");
  const bucket = env.SHARDS;
  const { packVersion } = runtime;

  try {
    const deployed = await readDeployedCulture(env, packVersion);
    if (!deployed) return skip("no deployed culture files");
    const live = await createCultureStore(env.DB).approvedLive();
    const records = live.map((l) => l.record as CultureRecord);
    const { valid, skipped } = await checkLive(runtime, env, records);

    const files = new Map<string, string>();
    const index: CultureIndex = { ...deployed.index, locales: { ...deployed.index.locales } };
    const added = new Set<string>();
    const shadowed = new Set<string>();
    for (const [locale, file] of deployed.files) {
      const merged = mergeLiveEntries(file, valid, runtime.catalog);
      for (const id of merged.added) added.add(id);
      for (const id of merged.shadowed) shadowed.add(id);
      const json = JSON.stringify(merged.culture);
      const gz = await gzipBytes(json);
      if (gz > CULTURE_LIVE_GZIP_BUDGET) {
        throw new Error(`culture.${locale}.json would be ${gz} B gzip (budget ${CULTURE_LIVE_GZIP_BUDGET})`);
      }
      files.set(`culture.${locale}.json`, json);
      index.locales[locale] = {
        entries: merged.culture.entries.length,
        bytes: new TextEncoder().encode(json).byteLength,
        gzipBytes: gz,
      };
    }
    for (const id of shadowed) {
      if (!added.has(id)) skipped.push({ id, reason: "in git: the deployed entry is served" });
    }
    const liveIds = [...added].sort();
    const hash = await liveHash(live.map((l) => l.record));
    const served = await readCulturePointer(bucket, packVersion);
    const base: Omit<CulturePointer, "build" | "previous"> = {
      format: "emojisense-culture-pointer",
      formatVersion: 1,
      base: deployed.base,
      liveHash: hash,
      publishedAt: options.now,
      reason: options.reason,
      liveEntries: liveIds,
      skipped,
    };

    if (liveIds.length === 0) {
      // Nothing to add: the deployed files are the answer, without an R2 read per request.
      const pointer: CulturePointer = { ...base, build: null, previous: served?.build ?? null };
      await writeCulturePointer(bucket, packVersion, pointer);
      const pruned = await pruneCultureBuilds(
        bucket,
        packVersion,
        new Set(pointer.previous ? [pointer.previous] : []),
      );
      console.log(
        JSON.stringify({ event: "culture_published", status: "cleared", skipped: skipped.length, pruned }),
      );
      return { status: "cleared", state: stateOf(pointer) };
    }

    index.build = "";
    index.live = liveIds;
    const parts = [...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([n, t]) => `${n}\n${t}`);
    const build = (await sha256Hex(parts.join("\n"))).slice(0, 16);
    index.build = build;
    files.set(CULTURE_INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`);

    const unchanged = served?.build === build && served.base === deployed.base;
    if (!unchanged) await writeCultureBuild(bucket, packVersion, build, files);
    const pointer: CulturePointer = {
      ...base,
      build,
      previous: unchanged ? (served?.previous ?? null) : (served?.build ?? null),
    };
    await writeCulturePointer(bucket, packVersion, pointer);
    const keep = new Set([build, ...(pointer.previous ? [pointer.previous] : [])]);
    const pruned = await pruneCultureBuilds(bucket, packVersion, keep);
    const status = unchanged ? "unchanged" : "published";
    console.log(
      JSON.stringify({
        event: "culture_published",
        status,
        reason: options.reason,
        build,
        live: liveIds.length,
        skipped: skipped.length,
        pruned,
        ms: Date.now() - started,
      }),
    );
    return { status, state: stateOf(pointer) };
  } catch (error) {
    // The served build stays: a failed publish never leaves a half-written pointer.
    console.error(
      JSON.stringify({
        event: "culture_publish_failed",
        error: (error as Error).name,
        message: (error as Error).message,
      }),
    );
    return { status: "failed", reason: (error as Error).message };
  }
}

const stateOf = (pointer: CulturePointer) => ({
  build: pointer.build,
  base: pointer.base,
  publishedAt: pointer.publishedAt,
  reason: pointer.reason,
  liveEntries: pointer.liveEntries,
  skipped: pointer.skipped,
});

/**
 * The 10-minute sync: publish again when a deploy changed the deployed files or the live entries
 * changed since the last publish. Otherwise one R2 read, one D1 read and one asset read.
 */
export async function runCultureSync(
  env: Env,
  runtime: CultureRuntime,
  options: { now: number },
): Promise<CulturePublishReport> {
  if (!env.DB || !env.SHARDS || !env.ASSETS) return { status: "skipped", reason: "bindings missing" };
  const deployed = await readDeployedIndex(env, runtime.packVersion);
  if (!deployed) return { status: "skipped", reason: "no deployed culture files" };
  const pointer = await readCulturePointer(env.SHARDS, runtime.packVersion);
  const live = await createCultureStore(env.DB).approvedLive();
  if (!pointer && live.length === 0) return { status: "unchanged", reason: "nothing live" };
  const hash = await liveHash(live.map((l) => l.record));
  if (pointer && pointer.base === deployed.base && pointer.liveHash === hash) {
    return { status: "unchanged", state: stateOf(pointer) };
  }
  return runCulturePublish(env, runtime, { now: options.now, reason: "sync" });
}

/** Has a deploy or an approval happened since the last publish? (For the admin overview.) */
export async function publishPending(env: Env, runtime: CultureRuntime): Promise<boolean> {
  if (!env.DB || !env.SHARDS || !env.ASSETS) return false;
  const deployed = await readDeployedIndex(env, runtime.packVersion);
  if (!deployed) return false;
  const pointer = await readCulturePointer(env.SHARDS, runtime.packVersion);
  const live = await createCultureStore(env.DB).approvedLive();
  if (!pointer) return live.length > 0;
  return pointer.base !== deployed.base || pointer.liveHash !== (await liveHash(live.map((l) => l.record)));
}
