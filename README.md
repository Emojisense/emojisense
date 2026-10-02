# Emojisense

The search brain any emoji picker plugs into. Type "jurassic park" → 🦖, "lgtm" → ✅,
"greatest of all time" → 🐐, "hallowelen" → 🎃, "kolay gelsin" → 💪.

- **On device first.** A ≈5 KB engine and an alias pack answer each keystroke in well under a
  frame. It works offline.
- **The edge only when unsure.** Conceptual queries go to a Cloudflare Worker with Workers AI
  embeddings, brute-force over about 1.9k vectors, and caching per data center.
- **Picker-agnostic.** Framework-free core, React hooks, a Frimousse adapter, and a documented
  pack format for Swift and Kotlin.

## Quickstart (React + Frimousse)

```tsx
const sense = useEmojisense({ packBaseUrl: "https://<api>/v1/pack/0.1.0", endpoint: "https://<api>" });

<EmojisensePicker emojisense={sense} onEmojiSelect={({ emoji }) => insert(emoji)} />
```

Without React:

```ts
import { createEngine, loadPacks } from "emojisense";
const engine = createEngine(await loadPacks({ baseUrl: "https://<api>/v1/pack/0.1.0" }));
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
| `pnpm --filter @emojisense/worker sync -- --model embeddinggemma --dims 256` | Copy the pack and production vectors into the Worker |
| `pnpm --filter @emojisense/worker dev` | API on http://localhost:8787 (alias-only if Workers AI is unreachable) |
| `pnpm --filter @emojisense/demo dev` | Demo on http://localhost:5173 |

## Layout

| Path | Purpose |
| ---- | ------- |
| `packages/core` | `emojisense`: zero-dependency engine, fusion, API client |
| `packages/data` | Data pipeline. `enrichment/*.json` holds the curated aliases. |
| `packages/eval` | 217 labelled queries, benchmark runner, CI regression gate |
| `packages/worker` | Cloudflare Worker API |
| `packages/react` | `@emojisense/react`: hooks + Frimousse adapter |
| `apps/demo` | Side-by-side demo with latency and cost counters |
| `docs/` | [Architecture](docs/ARCHITECTURE.md), [pack format](docs/PACK_FORMAT.md), [API](docs/API.md), [research](docs/RESEARCH.md) |

## Licenses

Code is MIT. Emoji data comes from [Emojibase](https://emojibase.dev) (MIT) and
[Unicode CLDR](https://cldr.unicode.org) (Unicode License v3). Emoji render with the system
font. Server models run on Workers AI, and no model weights ship in this repository.
