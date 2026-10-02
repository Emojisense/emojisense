/**
 * Zip the built extension (dist/) for the Chrome Web Store:
 *   pnpm --filter @emojisense/chrome-extension package   (builds first)
 *   → <repo>/release/chrome/emojisense-chrome-<version>.zip
 *
 * Before it writes the zip, it checks what the store review looks at: the permissions are exactly
 * the four in src/manifest.ts, there are no host permissions and no content scripts on every page,
 * the extension pages allow no remote or eval'd code, and no source maps ship. It never uploads.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ICON_SIZES, PERMISSIONS } from "../src/manifest.ts";
import { createZip } from "./zip.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const RELEASE = join(ROOT, "../../release/chrome");
/** Chrome Web Store limits for the manifest text. */
const MAX_NAME = 75;
const MAX_DESCRIPTION = 132;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const problems: string[] = [];
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8")) as chrome.runtime.ManifestV3;

if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
if (manifest.version !== version)
  problems.push(`manifest version ${manifest.version} ≠ package.json ${version}`);
if (manifest.name.length > MAX_NAME) problems.push(`name is longer than ${MAX_NAME} characters`);
if ((manifest.description ?? "").length > MAX_DESCRIPTION) {
  problems.push(`description is longer than ${MAX_DESCRIPTION} characters`);
}
if (JSON.stringify(manifest.permissions) !== JSON.stringify(PERMISSIONS)) {
  problems.push(`permissions ${JSON.stringify(manifest.permissions)} ≠ ${JSON.stringify(PERMISSIONS)}`);
}
for (const key of [
  "host_permissions",
  "optional_permissions",
  "optional_host_permissions",
  "content_scripts",
  "web_accessible_resources",
  "externally_connectable",
] as const) {
  if (key in manifest) problems.push(`manifest has ${key}`);
}
const csp = manifest.content_security_policy?.extension_pages ?? "";
if (/unsafe-eval|https?:|wasm-unsafe-eval/.test(csp))
  problems.push(`extension_pages CSP allows remote or eval'd code: ${csp}`);
for (const size of ICON_SIZES) {
  const icon = manifest.icons?.[size];
  if (!icon || !statSync(join(DIST, icon), { throwIfNoEntry: false }))
    problems.push(`icon ${size} is missing`);
}

const paths = files(DIST);
for (const path of paths) {
  const name = relative(DIST, path);
  if (name.endsWith(".map")) problems.push(`${name}: source map`);
  if (name.endsWith(".js")) {
    const code = readFileSync(path, "utf8");
    if (code.includes("sourceMappingURL")) problems.push(`${name}: sourceMappingURL comment`);
    if (/\bimportScripts\s*\(|import\(\s*["'`]https?:/.test(code))
      problems.push(`${name}: loads remote code`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`✘ ${problem}`);
  process.exit(1);
}

const zip = createZip(
  paths.map((path) => ({ path: relative(DIST, path).split("\\").join("/"), data: readFileSync(path) })),
);
mkdirSync(RELEASE, { recursive: true });
const target = join(RELEASE, `emojisense-chrome-${version}.zip`);
writeFileSync(target, zip);
const sha256 = createHash("sha256").update(zip).digest("hex");
console.log(`✔ manifest: MV3, permissions ${PERMISSIONS.join(", ")}; no host permissions, no remote code`);
console.log(
  `✔ ${relative(join(ROOT, "../.."), target)}: ${paths.length} files, ${(zip.length / 1024).toFixed(1)} KB`,
);
console.log(`  sha256 ${sha256}`);
