# @emojisense/worker

The Emojisense Search API: a Cloudflare Worker, deployed at `https://api.emojisense.com`
(production) and `https://api.emojisense.dev` (internal dev). The HTTP contract is
[docs/API.md](../../docs/API.md).

| Route | Runs | Metered as |
| ----- | ---- | ---------- |
| `GET /v1/search` | alias + semantic search (shared + locale vectors), Cache API; `culture=1` (+ `region`) applies the culture layer after the cache (`src/culture.ts`) | `semantic_calls` (cache hits too) |
| `POST /v1/suggest-reactions` | first 256 characters of a message: intent cues, reaction prior from one embedding, clause alias hits (`src/reaction-rank.ts`), no cache | `semantic_calls` |
| `POST /v1/classify-image` | vision label (caption, keywords, proposed emoji) → fused ranking (`src/image-rank.ts`); label cached (with `X-Image-Hash`) by the SHA-256 of the bytes | `image_classifications` (cache hits too) |
| `GET /v1/sets/:set/:hexcode.svg` | hosted emoji image (Twemoji, Noto, Fluent) from a pinned upstream, Cache API; a key on a plan with hosted sets (`src/sets/access.ts`), none for `FIRST_PARTY_ORIGINS` | — |
| `/v1/tenants[/:externalId[/emoji[/:shortcode]]]` | tenants and their custom emoji (Scale, secret key); D1 + R2 `EMOJI`; sends webhooks | — |
| `GET /v1/custom/:appId/:emojiId` | custom emoji image from R2 (`EMOJI`), immutable, Cache API, no key | — |
| `GET /v1/custom-pack` | the key's custom emoji (+ `tenant=`) as a pack, edge-cached 60 s | — |
| `GET /v1/health` | status | — |
| `/v1/pack/<v>/…` | static assets (packs and vector files); the Worker does not run | — |
| `GET /v1/culture/<v>/…` | culture files: the last published build from R2 (`SHARDS`, `culture/` prefix; live entries editors approved) for this deployment, edge-cached, else the deployed files; no key | — |
| `GET /p/<v>/…`, `GET /p/<v>/<locale>/…` | layer 2 shards (English, and per pack locale): the nightly build from R2 (`SHARDS`), edge-cached, else `public/p`; no key | — |

`/v1/search` and `/v1/suggest-reactions` put the caller's custom emoji first (`tenant=` adds a
tenant's). They come from a per-isolate copy of the app's rows, at most 60 s old, and never enter
the shared search cache (`src/custom.ts`).

`classify-image` takes the image as the body (`image/jpeg` or `image/webp`, ≤ 256 KB) and
`?locale=&limit=` in the URL. Answers that degrade (Workers AI unavailable) are not metered.

## Locales

| Rule | Where |
| ---- | ----- |
| `locale` accepts every locale of `@emojisense/data/locales`; BCP 47 tags map to their language (`pt-BR` → `pt`); others → 400 | `src/http.ts` |
| Search and reactions rank with the locale's aliases. `en` (core + ext) is bundled; other locales, `tr` included, read `pack.<locale>.json` and `pack.<locale>.ext.json` through the `ASSETS` binding on first use and build an en core + locale core + ext engine. Images rank English keywords with English aliases | `src/locale-engines.ts`, `src/index.ts` |
| At most 2 such engines per isolate (LRU, `LOCALE_ENGINE_CACHE_SIZE`), ≈ 13–18 MB each | `src/config.ts` |
| A pack that does not load: no alias evidence (search: semantic-only), `aliasLocale: null`, no-store, not in the shared cache; the next request retries | `src/semantic.ts`, `src/search.ts`, `src/reactions.ts` |
| `sync` fails when a locale has no published core pack | `scripts/sync-pack.ts` |

Locally the packs come from `public/v1/pack/` (written by `sync`). Without them, non-bundled
locales answer semantic-only and log `locale_pack_unavailable`. Each cold load logs
`locale_engine_loaded` with `readMs` and `buildMs`.

The metering flush also sends `usage.threshold` webhooks (80% and 100% of an account's limit,
src/usage-alerts.ts). Webhooks to `http://localhost` work only with `ENVIRONMENT=development`
(set in the `offline` env).

## Run locally

```bash
pnpm install
pnpm --filter emojisense build && pnpm --filter @emojisense/platform build
pnpm data:build
pnpm --filter @emojisense/worker sync -- --placeholder   # no vectors yet: alias-only Worker
pnpm --filter @emojisense/worker db:migrate             # wrangler d1 migrations apply DB --local
pnpm --filter @emojisense/worker dev:offline            # http://localhost:8788, no Cloudflare login
```

- `dev:offline` has no Workers AI binding. With `uv run scripts/local_embed_server.py` running
  (repo root; first start downloads EmbeddingGemma's fp32 ONNX, ~1.2 GB), search and reactions
  embed locally (`LOCAL_EMBED_URL`) with the same vectors as Workers AI. Without it, answers are
  alias-only with `degraded: true`. `dev` uses Workers AI and needs `wrangler login`.
- `EMOJISENSE_LOCAL_EMBED=1` runs the data and eval scripts (`embed`, `eval:models`, …) on the
  same local server instead of Workers AI.
- `sync` defaults to the production model, `--model bge-m3 --dims 1024`. Without
  `--placeholder` it needs `vectors.bge-m3.1024.bin` from the embed step. It bundles that shared
  file and publishes the locale files (`vectors.bge-m3.1024.<locale>.bin`) as static assets; the
  Worker reads the query locale's file on first use. When
  `packages/data/dist/shards/<packVersion>/` exists for the same model, it is copied to `public/p/`
  (served only until the first nightly build exists, see "Nightly shard build").
- `sync` also writes `contentHash` to `src/generated/config.json`: a hash of every locale pack,
  the vector files' model, dims and emoji (not their bytes), the model and the built core engine. The search cache key holds it, so run `sync`
  after a data or engine change, even under the same pack version (else the edge cache answers
  with the old results for up to a week).
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

## Hosted emoji sets

`/v1/sets/<set>/<hexcode>.svg` serves one image. The pins (repository and commit) are in
`src/sets/upstreams.ts`. After you move a pin:

```bash
pnpm --filter @emojisense/worker sets            # rebuild src/sets/upstreams.json + reports/sets-coverage.md
pnpm --filter @emojisense/worker sets -- --check # exit 1 when either file is out of date
```

The script lists each repository at the pinned commit and checks every pack emoji and every
single-tone variant. It uses jsDelivr's listing API, and GitHub's tree API for repositories over
jsDelivr's 50 MB listing limit (set `GITHUB_TOKEN` for a higher rate limit). Licenses: `NOTICE`.

## Keys, limits and metering

| Rule | Where |
| ---- | ----- |
| Plain `http://` to a public host with `ENVIRONMENT` `staging` or `production` → 403 (local `wrangler dev` and localhost keep http) | `src/app.ts`, `src/http.ts` |
| Every JSON answer has `X-Content-Type-Options: nosniff` and CORS `*`; errors are `no-store` | `src/http.ts` |
| `?key=pk_live_…` must match the key's allowed origins (empty list = any) → else 403 | `src/auth.ts` |
| `Authorization: Bearer sk_live_…` only; with an `Origin` header or in the URL → 403 | `src/auth.ts` |
| Unknown or revoked key → 401. No key → anonymous: not metered, no custom emoji or analytics | `src/auth.ts`, `src/context.ts` |
| Anonymous callers never call Workers AI: search gets cache hits, else the over-limit answer; reactions rank without the embedding; classify-image and custom-pack → 401 | handlers |
| Rate limits: `SEARCH_LIMITER` 120 requests / 60 s per key and IP, `ANON_LIMITER` 30 / 60 s per IP → 429 with `Retry-After: 60`. Sets, custom images, health and static files are not limited per call. | `src/auth.ts`, `wrangler.jsonc` |
| Key lookups are cached per isolate for 60 s (unknown keys too). A revocation takes ≤ 60 s. | `src/config.ts` |
| Lookups that miss that cache (a D1 read each) are limited per IP (`KEY_MISS_LIMITER`, 60/min) → 429; a stale entry still serves | `src/auth.ts` |
| Publishable-key calls whose `Origin` is in `FIRST_PARTY_ORIGINS` (the website's public key) use `SITE_LIMITER` per IP (60/min) instead of `SEARCH_LIMITER`. The website account is on Pro, whose limits cap its month (`scripts/set-site-plan.mjs`) | `src/auth.ts`, `scripts/site-account.mjs` |
| D1 down: a cached key is still used; an uncached key is served as anonymous (classify-image and custom-pack → 503) | `src/auth.ts` |
| Limits come from the account's plan (`accounts.plan`, `getPlan` in `@emojisense/platform`). Monthly, UTC. | `src/context.ts` |
| Limits are per account: `overLimit` compares the account's total over all of its apps with the limit. `usage_monthly` rows stay per app. | `src/context.ts`, `src/meter.ts` |
| The account total is cached per isolate: read at most once a minute, replaced by the totals each flush reads in its own batch. No limit check costs a D1 query of its own. | `src/meter.ts`, `src/store.ts` |
| Over the limit: `200` with `overLimit: true`; semantic mode returns no results, hybrid returns alias results only | handlers |
| Usage is counted in memory and flushed as one UPSERT batch into `usage_monthly` after 10 s or 100 calls. The UPSERT skips rows of deleted apps (account deletion). | `src/meter.ts`, `src/store.ts` |

Unflushed counts are lost when an isolate is evicted. The error favors the customer and is
accepted for soft limits (DECISIONS.md, Update #2).

## Search analytics (`query_daily`)

| Rule | Where |
| ---- | ----- |
| Each keyed `/v1/search` adds 1 search (and 1 miss when it returned no result) to its app, UTC day, normalized query, locale and country (`request.cf.country`, `XX` when unknown; migration 0004). Cache hits and over-limit answers count. Anonymous calls, dev keys and reactions never do. | `src/context.ts`, `src/search.ts`, `src/region.ts` |
| Counted in memory and flushed like usage (10 s or 100 searches), at most 100 rows per D1 batch. The UPSERT skips rows of deleted apps. | `src/query-stats.ts`, `src/store.ts` |
| Daily cron `17 3 * * *` deletes rows past the account plan's window: Pro 30 days, Scale 365, others 7. Batches of 1,000 rows, ≤ 200 per run. | `src/retention.ts`, `wrangler.jsonc` |

The same cron first writes the regional trends (`trends_daily`, `src/trends.ts`: rising queries
per locale and country over the last 7 days, k-anonymous, for the culture proposals; log
`trends_daily_built`), then deletes waitlist rows 12 months after the first sign-up
(`WAITLIST_KEEP_MONTHS` in `@emojisense/platform`) and `trends_daily` rows after 90 days. Each job
runs and logs on its own; a failure of any marks the run as failed.

Run the cron locally: `pnpm exec wrangler dev --env offline --test-scheduled --persist-to ../../.wrangler/state`,
then `curl "http://localhost:8788/__scheduled?cron=17+3+*+*+*"`.

## Nightly shard build (`CDN`)

| Rule | Where |
| ---- | ----- |
| Cron `23 4 * * *` (after retention). Runs only with `SHARDS_CRON_ENABLED=true` and the `DB`, `CDN` and `AI` bindings; otherwise it logs `shards_skipped`. | `src/scheduled.ts`, `src/shards/job.ts` |
| Candidates: `query_daily` of the last 6 complete UTC days, per locale (rows from before migration 0004 count as `en`); apps of ≥ 3 accounts and ≥ 10 searches in that locale (`SHARD_*` in `@emojisense/platform`); at most 20,000 over every locale, most searched first. `privacyReason` drops emails, URLs, phone/account/postal numbers, ids, long tokens and blocklisted text. | `src/shards/select.ts` |
| Answers: the API's `mode=semantic&locale=<locale>` path (`embedTexts`, `semanticResults`, the locale's vectors), one Workers AI call per 100 queries, at most 5,000 new embeddings per run over every locale, most searched first; entries of this data's last build are reused. Each locale's alias engine drops what its clients answer on the device, and its base layer drops what it holds (`inBase`); a locale whose engine does not load is skipped (`skippedLocales`). | `src/shards/job.ts`, `src/semantic.ts` |
| R2 layout (bucket `emojisense-cdn-*`, public on `cdn.emojisense.*`): `p/<v>/f/<hash>.json` shard files and base indexes named by content (`immutable`, 1 year); `p/<v>/index.json` and `p/<v>/<locale>/index.json` live indexes (1 h), each naming its locale's base index; `state/<v>/<contentHash>.json` pointer (files per locale, current and previous build); `state/<v>/base.json` base manifest (written by `upload:shards` in `@emojisense/data`). Only files the bucket does not have are written. Unnamed files are deleted after a day; pointers of gone deployments and other pack versions after 7 days. | `src/shards/storage.ts` |
| `GET /p/<v>/index.json`, `/p/<v>/<locale>/index.json` (`en/` = English; not a pack locale: 404) and `/p/<v>/f/<hash>.json` on the API host: the same files as the CDN. Live indexes are read once per isolate per 5 minutes and kept 1 h in browsers; content-named files go through the edge cache and are `immutable`. Clients from before hashed files ask for `/p/<v>/<key>.json`: the live index maps the key to its file (1 day in browsers). 404s 5 min. Without a build: `public/p` (never immutable). | `src/shards/route.ts` |

Logs hold counts only (`shards_built`, `shards_empty`, `shards_skipped`, `shards_build_failed`).
Locally the `offline` env has no Workers AI, so the run is skipped; `test/shards-miniflare.test.ts`
runs the whole flow on Miniflare's local R2, D1 and Cache API with a fake model.

## Unsure queries

| Rule | Where |
| ---- | ----- |
| A search answer says how well the tiers understood the query: `confidence` (0–1) and `unsure` (`assessConfidence`: no confident alias coverage and a flat or low semantic list). Semantic mode loads the locale's aliases only when the semantic list is weak. No LLM reads queries (DECISIONS.md, "LLM concept tier removed"). | `search.ts` |

## Culture Phase 2 (`src/culture-admin/`, docs/CULTURE.md)

| Rule | Where |
| ---- | ----- |
| Cron `41 4 * * *`: drafts from `trends_daily` (rising queries) and `culture/sources`, ≤ `CULTURE_PROPOSE_BUDGET` Workers AI calls; validation, dedupe and the culture gate; stored as drafts in D1 `culture_proposals`. Runs with `CULTURE_CRON_ENABLED=true`; then a publish either way. | `propose.ts`, `job.ts` |
| Named RPC entrypoint `CultureAdmin` (no URL): list, preview, edit, approve, reject, retire, publish, export. Only the dashboard's `CULTURE_ADMIN` service binding calls it. | `service.ts`, `src/index.ts` |
| Publish: deployed culture files + approved `culture_entries_live` → R2 `culture/<v>/<build>/…` and `current.json`; the pointer names the deployed `index.json` it was built from. Cron `*/10 * * * *` publishes again after a deploy or an approval. | `publish.ts`, `storage.ts` |
| `GET /v1/culture/<v>/<file>` and `culture=1` read the build named by the pointer (5 min per isolate), else the deployed files. | `route.ts`, `src/culture.ts` |

Logs hold counts and entry ids only (`culture_proposals`, `culture_published`,
`culture_publish_skipped`, `culture_publish_failed`), never query text.

## Analytics Engine (`EVENTS`)

One data point per request that reaches a handler. No IP, key, app or user id.

| Field | Content |
| ----- | ------- |
| `blob1` | normalized query text (≤ 64 chars) for `/v1/search`; empty for reactions and images |
| `blob2` … `blob5` | locale, mode, outcome (`hit` · `hit_over_limit` · `miss` · `degraded` · `over_limit` · `anonymous` = a miss without a key, no model call), endpoint (`search` · `reactions` · `image`) |
| `double1` … `double3` | latency ms, alias confidence, top semantic score (−1 = not available) |
| `index1` | `<packVersion>:<model>@<dims>` |

## Files

| Path | Purpose |
| ---- | ------- |
| `src/index.ts`, `src/scheduled.ts` | Worker entry: bundled packs and vectors, D1 store, the `CultureAdmin` RPC entrypoint; the crons |
| `src/app.ts` | Routing, CORS, per-isolate key cache, meter and search analytics |
| `src/query-stats.ts`, `src/retention.ts` | Search analytics: batched `query_daily` writes, retention cron |
| `src/search.ts`, `src/reactions.ts`, `src/image.ts` | Route handlers |
| `src/custom.ts`, `src/custom-pack.ts`, `src/custom-routes.ts`, `src/custom-store.ts` | Custom emoji: per-isolate cache and search, pack builder, image and pack routes, D1 reader |
| `src/semantic.ts`, `src/vision.ts` | Workers AI calls (embedding, `@cf/google/gemma-4-26b-a4b-it` vision); the vision label parser |
| `src/image-rank.ts`, `src/reaction-rank.ts`, `src/reaction-intents.ts` | Photo and reaction ranking; intent cues |
| `src/fusion.ts`, `src/emoji-lookup.ts` | Weighted reciprocal rank fusion with a confidence floor; emoji text → catalog id |
| `src/locale-engines.ts` | Alias engines of non-bundled locales: packs read through `ASSETS`, per-isolate LRU |
| `src/locale-vectors.ts` | Emoji vectors of each locale's documents (PACK_FORMAT §5): read through `ASSETS`, per-isolate LRU |
| `src/store.ts` | `Store` interface; D1 and in-memory implementations |
| `src/config.ts` | Tunables: models, size limits, cache and flush timings |
| `src/sets/` | Hosted emoji sets: servable emoji, pinned upstreams and naming rules, the key check, the route |
| `src/shards/` | Nightly shard build: selection, R2 store, `/p/*` route |
| `src/sets/upstreams.json` | Generated by `pnpm sets`: overrides, missing emoji, the Fluent file table |
| `scripts/sync-pack.ts` | Copy packs, vectors and shards from `packages/data` |
| `scripts/check-sets.ts` | `pnpm sets`: check the set mapping against the upstream listings, write `reports/sets-coverage.md` |

Tests (`pnpm --filter @emojisense/worker test`) use a fake Workers AI, a fake upstream for the
emoji sets and the in-memory store.
`test/d1-store.test.ts` runs the D1 SQL on the real migrations with `node:sqlite`.
`test/locales.test.ts` ranks with rows copied from the real es, hi and ar core packs
(`test/fixtures/locale-packs.json`).
