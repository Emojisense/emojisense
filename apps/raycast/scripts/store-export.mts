/**
 * Export this extension as the standalone npm project that the Raycast Store builds:
 *   pnpm package:raycast                      → <repo>/release/raycast/emojisense/
 *   RAYCAST_AUTHOR=<handle> pnpm package:raycast   sets "author" to your Raycast username
 *
 * The Store builds each extension on its own with npm, so the export has no workspace links:
 * `emojisense` comes from npm at the version of packages/core, and the packs are committed files
 * in assets/packs (run after bundle-packs). The export adds what the Store review expects: the
 * Raycast ESLint and Prettier configs, the standard scripts and a CHANGELOG.md. Tests and build
 * scripts stay in the monorepo. Then, in the export: `npm install`, `npm run build`,
 * `npm run lint`, `npm run publish` (RELEASING.md). It never publishes anything itself.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The Store's extension name (its URL slug). The monorepo name avoids the `emojisense` package. */
const STORE_NAME = "emojisense";
/** Lint tooling of the export, each version at least 7 days old when chosen (DECISIONS.md). */
const DEV_DEPENDENCIES = {
  "@raycast/eslint-config": "2.2.0",
  "@types/node": "22.19.17",
  "@types/react": "19.0.10",
  eslint: "10.11.0",
  prettier: "3.9.9",
  typescript: "5.9.3",
};

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(ROOT, "../..");
const OUT = join(REPO, "release/raycast", STORE_NAME);

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, unknown> & {
  dependencies: Record<string, string>;
};
const core = JSON.parse(readFileSync(join(REPO, "packages/core/package.json"), "utf8")) as {
  version: string;
};
if (!existsSync(join(ROOT, "assets/packs/index.json"))) {
  throw new Error("assets/packs is empty. Run scripts/bundle-packs.mts first (pnpm package:raycast does).");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, "src"), join(OUT, "src"), { recursive: true });
cpSync(join(ROOT, "assets"), join(OUT, "assets"), { recursive: true });
cpSync(join(REPO, "LICENSE"), join(OUT, "LICENSE"));

const { private: _private, scripts: _scripts, devDependencies: _dev, ...fields } = manifest;
const storeManifest = {
  ...fields,
  name: STORE_NAME,
  author: process.env.RAYCAST_AUTHOR || manifest.author,
  dependencies: { ...manifest.dependencies, emojisense: `^${core.version}` },
  devDependencies: DEV_DEPENDENCIES,
  scripts: {
    build: "ray build",
    dev: "ray develop",
    "fix-lint": "ray lint --fix",
    lint: "ray lint",
    prepublishOnly: 'echo "Publish to the Raycast Store with npm run publish, not to npm." && exit 1',
    publish: "npx @raycast/api@latest publish",
  },
};
const write = (file: string, text: string) => writeFileSync(join(OUT, file), text);
write("package.json", `${JSON.stringify(storeManifest, null, 2)}\n`);

write(
  "tsconfig.json",
  `${JSON.stringify(
    {
      $schema: "https://json.schemastore.org/tsconfig",
      include: ["src/**/*", "raycast-env.d.ts"],
      compilerOptions: {
        lib: ["ES2023"],
        target: "ES2023",
        module: "Preserve",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        noUncheckedIndexedAccess: true,
        isolatedModules: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        noEmit: true,
      },
    },
    null,
    2,
  )}\n`,
);
write(
  "eslint.config.js",
  `const { defineConfig } = require("eslint/config");
const raycastConfig = require("@raycast/eslint-config");

module.exports = defineConfig([...raycastConfig]);
`,
);
// Prettier settings that match the monorepo's Biome formatting.
write(
  ".prettierrc",
  `${JSON.stringify({ printWidth: 110, singleQuote: false, trailingComma: "all" }, null, 2)}\n`,
);
write(".gitignore", "node_modules/\ndist/\nraycast-env.d.ts\n");
write("CHANGELOG.md", "# Emojisense Changelog\n\n## [Initial Version] - {PR_MERGE_DATE}\n");
write("README.md", storeReadme());

if (core.version === "0.0.0") {
  console.warn(
    "! packages/core is still 0.0.0: run `pnpm release:version` and publish emojisense before `npm install`.",
  );
}
if (!process.env.RAYCAST_AUTHOR) {
  console.warn(`! author is "${String(manifest.author)}": set RAYCAST_AUTHOR to your Raycast username.`);
}
console.log(
  `✔ ${relative(REPO, OUT)}: emojisense ^${core.version}, @raycast/api ${manifest.dependencies["@raycast/api"]}`,
);

/** The Store page README: what the extension does, its preferences and its data use. */
function storeReadme(): string {
  return `# Emojisense

Search emoji by meaning, slang and intent. Type what you mean ("ship it", "lgtm", "greatest of all
time", "kolay gelsin") and get ranked emoji. Each row shows why it matched: the alias phrase, the
shortcode, or "similar meaning" for a semantic result.

Search runs on your Mac or PC with the open-source [Emojisense](https://emojisense.com) engine and
the data packs of 11 languages inside the extension. It needs no network and no account.

| Key | Action |
| --- | ------ |
| \`↵\` | Paste the emoji into the active app (or copy, see preferences) |
| \`⌘ ↵\` | Copy the emoji (or paste) |
| \`⌘ ⇧ C\` | Copy the Emojibase hexcode, e.g. \`1F680\` |

## Preferences

| Preference | Default | Meaning |
| ---------- | ------- | ------- |
| Language | English | Labels and ranking. Every bundled language is always searched. |
| Primary Action | Paste | What \`↵\` does. |
| API URL | empty | Optional. With a URL, unsure queries also get semantic results from the Emojisense API. |
| API Key | empty | Optional. A key from the [Emojisense dashboard](https://app.emojisense.com). |

## Privacy

Without an API URL, nothing leaves your computer. With an API URL, the extension sends the search
text of unsure queries to that address. The Emojisense API keeps the normalized query (at most 64
characters) without your IP address or key: see the [privacy policy](https://emojisense.com/legal/privacy/).

Emoji data: Emojibase (MIT) and Unicode CLDR (Unicode License v3), notices in \`assets/packs/licenses\`.
`;
}
