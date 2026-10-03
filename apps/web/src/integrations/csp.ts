/**
 * The site's Content-Security-Policy, written into dist/_headers after the build.
 *
 * Not Astro's `security.csp`: without an adapter it can only emit a <meta> policy, which cannot
 * set frame-ancestors, and it hashes only the scripts and styles Astro adds itself. React's
 * inline Suspense scripts inside island HTML would be blocked. Hashing every inline <script> and
 * <style> of the finished pages covers all of them, and the header protects every response.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

/** Cloudflare ignores a `_headers` header longer than this (static assets limits). */
export const MAX_HEADER_LENGTH = 2000;

/** Same defaults as src/config.ts: the local API Worker and the local dashboard. */
const DEFAULT_API_URL = "http://localhost:8788";
const DEFAULT_DASHBOARD_URL = "http://localhost:8790";

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<[a-zA-Z][\w:-]*((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href"]);
/** Script types the browser runs. Any other type (JSON-LD, JSON) is a data block. */
const EXECUTABLE_TYPE = /^(?:|module|importmap|speculationrules|(?:text|application)\/(?:java|ecma)script)$/i;

export interface InlineContent {
  /** CSP hash sources of the inline scripts, e.g. `'sha256-…'`. */
  scripts: string[];
  /** CSP hash sources of the <style> elements. */
  styles: string[];
  /** Inline event handlers and `javascript:` URLs. The policy blocks them, so the build stops. */
  blocked: string[];
}

export function hashSource(content: string): string {
  return `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name = "", double, single, bare] of source.matchAll(ATTRIBUTE)) {
    found.set(name.toLowerCase(), double ?? single ?? bare ?? "");
  }
  return found;
}

/** Finds what a page runs inline. The regexes fit Astro's own output, not arbitrary HTML. */
export function scanInlineContent(html: string): InlineContent {
  const scripts: string[] = [];
  const styles: string[] = [];
  const blocked: string[] = [];
  const withoutComments = html.replace(COMMENT, "");

  for (const [, attrs = "", body = ""] of withoutComments.matchAll(SCRIPT)) {
    const parsed = attributes(attrs);
    if (parsed.has("src") || !EXECUTABLE_TYPE.test(parsed.get("type")?.trim() ?? "")) continue;
    scripts.push(hashSource(body));
  }
  for (const [, body = ""] of withoutComments.matchAll(STYLE)) styles.push(hashSource(body));

  // Script and style bodies may contain "<" that would read as tags.
  const markup = withoutComments.replace(SCRIPT, "<script$1></script>").replace(STYLE, "<style></style>");
  for (const [tag, attrs = ""] of markup.matchAll(TAG)) {
    for (const [name, value] of attributes(attrs)) {
      const isHandler = name.startsWith("on");
      const isScriptUrl = URL_ATTRIBUTES.has(name) && /^\s*javascript:/i.test(value);
      if (isHandler || isScriptUrl) blocked.push(tag.length > 120 ? `${tag.slice(0, 117)}...` : tag);
    }
  }
  return { scripts, styles, blocked };
}

function originOf(url: string, variable: string): string {
  try {
    return new URL(url).origin;
  } catch {
    throw new Error(`${variable} must be an absolute URL, got "${url}".`);
  }
}

export interface PolicyInput {
  apiUrl: string;
  dashboardUrl: string;
  /** PUBLIC_SHARDS_URL and PUBLIC_STATS_URL, when the pages use other hosts for them. */
  shardsUrl?: string | undefined;
  statsUrl?: string | undefined;
  scriptHashes: Iterable<string>;
  styleHashes: Iterable<string>;
}

/** Sorted and deduplicated, so the same pages always give the same header. */
function sources(values: Iterable<string>): string {
  return [...new Set(values)].sort().join(" ");
}

export function buildContentSecurityPolicy(input: PolicyInput): string {
  const api = originOf(input.apiUrl, "PUBLIC_API_URL");
  const dashboard = originOf(input.dashboardUrl, "PUBLIC_DASHBOARD_URL");
  const extra = [
    ...(input.shardsUrl ? [originOf(input.shardsUrl, "PUBLIC_SHARDS_URL")] : []),
    ...(input.statsUrl ? [originOf(input.statsUrl, "PUBLIC_STATS_URL")] : []),
  ].filter((origin) => origin !== api);
  return [
    "default-src 'self'",
    // Bundles and island imports are 'self'. Hashes: Astro's inline scripts (island loaders,
    // small page scripts) and React's inline Suspense helpers inside island HTML.
    `script-src 'self' ${sources(input.scriptHashes)}`.trimEnd(),
    `style-src 'self' ${sources(input.styleHashes)}`.trimEnd(),
    // Style attributes: Shiki tokens in docs code and per-element CSS variables (--i, map
    // positions). They cannot run script, and url() in them still obeys img-src and font-src.
    "style-src-attr 'unsafe-inline'",
    // data: for the CSS icons, blob: for the preview of a photo the visitor picks.
    "img-src 'self' data: blob:",
    // Vite inlines the smallest @fontsource subset as a data: URL.
    "font-src 'self' data:",
    // The API serves the packs, culture files, search, reactions and photo calls. The dashboard
    // takes the waitlist sign-up (fetch, or a plain form post without JavaScript). Shards may
    // come from the CDN host and search reports go to the stats host.
    `connect-src 'self' ${[api, dashboard, ...new Set(extra)].join(" ")}`,
    `form-action 'self' ${dashboard}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Adds `header` to the `/*` rule of a `_headers` file. One rule, not a second `/*` rule: local
 * `wrangler dev` keeps only the last rule for a path.
 */
export function addToAllPaths(headersFile: string, header: string): string {
  const lines = headersFile.split("\n");
  const rule = lines.findIndex((line) => line.trim() === "/*");
  if (rule === -1) return `${headersFile.trimEnd()}\n\n/*\n  ${header}\n`.trimStart();
  lines.splice(rule + 1, 0, `  ${header}`);
  return lines.join("\n");
}

async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".html")).map((e) => join(e.parentPath, e.name));
}

/**
 * Adds `Content-Security-Policy` for every path to the built `_headers`. The API and dashboard
 * origins come from PUBLIC_API_URL and PUBLIC_DASHBOARD_URL, the same values the pages use.
 */
export function cspHeaders(): AstroIntegration {
  let env: Record<string, string | undefined> = {};
  return {
    name: "emojisense-csp-headers",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        // Vite's resolved env is what import.meta.env holds in the pages: .env files and the shell.
        updateConfig({
          vite: {
            plugins: [
              {
                name: "emojisense-csp-env",
                configResolved(config) {
                  env = config.env;
                },
              },
            ],
          },
        });
      },
      "astro:build:done": async ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        const scriptHashes = new Set<string>();
        const styleHashes = new Set<string>();
        const problems: string[] = [];
        for (const file of await htmlFiles(outDir)) {
          const found = scanInlineContent(await readFile(file, "utf8"));
          for (const hash of found.scripts) scriptHashes.add(hash);
          for (const hash of found.styles) styleHashes.add(hash);
          for (const tag of found.blocked) problems.push(`${relative(outDir, file)}: ${tag}`);
        }
        if (problems.length > 0) {
          throw new Error(
            "The Content-Security-Policy blocks inline event handlers and javascript: URLs. " +
              `Move this code into a <script>:\n${problems.join("\n")}`,
          );
        }

        const policy = buildContentSecurityPolicy({
          apiUrl: env.PUBLIC_API_URL ?? DEFAULT_API_URL,
          dashboardUrl: env.PUBLIC_DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL,
          shardsUrl: env.PUBLIC_SHARDS_URL,
          statsUrl: env.PUBLIC_STATS_URL,
          scriptHashes,
          styleHashes,
        });
        const header = `Content-Security-Policy: ${policy}`;
        if (header.length > MAX_HEADER_LENGTH) {
          throw new Error(
            `The Content-Security-Policy header has ${header.length} characters; Cloudflare ignores ` +
              `headers over ${MAX_HEADER_LENGTH}. Move inline scripts or styles into files.`,
          );
        }
        const headersPath = join(outDir, "_headers");
        const current = await readFile(headersPath, "utf8").catch(() => "");
        await writeFile(headersPath, addToAllPaths(current, header));
        logger.info(
          `${scriptHashes.size} script and ${styleHashes.size} style hashes, ${header.length} characters`,
        );
      },
    },
  };
}
