/**
 * The share-card renderer for Node: the site build (src/pages/og/) and the tests. Fonts come from
 * src/og/fonts/ and the @fontsource packages; Noto art is fetched once and kept in
 * node_modules/.cache/og-emoji/.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { initWasm } from "@resvg/resvg-wasm";
import { type CardRenderer, createCardRenderer } from "./cards";
import type { FontSource } from "./text/fonts";
import { HarfBuzz } from "./text/harfbuzz";
import { toSfnt } from "./text/woff";

/** apps/web: the build and the tests run there (pack-facts.ts relies on the same). */
const WEB_ROOT = process.cwd();
const FONT_DIR = join(WEB_ROOT, "src/og/fonts");
const CACHE_DIR = join(WEB_ROOT, "node_modules/.cache/og-emoji");
const require = createRequire(join(WEB_ROOT, "package.json"));

let renderer: Promise<CardRenderer> | undefined;
let wasm: Promise<WebAssembly.Module> | undefined;

/** One renderer per process; fonts, glyph paths and emoji stay loaded between cards. */
export function nodeCardRenderer(): Promise<CardRenderer> {
  renderer ??= create();
  return renderer;
}

/** A renderer of its own, for tests that watch it (`onTruncate`). */
export function createNodeCardRenderer(
  options: { onTruncate?: (text: string) => void } = {},
): Promise<CardRenderer> {
  return create(options.onTruncate);
}

async function create(onTruncate?: (text: string) => void): Promise<CardRenderer> {
  if (!existsSync(FONT_DIR))
    throw new Error(`share cards: no fonts in ${FONT_DIR}; run the build from apps/web`);
  wasm ??= (async () => {
    const [, harfbuzzModule] = await Promise.all([
      initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"))),
      WebAssembly.compile(await readFile(require.resolve("harfbuzzjs/hb.wasm"))),
    ]);
    return harfbuzzModule;
  })();
  const harfbuzz = new HarfBuzz(await WebAssembly.instantiate(await wasm, {}));
  return createCardRenderer({
    harfbuzz,
    fonts: fontSource,
    fetchAsset: cachedFetch,
    ...(onTruncate ? { onTruncate } : {}),
  });
}

const fontSource: FontSource = {
  async read(file) {
    const [root, name] = file.split("/", 2) as [string, string];
    const path = root === "og" ? join(FONT_DIR, name) : require.resolve(`@fontsource/${root}/files/${name}`);
    return toSfnt(new Uint8Array(await readFile(path)), (data) => new Uint8Array(inflateSync(data)));
  },
};

async function cachedFetch(url: string): Promise<Uint8Array | undefined> {
  const file = join(CACHE_DIR, createHash("sha256").update(url).digest("hex").slice(0, 32));
  if (existsSync(file)) return new Uint8Array(await readFile(file));
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, bytes);
      return bytes;
    } catch (error) {
      if (attempt === 3) {
        console.warn(`share cards: no emoji art from ${url} (${(error as Error).message})`);
        return undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  return undefined;
}
