/**
 * Bundle-size budget for the core package (minified + gzip, everything a client imports).
 *   tsx scripts/size.ts   → fails above BUDGET_BYTES
 */
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const BUDGET_BYTES = 15 * 1024;
const entries = {
  "full API": `export * from "./src/index.ts";`,
  "alias search only": `export { createEngine, normalize } from "./src/index.ts";`,
};

let failed = false;
for (const [name, contents] of Object.entries(entries)) {
  const result = await build({
    stdin: { contents, resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" },
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    treeShaking: true,
  });
  const bytes = gzipSync(result.outputFiles[0]?.contents ?? new Uint8Array(), { level: 9 }).length;
  const over = bytes > BUDGET_BYTES;
  failed ||= over;
  console.log(
    `${over ? "✘" : "✔"} ${name.padEnd(18)} ${(bytes / 1024).toFixed(2)} KB gz (budget ${BUDGET_BYTES / 1024} KB)`,
  );
}
process.exit(failed ? 1 : 0);
