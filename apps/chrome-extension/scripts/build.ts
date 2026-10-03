/**
 * Build the unpacked extension into dist/ (load it from chrome://extensions → Load unpacked).
 *   tsx scripts/build.ts           one build
 *   tsx scripts/build.ts --watch   rebuild the scripts on change (static files: run again)
 *
 * The core and ext packs of every pack language (PACK_LOCALES) are copied from packages/data/dist,
 * so each user's languages work without network and every site shares the one copy inside the
 * extension. The service worker indexes only the user's languages. Fonts are copied from the
 * pinned @fontsource packages: the Web Store does not allow remote resources, and none are needed.
 */
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildOptions, build, context, type Plugin } from "esbuild";
import { createManifest, ICON_SIZES } from "../src/manifest.ts";
import { PICKER_FONTS } from "../src/shared/fonts.ts";
import { packFiles } from "../src/shared/packs.ts";
import { renderIcon } from "./icons.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const DATA = join(ROOT, "../../packages/data");
const PACK_FILES = packFiles();
/** Package → font files in dist/fonts. The options page uses all of them, the picker PICKER_FONTS. */
const FONT_PACKAGES: Record<string, { license: string; files: string[] }> = {
  "@fontsource-variable/hanken-grotesk": {
    license: "hanken-grotesk.OFL-1.1.txt",
    files: ["hanken-grotesk-latin-wght-normal.woff2", "hanken-grotesk-latin-ext-wght-normal.woff2"],
  },
  "@fontsource-variable/bricolage-grotesque": {
    license: "bricolage-grotesque.OFL-1.1.txt",
    files: ["bricolage-grotesque-latin-opsz-normal.woff2"],
  },
  "@fontsource/dm-mono": {
    license: "dm-mono.OFL-1.1.txt",
    files: ["dm-mono-latin-400-normal.woff2", "dm-mono-latin-500-normal.woff2"],
  },
};
const watch = process.argv.includes("--watch");

/** `import css from "./x.css?raw"`: the same contract Vite gives the tests. */
const rawCss: Plugin = {
  name: "raw-css",
  setup(builder) {
    builder.onResolve({ filter: /\.css\?raw$/ }, (args) => ({
      path: join(args.resolveDir, args.path.replace(/\?raw$/, "")),
      namespace: "raw-css",
    }));
    builder.onLoad({ filter: /.*/, namespace: "raw-css" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
      watchFiles: [args.path],
    }));
  },
};

const common: BuildOptions = {
  absWorkingDir: ROOT,
  outdir: DIST,
  bundle: true,
  target: "chrome116",
  // Unminified: the Web Store review reads the code, and the data packs dominate the size anyway.
  minify: false,
  sourcemap: watch ? "inline" : false,
  logLevel: "warning",
  plugins: [rawCss],
};

const bundles: BuildOptions[] = [
  { ...common, entryPoints: { background: "src/background/index.ts" }, format: "esm" },
  // Injected with chrome.scripting.executeScript({ files }), which cannot load modules.
  { ...common, entryPoints: { content: "src/content/index.ts" }, format: "iife" },
  { ...common, entryPoints: { options: "src/options/main.ts" }, format: "esm" },
];

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function copyStatic(): Promise<void> {
  const { version } = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as { version: string };
  await writeFile(join(DIST, "manifest.json"), `${JSON.stringify(createManifest(version), null, 2)}\n`);
  await copyFile(join(ROOT, "src/options/options.html"), join(DIST, "options.html"));
  await copyFile(join(ROOT, "src/options/options.css"), join(DIST, "options.css"));
  await copyFile(join(ROOT, "src/options/fonts.css"), join(DIST, "fonts.css"));
  await copyFile(join(ROOT, "src/shared/tokens.css"), join(DIST, "tokens.css"));

  const { packVersion } = JSON.parse(await readFile(join(DATA, "pack.config.json"), "utf8")) as {
    packVersion: string;
  };
  const packSource = join(DATA, "dist/packs", packVersion);
  if (!(await exists(join(packSource, "manifest.json")))) {
    throw new Error(`Data packs not found in ${packSource}. Run \`pnpm data:build\` first.`);
  }
  // The pack manifest lists what the data build made; a language added there must ship here too.
  const { files: built } = JSON.parse(await readFile(join(packSource, "manifest.json"), "utf8")) as {
    files: Record<string, unknown>;
  };
  const packs = Object.keys(built).filter((file) => /^pack\..+\.json$/.test(file));
  const missing = PACK_FILES.filter((file) => file !== "manifest.json" && !packs.includes(file));
  const unknown = packs.filter((file) => !PACK_FILES.includes(file));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `Packs differ from PACK_LOCALES: missing ${missing.join(", ") || "none"}; unknown ${unknown.join(", ") || "none"}`,
    );
  }
  await mkdir(join(DIST, "packs"), { recursive: true });
  for (const file of PACK_FILES) await copyFile(join(packSource, file), join(DIST, "packs", file));

  // The Unicode license asks for its notice in every copy of the data.
  await mkdir(join(DIST, "licenses"), { recursive: true });
  for (const file of ["README.md", "emojibase-data.MIT.txt", "unicode-cldr.Unicode-3.0.txt"]) {
    await copyFile(join(DATA, "licenses", file), join(DIST, "licenses", file));
  }
  await copyFile(join(ROOT, "../../LICENSE"), join(DIST, "LICENSE"));

  await mkdir(join(DIST, "fonts"), { recursive: true });
  for (const [name, { license, files }] of Object.entries(FONT_PACKAGES)) {
    const source = join(ROOT, "node_modules", name);
    for (const file of files) await copyFile(join(source, "files", file), join(DIST, "fonts", file));
    await copyFile(join(source, "LICENSE"), join(DIST, "licenses", license));
  }
  for (const font of PICKER_FONTS) {
    if (!(await exists(join(DIST, font.file)))) throw new Error(`${font.file} is not in FONT_PACKAGES.`);
  }

  await mkdir(join(DIST, "icons"), { recursive: true });
  for (const size of ICON_SIZES) await writeFile(join(DIST, "icons", `icon-${size}.png`), renderIcon(size));
}

async function report(): Promise<void> {
  const rows: [string, number][] = [];
  for (const file of ["background.js", "content.js", "options.js"]) {
    rows.push([file, (await stat(join(DIST, file))).size]);
  }
  let packBytes = 0;
  for (const file of PACK_FILES) packBytes += (await stat(join(DIST, "packs", file))).size;
  rows.push([`packs/ (${PACK_FILES.length} files)`, packBytes]);
  for (const [file, bytes] of rows)
    console.log(`  ${file.padEnd(24)} ${(bytes / 1024).toFixed(1).padStart(8)} KB`);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await copyStatic();
if (watch) {
  for (const options of bundles) await (await context(options)).watch();
  console.log(`watching src/ → ${DIST} (Ctrl+C to stop; reload the extension after a change)`);
} else {
  await Promise.all(bundles.map((options) => build(options)));
  console.log(`built ${DIST}`);
  await report();
}
