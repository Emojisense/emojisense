/**
 * public/_headers: the cache headers of the Worker's static assets. `_headers` does not apply to
 * Worker responses, but Cloudflare applies it to every response of the asset layer, 404s
 * included. A request that matches several rules gets the headers of all of them (values of the
 * same header are joined with a comma); `! Name` detaches a header that an earlier rule set
 * (developers.cloudflare.com/workers/static-assets/headers/).
 *
 * /v1/pack/* and /v1/culture/* are asset-only (negative patterns in wrangler.jsonc
 * `run_worker_first`): a missing file is a 404 of the asset layer with these headers. So only the
 * files this sync publishes are immutable: the /v1/pack/* rule comes first and gives `no-store`,
 * and one rule per published file detaches it and sets the year-long cache. A browser then never
 * keeps a 404 for a pack path, and a file published later is visible at once.
 * /p/* is not asset-only: a missing shard falls through to the Worker (404, `no-store`).
 */
export const IMMUTABLE = "public, max-age=31536000, immutable";
export const PACK_MISS = "no-store";
/** Cloudflare reads at most 100 rules and ignores the rest. */
export const MAX_HEADER_RULES = 100;

const CORS = "Access-Control-Allow-Origin: *";

export function assetHeaders(packVersion: string, packFiles: readonly string[]): string {
  const rules: string[][] = [
    ["/v1/pack/*", `Cache-Control: ${PACK_MISS}`, CORS],
    ...packFiles.map((file) => [
      `/v1/pack/${packVersion}/${file}`,
      "! Cache-Control",
      `Cache-Control: ${IMMUTABLE}`,
    ]),
    ["/p/*", `Cache-Control: ${IMMUTABLE}`, CORS],
    ["/v1/culture/*", "Cache-Control: public, max-age=3600", CORS],
  ];
  if (rules.length > MAX_HEADER_RULES) {
    throw new Error(`_headers needs ${rules.length} rules; Cloudflare reads only ${MAX_HEADER_RULES}`);
  }
  return `${rules.map(([path, ...headers]) => [path, ...headers.map((h) => `  ${h}`)].join("\n")).join("\n")}\n`;
}
