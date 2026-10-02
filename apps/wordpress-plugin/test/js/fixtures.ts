import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pack } from "emojisense";

/** The packs the plugin ships (copied by `pnpm build`), falling back to packages/data/dist. */
const DIRS = [
  join(__dirname, "..", "..", "packs", "0.1.0"),
  join(__dirname, "..", "..", "..", "..", "packages", "data", "dist", "packs", "0.1.0"),
];

export function readPackFile(file: string): string {
  for (const dir of DIRS) {
    try {
      return readFileSync(join(dir, file), "utf8");
    } catch {
      // Try the next directory.
    }
  }
  throw new Error(
    `${file} not found: run \`pnpm data:build\` and \`pnpm --filter @emojisense/wordpress-plugin build\``,
  );
}

export const pack = (locale: string, part: "core" | "ext" = "core"): Pack =>
  JSON.parse(readPackFile(part === "ext" ? `pack.${locale}.ext.json` : `pack.${locale}.json`)) as Pack;

/** A fetch that serves pack files by name from the plugin, and counts requests. */
export function packFetch() {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const file = url.split("/").pop() ?? "";
    try {
      return new Response(readPackFile(file), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response("{}", { status: 404 });
    }
  }) as typeof fetch;
  return { fetchImpl, requests };
}
