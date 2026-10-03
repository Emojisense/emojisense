/**
 * The share-card renderer inside the Worker: Wasm modules and the committed fonts are bundled;
 * the @fontsource slices (Cyrillic, Greek, Chinese) and the Noto emoji art come from jsDelivr at
 * pinned versions, kept in the Cache API.
 */
import notoSansPackage from "@fontsource/noto-sans/package.json";
import notoSansScPackage from "@fontsource/noto-sans-sc/package.json";
import { initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import harfbuzzWasm from "harfbuzzjs/hb.wasm";
import { type CardRenderer, createCardRenderer } from "../og/cards";
import bricolage700 from "../og/fonts/bricolage-grotesque-700.woff";
import dmMono400 from "../og/fonts/dm-mono-400.woff";
import hanken400 from "../og/fonts/hanken-grotesk-400.woff";
import hanken500 from "../og/fonts/hanken-grotesk-500.woff";
import arabic400 from "../og/fonts/noto-sans-arabic-400.woff";
import arabic700 from "../og/fonts/noto-sans-arabic-700.woff";
import bengali400 from "../og/fonts/noto-sans-bengali-400.woff";
import bengali700 from "../og/fonts/noto-sans-bengali-700.woff";
import devanagari400 from "../og/fonts/noto-sans-devanagari-400.woff";
import devanagari700 from "../og/fonts/noto-sans-devanagari-700.woff";
import type { FontSource } from "../og/text/fonts";
import { HarfBuzz } from "../og/text/harfbuzz";
import { toSfnt } from "../og/text/woff";

const BUNDLED: Record<string, ArrayBuffer> = {
  "bricolage-grotesque-700.woff": bricolage700,
  "dm-mono-400.woff": dmMono400,
  "hanken-grotesk-400.woff": hanken400,
  "hanken-grotesk-500.woff": hanken500,
  "noto-sans-arabic-400.woff": arabic400,
  "noto-sans-arabic-700.woff": arabic700,
  "noto-sans-bengali-400.woff": bengali400,
  "noto-sans-bengali-700.woff": bengali700,
  "noto-sans-devanagari-400.woff": devanagari400,
  "noto-sans-devanagari-700.woff": devanagari700,
};

const FONTSOURCE_VERSIONS: Record<string, string> = {
  "noto-sans": notoSansPackage.version,
  "noto-sans-sc": notoSansScPackage.version,
};

const IMMUTABLE = "public, max-age=31536000, immutable";

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A pinned, immutable file: from this location's cache, else fetched once and cached. */
async function cachedFetch(url: string): Promise<Uint8Array | undefined> {
  const cache = caches.default;
  const hit = await cache.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const response = await fetch(url);
  if (!response.ok) return undefined;
  const bytes = new Uint8Array(await response.arrayBuffer());
  await cache.put(url, new Response(bytes, { headers: { "Cache-Control": IMMUTABLE } }));
  return bytes;
}

const fonts: FontSource = {
  async read(file) {
    const [root, name] = file.split("/", 2) as [string, string];
    if (root === "og") {
      const bundled = BUNDLED[name];
      if (!bundled) throw new Error(`share cards: ${name} is not bundled`);
      return toSfnt(new Uint8Array(bundled), inflate);
    }
    const version = FONTSOURCE_VERSIONS[root];
    if (!version) throw new Error(`share cards: unknown font source ${root}`);
    const bytes = await cachedFetch(
      `https://cdn.jsdelivr.net/npm/@fontsource/${root}@${version}/files/${name}`,
    );
    if (!bytes) throw new Error(`share cards: no font ${file}`);
    return toSfnt(bytes, inflate);
  },
};

let renderer: Promise<CardRenderer> | undefined;

/** One renderer per isolate: fonts, glyph paths and emoji art stay loaded between requests. */
export function workerCardRenderer(): Promise<CardRenderer> {
  renderer ??= (async () => {
    await initWasm(resvgWasm);
    const harfbuzz = new HarfBuzz(new WebAssembly.Instance(harfbuzzWasm, {}));
    return createCardRenderer({ harfbuzz, fonts, fetchAsset: cachedFetch });
  })().catch((error: unknown) => {
    renderer = undefined;
    throw error;
  });
  return renderer;
}
