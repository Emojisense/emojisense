# @emojisense/worker

The Emojisense Search API: a Cloudflare Worker. The HTTP contract is [docs/API.md](../../docs/API.md).

| Route | Runs | Metered as |
| ----- | ---- | ---------- |
| `GET /v1/search` | alias + semantic search, Cache API | `semantic_calls` (cache hits too) |
| `POST /v1/suggest-reactions` | first 256 characters of a message, alias + semantic, no cache | `semantic_calls` |
| `POST /v1/classify-image` | vision caption + reaction → text search; caption cached by `X-Image-Hash` | `image_classifications` (cache hits too) |
| `GET /v1/health` | status | — |
| `/v1/pack/<v>/…`, `/p/<v>/…` | static assets (packs, layer 2 shards); the Worker does not run | — |

`classify-image` takes the image as the body (`image/jpeg` or `image/webp`, ≤ 256 KB) and
`?locale=&limit=` in the URL. Answers that degrade (Workers AI unavailable) are not metered.

## Run locally

```bash
pnpm install
pnpm --filter emojisense build && pnpm --filter @emojisense/platform build
pnpm data:build
pnpm --filter @emojisense/worker sync -- --placeholder   # no vectors yet: alias-only Worker
pnpm --filter @emojisense/worker db:migrate             # wrangler d1 migrations apply DB --local
pnpm --filter @emojisense/worker dev:offline            # http://localhost:8788, no Cloudflare login
```

- `dev:offline` has no Workers AI binding, so answers are alias-only with `degraded: true`.
  `dev` uses Workers AI and needs `wrangler login`.
- `sync` defaults to the production model, `--model bge-m3 --dims 1024`. Without
  `--placeholder` it needs `vectors.bge-m3.1024.bin` from the embed step. When
  `packages/data/dist/shards/<packVersion>/` exists for the same model, it is copied to `public/p/`.
- Local D1 state is in the repo-root `.wrangler/state` (`--persist-to`), so a local dashboard
  that uses the same directory and binding sees the same keys.

### Keys for local runs

`DEV_KEYS` (wrangler.jsonc) lists keys that need no database row: `key` or `key:plan`,
comma-separated. The offline env accepts `pk_demo` (publishable, free) and `sk_live_local`
(secret, pro). Dev keys allow any origin and are metered in memory only.

To test a real key, add a row to the local database (only the SHA-256 of a key is stored):

```bash
KEY=pk_live_localtest000000000000000000
HASH=$(node -e 'console.log(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' $KEY)
cd packages/worker && npx wrangler d1 execute DB --local --env offline --persist-to ../../.wrangler/state --command "
  INSERT INTO accounts (id, created_at) VALUES ('acc_local', 0);
  INSERT INTO apps (id, account_id, name, plan, created_at) VALUES ('app_local', 'acc_local', 'Local', 'free', 0);
  INSERT INTO api_keys (id, app_id, kind, prefix, hash, allowed_origins, created_at)
    VALUES ('key_local', 'app_local', 'publishable', '${KEY:0:12}', '$HASH', '[\"http://localhost:5173\"]', 0);"
curl -H 'Origin: http://localhost:5173' "http://localhost:8788/v1/search?q=ship%20it&key=$KEY"
```

## Keys, limits and metering

| Rule | Where |
| ---- | ----- |
| `?key=pk_live_…` must match the key's allowed origins (empty list = any) → else 403 | `src/auth.ts` |
| `Authorization: Bearer sk_live_…` only; with an `Origin` header or in the URL → 403 | `src/auth.ts` |
| Unknown or revoked key → 401. No key → anonymous, stricter rate limit per IP | `src/auth.ts` |
| Key lookups are cached per isolate for 60 s (unknown keys too). A revocation takes ≤ 60 s. | `src/config.ts` |
| D1 down: a cached key is still used; an uncached key is served as anonymous | `src/auth.ts` |
| Limits come from `getPlan(app.plan)` in `@emojisense/platform`. Monthly, UTC. | `src/context.ts` |
| Over the limit: `200` with `overLimit: true`; semantic mode returns no results, hybrid returns alias results only | handlers |
| Usage is counted in memory and flushed as one UPSERT batch into `usage_monthly` after 10 s or 100 calls | `src/meter.ts` |

Unflushed counts are lost when an isolate is evicted. The error favors the customer and is
accepted for soft limits (DECISIONS.md, Update #2).

## Analytics Engine (`EVENTS`)

One data point per request that reaches a handler. No IP, key, app or user id.

| Field | Content |
| ----- | ------- |
| `blob1` | normalized query text (≤ 64 chars) for `/v1/search`; empty for reactions and images |
| `blob2` … `blob5` | locale, mode, outcome (`hit` · `miss` · `degraded` · `over_limit`), endpoint (`search` · `reactions` · `image`) |
| `double1` … `double3` | latency ms, alias confidence, top semantic score (−1 = not available) |
| `index1` | `<packVersion>:<model>@<dims>` |

## Files

| Path | Purpose |
| ---- | ------- |
| `src/index.ts` | Worker entry: bundled packs and vectors, D1 store |
| `src/app.ts` | Routing, CORS, per-isolate key cache and meter |
| `src/search.ts`, `src/reactions.ts`, `src/image.ts` | Route handlers |
| `src/semantic.ts`, `src/vision.ts` | Workers AI calls (embedding, `@cf/google/gemma-4-26b-a4b-it` vision) |
| `src/store.ts` | `Store` interface; D1 and in-memory implementations |
| `src/config.ts` | Tunables: models, size limits, cache and flush timings |
| `scripts/sync-pack.ts` | Copy packs, vectors and shards from `packages/data` |

Tests (`pnpm --filter @emojisense/worker test`) use a fake Workers AI and the in-memory store.
`test/d1-store.test.ts` runs the D1 SQL on the real migrations with `node:sqlite`.
