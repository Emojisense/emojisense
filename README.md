# Emojisense

Emoji search for pickers, editors, and applications. Search with phrases, slang,
shortcodes, or small spelling errors: "jurassic park" → 🦖, "greatest of all time" → 🐐,
"hallowelen" → 🎃, "kolay gelsin" → 💪.

- **Search on the device.** The engine searches local data packs on each keystroke.
  Search works offline after the packs load. Bundle the packs for use without a first download.
- **Optional search by meaning.** Precomputed answers from static files can answer uncertain
  searches before the API. The API uses Workers AI embeddings and cached results.
  The client combines these results with local matches and keeps confident local matches first.
- **11 languages.** English, Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese,
  Russian, Indonesian, and Turkish. Load the packs for the languages your application needs.
- **Multiple integrations.** Use the core without a framework, React hooks, picker and editor
  adapters, extensions, or the Swift and Kotlin SDKs.

[Documentation](https://emojisense.com/docs/) · [Playground](https://emojisense.com/playground/) ·
[API reference](docs/API.md) · [Integrations](docs/INTEGRATIONS.md)

## Hosted service

| | URL |
| - | --- |
| Search API | [api.emojisense.com](https://api.emojisense.com) (HTTPS only) |
| Dashboard (keys, usage, custom emoji) | [app.emojisense.com](https://app.emojisense.com) |
| Website and docs | [emojisense.com](https://emojisense.com), [docs](https://emojisense.com/docs/) |

Packs and precomputed answers require no key. API search without a key returns alias results
with a stricter rate limit and makes no model calls. Get a publishable key in the dashboard
for semantic search, and configure its allowed origins. Keep secret keys on the server.

## Quickstart (React + Frimousse)

Use React 18 or 19. Install the hook package and the picker:

```bash
npm install @emojisense/react frimousse
```

```tsx
import { useEmojisense } from "@emojisense/react";
import { EmojisensePicker } from "@emojisense/react/frimousse";

export function Picker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const sense = useEmojisense({
    packBaseUrl: "https://api.emojisense.com/v1/pack/0.1.0",
    shardsUrl: "https://api.emojisense.com/p/0.1.0",
    endpoint: "https://api.emojisense.com",
    publishableKey: "pk_live_REPLACE_WITH_YOUR_KEY",
  });

  return <EmojisensePicker emojisense={sense} onEmojiSelect={({ emoji }) => onSelect(emoji)} />;
}
```

Replace the key with your publishable key. For search on the device only, omit `shardsUrl`,
`endpoint`, and `publishableKey`. The picker still downloads its packs and culture files.
See the [React README](packages/react/README.md) for language options, loading behavior, and styling.

## Quickstart (without React)

```bash
npm install emojisense
```

```ts
import { createEngine, loadPacks } from "emojisense";

const packs = await loadPacks({
  baseUrl: "https://api.emojisense.com/v1/pack/0.1.0",
  locales: ["en", "tr"],
});
const engine = createEngine(packs);
const { results } = engine.search("ship it", { locale: "en" });
console.log(results[0]?.emoji); // 🚀
```

`loadPacks` downloads and validates the packs. `engine.search` runs synchronously without a
network request. English always loads because it contains the shortcodes.
See the [core README](packages/core/README.md) for search sessions and optional semantic search.

## Develop

Use Node.js 24 (see [.nvmrc](.nvmrc)) and pnpm 9.12.3 (see [package.json](package.json)).

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm eval:inhouse
```

To run the API locally without a Cloudflare login, build the workspace first. Then prepare
the API assets and apply the local database migrations:

```bash
pnpm --filter @emojisense/worker sync -- --placeholder
pnpm --filter @emojisense/worker db:migrate
pnpm --filter @emojisense/worker dev:offline
```

`--placeholder` permits an empty vector file when embeddings are missing. It keeps existing
vectors when available. Without a local embedding server, offline development returns alias
results with `degraded: true`. See the [Worker README](packages/worker/README.md) for semantic setup.

Start the website in another terminal:

```bash
pnpm --filter @emojisense/web dev
```

Open [localhost:4321](http://localhost:4321) or the [playground](http://localhost:4321/playground/).
Website configuration is in [apps/web/.env.example](apps/web/.env.example).
See the [dashboard README](apps/dashboard/README.md) to run accounts, keys, and the waitlist locally.

| Command | What it does |
| ------- | ------------ |
| `pnpm data:build` | Build packs from Emojibase, CLDR, and curated aliases in `packages/data/dist` |
| `pnpm --filter @emojisense/data embed` | Embed the emoji documents with Workers AI (needs `wrangler login`) |
| `pnpm --filter @emojisense/worker sync` | Copy packs, vectors, and culture files into the Worker. Defaults to EmbeddingGemma, 768 dimensions, from `packages/data/pack.config.json` |
| `pnpm --filter @emojisense/worker dev` | Run the API at `http://localhost:8788` with Workers AI; requires Cloudflare authentication |
| `pnpm eval` | Run the search benchmark; write results to `packages/eval/reports` |
| `pnpm eval:inhouse` | Run the CI search benchmark offline, without the held-out dataset |

## Deploy and CI

| Command | What it does |
| ------- | ------------ |
| `pnpm deploy:dev` / `pnpm deploy:production` | Deploy the API Worker, dashboard and website (`scripts/deploy.sh`), then run the smoke test |
| `pnpm smoke:dev` / `pnpm smoke:production` | Read-only checks of a deployed environment. Exit code 1 on a failed check |
| `pnpm changeset` | Add a release note for a change to a public npm package |
| `pnpm release:check` / `pnpm check:readmes` | Check the npm tarballs / compile the README samples. Publishing: [RELEASING.md](RELEASING.md) |
| `pnpm package:chrome` / `pnpm package:raycast` | Build the Chrome Web Store zip / the Raycast Store project into `release/` |

The smoke test (`scripts/smoke.mjs`) checks the site pages, robots and noindex rules, search
answers with the site key (expected answers: `scripts/smoke.expected.json`), origin and key
refusals, CORS, pack and culture files, and the dashboard. When Playwright can be required (it
is not a dependency; `NODE_PATH` works), it also opens the landing page in headless Chromium.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on pushes to `main` and on pull requests.
It checks formatting, lint, builds, types, tests, the core size budget, the search benchmark,
and the culture ranking rules. A separate job tests Kotlin against reference results from
the TypeScript engine. CI uses no secrets and does not deploy.

## Layout

| Path | Purpose |
| ---- | ------- |
| `packages/core` | `emojisense`: zero-dependency engine, fusion, API client |
| `packages/data` | Data pipeline. `enrichment/*.json` holds the curated aliases. |
| `packages/eval` | Search benchmarks, regression checks, and culture ranking checks |
| `packages/platform` | Shared contracts of the two Workers: D1 schema, plans, keys, webhooks |
| `packages/worker` | Cloudflare Worker: the Search API |
| `packages/react` | `@emojisense/react`: hooks + Frimousse adapter |
| `packages/web-component`, `tiptap`, `lexical`, `ckeditor5`, `tinymce`, `emoji-mart`, `mcp` | Other integrations ([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)) |
| `apps/dashboard` | Dashboard Worker and app: accounts, keys, usage, custom emoji, teams, webhooks |
| `apps/chrome-extension`, `apps/raycast`, `sdks/swift`, `sdks/kotlin` | Chrome and Raycast extensions, Swift and Kotlin SDKs |
| `apps/wordpress-plugin`, `apps/discourse` | WordPress plugin (bbPress, BuddyPress), Discourse theme component |
| `apps/web` | Website, docs and the playground (`/playground/`): search inspector, reactions and photo labs |
| `docs/` | [Architecture](docs/ARCHITECTURE.md), [pack format](docs/PACK_FORMAT.md), [API](docs/API.md), [research](docs/RESEARCH.md) |

## Licenses

Code uses the [MIT license](LICENSE). Emoji data comes from [Emojibase](https://emojibase.dev) (MIT) and
[Unicode CLDR](https://cldr.unicode.org) (Unicode License v3). Emoji render with the system
font or a hosted set (Twemoji, Noto, Fluent; licenses in [NOTICE](NOTICE)).
Include the [data license notices](packages/data/licenses/README.md) when you redistribute packs.
Server models run on Workers AI. Model weights are not included in this repository.
