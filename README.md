# Emojisense

The search brain any emoji picker plugs into. Type "jurassic park" → 🦖, "lgtm" → ✅,
"greatest of all time" → 🐐, "hallowelen" → 🎃, "kolay gelsin" → 💪.

- **On device first.** A ≈5 KB engine and an alias pack answer each keystroke in well under a
  frame. It works offline.
- **The edge only when unsure.** Conceptual queries go to a Cloudflare Worker with Workers AI
  embeddings, brute-force over about 1.9k vectors, and caching per data center.
- **Picker-agnostic.** Framework-free core, React hooks, a Frimousse adapter, and a documented
  pack format for Swift and Kotlin.

## Hosted service

| | URL |
| - | --- |
| Search API | `https://api.emojisense.com` (HTTPS only; plain `http` gets `403`) |
| Dashboard (keys, usage, custom emoji) | `https://app.emojisense.com` |
| Website and docs | `https://emojisense.com`, `https://emojisense.com/docs/` |

The API reference is [docs/API.md](docs/API.md). Without a key the API works with a stricter
rate limit; get a publishable key in the dashboard for your own origins.

## Quickstart (React + Frimousse)

```tsx
const sense = useEmojisense({
  packBaseUrl: "https://api.emojisense.com/v1/pack/0.1.0",
  endpoint: "https://api.emojisense.com",
  publishableKey: "pk_live_…",
});

<EmojisensePicker emojisense={sense} onEmojiSelect={({ emoji }) => insert(emoji)} />
```

Without React:

```ts
import { createEngine, loadPacks } from "emojisense";
const engine = createEngine(await loadPacks({ baseUrl: "https://api.emojisense.com/v1/pack/0.1.0" }));
engine.search("ship it").results; // [{ emoji: "🚀", id: "1F680", score: …, source: "alias" }, …]
```

## Develop

```bash
pnpm install
pnpm data:build          # Emojibase + CLDR + aliases → pack (packages/data/dist)
pnpm test && pnpm eval   # unit tests, then the search benchmark (packages/eval/reports)
```

| Command | What it does |
| ------- | ------------ |
| `pnpm --filter @emojisense/data embed` | Embed the emoji documents with Workers AI (needs `wrangler login`) |
| `pnpm --filter @emojisense/worker sync` | Copy the packs, the production vectors (`bge-m3`, 1024 dims) and the culture files into the Worker |
| `pnpm --filter @emojisense/worker dev` | API on http://localhost:8788 (alias-only if Workers AI is unreachable) |
| `pnpm --filter @emojisense/web dev` | Website, docs and playground on http://localhost:4321 (playground: `/playground/`) |
| `pnpm eval:inhouse` | The CI eval gate: in-house suite, offline, no held-out run |

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

CI (`.github/workflows/ci.yml`) runs on pushes to `main` and on pull requests: `biome check .`,
the build, `turbo run typecheck test`, the core size budget, `pnpm eval:inhouse` and the culture
gate. CI has no secrets and never deploys.

## Layout

| Path | Purpose |
| ---- | ------- |
| `packages/core` | `emojisense`: zero-dependency engine, fusion, API client |
| `packages/data` | Data pipeline. `enrichment/*.json` holds the curated aliases. |
| `packages/eval` | 217 labelled queries, benchmark runner, CI regression gate |
| `packages/platform` | Shared contracts of the two Workers: D1 schema, plans, keys, webhooks |
| `packages/worker` | Cloudflare Worker: the Search API |
| `packages/react` | `@emojisense/react`: hooks + Frimousse adapter |
| `packages/web-component`, `tiptap`, `lexical`, `emoji-mart`, `mcp` | Other integrations ([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)) |
| `apps/dashboard` | Dashboard Worker and app: accounts, keys, usage, custom emoji, teams, webhooks |
| `apps/chrome-extension`, `apps/raycast`, `sdks/swift` | Chrome and Raycast extensions, Swift SDK |
| `apps/web` | Website, docs and the playground (`/playground/`): search inspector, reactions and photo labs |
| `docs/` | [Architecture](docs/ARCHITECTURE.md), [pack format](docs/PACK_FORMAT.md), [API](docs/API.md), [research](docs/RESEARCH.md) |

## Licenses

Code is MIT. Emoji data comes from [Emojibase](https://emojibase.dev) (MIT) and
[Unicode CLDR](https://cldr.unicode.org) (Unicode License v3). Emoji render with the system
font, or with a hosted set (Twemoji, Noto, Fluent; licenses in [NOTICE](NOTICE)). Server models
run on Workers AI, and no model weights ship in this repository.
