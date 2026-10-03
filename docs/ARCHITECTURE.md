# Emojisense architecture

Emojisense is the search brain that any emoji picker plugs into. The design rule: **most
requests never cause a billed server call.** Each layer answers what it can, and passes only the
rest to the next layer. (Revised 2026-10-02 by Update #2; see DECISIONS.md.)

The hosted service is live: the Search API at `https://api.emojisense.com` (HTTPS only), the
dashboard at `https://app.emojisense.com` and the website and docs at `https://emojisense.com`.
The internal dev environment is the same three hosts on `emojisense.dev`.

## Layers

```
keystroke
   │
   ▼
L0  alias dictionary ─── on device, $0, < 16 ms ────────────── confident? ──▶ results
   │ unsure (low confidence, or a multi-word / conceptual query)
   ▼
L1  on-device semantic model ─── DEFERRED (SemanticProvider slot + Cross-Origin Storage hook)
   │
   ▼
L2  precomputed results: live (nightly) and base (synthetic) shards on the CDN, content-named files
   │  loaded shard? ──▶ fuse ▶ results at once, no debounce, no request
   │  shard not loaded yet: it loads during the debounce (prefetch on the first unsure keystroke)
   │ miss (debounced 150–250 ms)
   ▼
L3  Worker GET /v1/search ─▶ Cache API ─▶ embed query with Workers AI (EmbeddingGemma, 768 dims)
                                         ─▶ dot product over ≈1.9k emoji vectors, English + the query locale (3–6 ms) ─▶ fuse ▶ results
   │ key over its monthly limit
   └──▶ { overLimit: true } ─▶ client stays on L0 + L2 silently (never a hard failure)
```

| Layer | Where | Cost | Latency | State |
| ----- | ----- | ---- | ------- | ----- |
| L0 alias dictionary (prefix index, IDF, fuzzy) | device | $0 | p95 0.4 ms per keystroke | built |
| L1 on-device semantic | device | — | — | deferred: no small multilingual off-the-shelf model fits unchanged |
| L2 precomputed prefix shards (live + base layer) | CDN → R2 (no Worker); also `/p/*` on the API host | not metered; $0 per CDN hit | one CDN round trip per shard, then local (between keystrokes) | built; base layer with the pack, live layer nightly |
| L3 Worker + Cache API + Workers AI embedding | edge | ≈ $3.7 per 1M calls with bookkeeping (docs/PRICING.md) | EmbeddingGemma embed p50 118–134 ms, p95 335–473 ms in the Worker (DECISIONS.md) | live, with keys, plans and metering |

**Fusion.** The client merges L0 with L2 or L3 results with a learned reranker: confident L0 hits
(≥ 0.9) stay pinned, so the list does not jump when semantic results arrive, and so does the
dictionary's answer to number slang (zh "666" → 👍, not 6️⃣); every other result
of both lists is ordered by a linear score over the L0 score, rank and confidence, and the
semantic score, its gap and confidence (`packages/core/src/rerank.ts`,
PACK_FORMAT §10; Swift and Kotlin carry the same weights). Semantic country flags that L0 does not
also hold rank last. The earlier reciprocal rank fusion stays available (`rerank: false`).

**Model output and ranking policy.** L3 computes the model output of a query: per candidate, its
text cosine and its glyph cosine (the query's centred cosine to the embedded emoji itself,
`vectors.<model>.<dims>.glyph.bin`, bundled in the Worker, ≈ 5 MB in memory). L2 shards store
that output as it is. The ranking policy (text + 0.25 × glyph, `packages/core/src/semantic-policy.ts`,
PACK_FORMAT §5) runs on every read: in the Worker for API answers, in the client for shards. So
a policy change needs no new embedding and no shard rebuild. No usage prior is part of the
meaning search: the English core pack's popularity percentile (Emoji-SP, CC BY 4.0) only breaks
equal L0 scores. The vector code is a server-side entry, `emojisense/vectors`, outside the picker
bundle.

**Layer coupling.** L2 takes the most frequent queries, so the queries that still reach L3 are
the long tail. The L3 Cache API hit rate is therefore low. Cost estimates model the layers
together (`pnpm cost`), never with one global hit rate.

## Unsure queries

Names and pop culture are the queries no layer above understands: the dictionary has at most a
part of one word, the semantic list is flat ("kendrick lamar" → 🦁 🤦 🧙‍♂️ at cosines
0.38–0.40). The client and the API judge every answer the same way (`assessConfidence`) and show
an unsure answer as guesses. No language model reads queries: the LLM concept tier (L4) was
removed on 2026-10-02 by owner decision (DECISIONS.md).

```
query ─▶ L0 alias (guards: no foreign prefix, no short typo of another word, no one-word
   │       match for a query of unknown words) ─▶ coverage, confidence
   ▼
L2 / L3 semantic list ─▶ semanticStrength (calibrated best cosine, halved when flat)
   ▼
assessConfidence: covered (coverage ≥ 0.85, top ≥ 0.6)? or strength ≥ 0.6? ──yes──▶ results
   │ unsure
   └──▶ client: show the results as guesses ("No strong match — try another word")
```

| Part | Where | Cost | Latency |
| ---- | ----- | ---- | ------- |
| Guards, coverage, unsure verdict | core (TS), Swift, Kotlin, API Worker | $0 | in the keystroke budget |

## Build and learning loop

```
emojibase (en) + CLDR (tr) ─▶ ingest ─▶ enrichment (aliases, descriptions) ─▶ validate
        ─▶ packs: pack.<locale>.json (core ≤ 200 KB gz) + pack.<locale>.ext.json (idle-loaded)
        ─▶ embed (chosen model × dims) ─▶ vectors.<model>.<dims>[.<locale>].bin ─▶ manifest.json
        ─▶ embed:glyph (bare glyphs) ─▶ vectors.<model>.<dims>.glyph.bin; Emoji-SP ─▶ pack.en.json popularity

query_daily (keyed calls: per app, day, normalized text, locale, country; no IP/key/user)
        ─▶ nightly in the API Worker: apps of ≥ 3 accounts, ≥ 10 searches in 6 days, no PII
              └─▶ precompute results per locale → prefix shards (L2)         [built]
        ─▶ nightly: rising queries per locale and country (≥ 3 accounts, ≥ 10 searches)
              └─▶ trends_daily → culture proposals                           [built, private]
Worker query log (Analytics Engine: normalized text only, no IP/key/user/app)
        ─▶ queries seen ≥ 5 times
              └─▶ weak ones → LLM proposes aliases → eval gate → new pack   [closed, hosted only]
```

## Culture layer

Emoji meaning depends on culture, region and moment: 💀 means "dying of laughter", "goat" comes
with ⚽ 🇦🇷 🇵🇹 in football chat, 🪔 matters at Diwali. The culture layer maps these associations
and adds them to search. Phase 1 is editorial: AI proposes, a person approves. Phase 2
([CULTURE.md](CULTURE.md)) drafts every night from aggregate rising searches and the holiday
calendar, and an editor still approves every entry, in the dashboard; nothing learns on its own.

```
culture/sources/*.json (holiday calendar, 2026–2027 events, slang notes) + analytics misses (seen ≥ 5)
   │
   ▼ culture:propose ── Workers AI, prompt culture/prompts/propose.v<N>.md ──▶ entries/<id>.json  status "draft"
   ▼ culture:review  ── preview per trigger: canonical vs with the entry ──▶ status "approved"  (git = audit trail)
   ▼ culture:check   ── schema, catalog hexcodes, windows, neutral context, exclusions.txt
   ▼ culture:build --date d ──▶ dist/culture/<packVersion>/culture.<locale>.json
   │                             lasting entries + seasonal/event entries active in [d, d+366], exact windows
   ▼ Worker sync at deploy (culture:build from yesterday, UTC) ──▶ /v1/culture/<packVersion>/… static assets, max-age=3600
   │                             no daily rebuild: clients check the windows by their own day
   ▼ SDK: the loader loads it next to the packs → engine.withCulture(culture) → session applies it after fusion
   ▼ API: /v1/search and /v1/suggest-reactions (on unless culture=0) → same file, applied after the shared cache
```

| Rule | Where |
| ---- | ----- |
| **Add, never replace.** Culture emoji go right after the canonical top result. They are above it only when the canonical list is empty. | `insertCulture` in `packages/core/src/culture.ts` |
| Applied last, after the semantic results are fused in, so a semantic answer cannot lift a culture emoji over the top result. | `packages/core/src/session.ts` |
| Results carry `source: "culture"`, `context` (the reason, localized) and `cultureId`. At most 5 per query. | `matchCulture` |
| A trigger matches the whole normalized query, or a prefix being typed (≥ 3 characters and ≥ half the trigger). In a message (reactions), a trigger matches as whole words anywhere in it. | `matchCulture`, `matchCultureInText` |
| Windows are local calendar days, checked at query time against a 12-month file. Yearly windows may wrap the year end. Lunar-calendar festivals get one dated entry per year. | `isActiveOn`, `CultureScope.day` |
| On by default: the loader loads the culture file next to the packs. Without a region, only entries for every region (`"*"`) apply. Every SDK surface defaults to the device's region: the region of its language, else of its time zone (the file's `zones`), read on the device and never sent. `""` = none. | `resolveRegion`, `deviceRegion` |
| `culture: false` (`cultureUrl: false`, `culture-url="off"`) keeps the canonical ranking (tests, benchmarks). Without a culture file nothing changes. | engine, session, loader, React, web component, editors |
| A "relevant now" shelf (featured seasonal and event emoji) is off by default. | `relevantNow`, `showRelevantNow` |
| CI gate: with every approved entry active, no top-1 answer of the eval suites changes, and each trigger brings its entry's strongest emoji into the top 3. | `packages/eval/src/culture-gate.ts` |
| **Regional senses** (`kind: "regional"`, e.g. "football" → ⚽ outside North America) are the one exception to "never above": the app names a region in scope, the query equals a trigger, and the canonical top is one the entry `outranks`. The canonical answer moves to second place. The gate checks the lead in scope, no change out of scope, and no other in-house query changing its top answer with the region. | `matchRegionalLead`, `culture-gate.ts` |
| The search and reactions API apply culture unless `culture=0` (the SDK client sends it: it applies culture on the device). The day is `day=`, else the caller's local day (`request.cf.timezone`), else UTC. Culture is never stored in the shared cache. | `packages/worker/src/culture.ts` |

The culture file is optional and small (≤ 2.7 KB gz per locale for 12 months today). A failed load leaves
search unchanged, and the engine index is shared, not rebuilt, when the file arrives.

### Culture Phase 2: nightly drafts, approval in the dashboard, publish without a deploy

```
trends_daily (03:17) + culture/sources ─▶ API Worker cron 04:41: Workers AI drafts (≤ budget)
   ─▶ validateRecord + culture gate (shared with culture:check / culture:gate) ─▶ D1 culture_proposals (draft)
dashboard Internal → Culture (ADMIN_EMAILS) ─service binding (RPC CultureAdmin)─▶ API Worker
   preview per trigger / locale / region · edit · approve / reject ─▶ D1 culture_entries_live
publish (Publish now · nightly · every 10 min after a change): deployed files + live entries
   ─▶ R2 SHARDS culture/<v>/<build>/… + current.json ─▶ GET /v1/culture/<v>/* and search/reactions
   (no build for this deployment ─▶ the deployed files from ASSETS)
export ─▶ culture:import-live ─▶ culture/entries/<id>.json (git stays the long-term record)
```

Details, checks and costs: [CULTURE.md](CULTURE.md). Code: `packages/worker/src/culture-admin/`,
`@emojisense/data/culture-core` (the culture logic without file access), the dashboard's
`src/worker/routes/culture.ts` and `src/app/pages/CulturePage.tsx`.

## Packages

| Package | Role | License |
| ------- | ---- | ------- |
| `packages/core` (`emojisense`) | Zero-dependency engine: normalizer, L0 index, fusion, culture layer, `SemanticProvider`s, layer-aware client | MIT |
| `packages/data` | Pipeline: ingest → enrichment → curation → validation → embeddings → packs → shards; culture entries and files | MIT |
| `packages/eval` | Labelled queries, benchmark, `pnpm cost`, CI gate, culture gate | MIT |
| `packages/platform` | Shared contracts of both Workers: D1 schema and migrations, plans, keys, webhooks | MIT |
| `packages/worker` | Search API Worker: search, reactions, photo to emoji, custom emoji, tenants, hosted sets, packs, vectors and culture files as assets, nightly shard build into the CDN bucket and `/p/*` from it, plans, metering | MIT |
| `apps/dashboard` | Dashboard Worker + SPA: accounts, apps, keys, usage, analytics, custom emoji, teams, webhooks, waitlist | MIT |
| `packages/react` (`@emojisense/react`) | Hooks, Frimousse adapter, shadcn registry item | MIT |
| `packages/web-component`, `tiptap`, `lexical`, `ckeditor5`, `tinymce`, `emoji-mart`, `mcp` | Picker element and textarea autocomplete, editor autocompletes (on `emojisense/autocomplete`), emoji-mart adapter, MCP server | MIT |
| `apps/chrome-extension`, `apps/raycast`, `sdks/swift`, `sdks/kotlin` | Chrome extension, Raycast extension, Swift and Kotlin ports of the engine | MIT |
| `apps/wordpress-plugin`, `apps/discourse` | WordPress plugin (with bbPress and BuddyPress), Discourse theme component | GPL-2.0+ (WordPress), MIT |
| `apps/web` | Website, docs and `/playground/`: per-layer timings, cache state, copy-as-code, reactions and photo labs | MIT |
| private repo `emojisense-cloud` | Miss mining, daily alias updates, billing | closed |

## Invariants

1. Queries and emoji documents are embedded by the same model at the same dimensionality. The
   manifest pins model ID and dims. The Worker refuses a mismatch.
2. The client never blocks first render on a model or network call. L0 alone is a good
   experience, including offline.
3. Over a plan limit, search degrades to L0 + L2. It never fails.
4. No PII: no user IDs, IPs or keys in logs; the IP is only an in-memory rate-limit key. Query
   text is normalized, capped at 64 characters and used only when seen ≥ 5 times; public shards
   also need apps of ≥ 3 accounts and ≥ 10 searches, and no personal-looking text. Message text
   for reaction suggestions and images for classification are never stored.
5. Skin-tone variants map to their base emoji. The picker applies the user's tone.
6. Community custom emoji sets are used only for local evaluation, never shipped.
7. No servers to manage: no containers, no load balancers, no vector DB.

## Dashboard sign-in

The dashboard (`apps/dashboard`) signs people in with Clerk. The Worker needs only public values
and makes no network call to check a request. (Added 2026-10-02; see DECISIONS.md.)

```
browser ──▶ Clerk Frontend API (clerk.emojisense.com): sign-in, session, token refresh
   │
   └─▶ /api/*  Authorization: Bearer <session token, 60 s>
         │
         ▼
   dashboard Worker ── verifyJwt(CLERK_JWT_KEY) + azp + iss + session status
         │             email, email_verified, name from custom claims
         ▼
   D1 accounts (clerk_user_id) ── the first request of a Clerk user creates the account
```

| Value | Kind | Where |
| ----- | ---- | ----- |
| `VITE_CLERK_PUBLISHABLE_KEY` | public, build time | SPA (ClerkProvider) and the `_headers` CSP |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES` | public Worker vars | token checks |
| `CLERK_SECRET_KEY` | optional secret | only server-side deletion of the Clerk user |

## Search API request path

How one `GET /v1/search` moves through the Worker (`packages/worker/src`; contract: docs/API.md):

```
request ─▶ plain http on a public host? ──yes──▶ 403 (app.ts, http.ts)
   │ https
   ▼
authenticate: key → app + plan, or anonymous ─▶ rate limit (120/min key+IP, 30/min anonymous IP) ─▶ 429
   │                                            (auth.ts; D1 down + key not cached → anonymous)
   ▼
parse q (embeddingText), locale (11 + BCP 47 → else 400), limit, mode, culture, region
   (region=auto → request.cf.country; the country is never part of the cache key)
   ▼
over the account's limit? ─▶ the account's cache may still answer; else alias-only, overLimit: true
   ▼
Cache API (key: account, text, locale, limit, mode, index tag, content hash; no key/app/origin;
   │       anonymous: no cache)
   │ miss
   ▼
alias engine of the locale (en bundled; others, tr included: core+ext packs via ASSETS, LRU 2)
   + embed (Workers AI) ─▶ searchVectorSets(shared index, locale index via ASSETS, LRU 2)
   ▼ fuse ─▶ assessConfidence (confidence, unsure)
   ▼ store in the account's cache (only when nothing degraded or failed to load)
   ▼
per request, never cached: culture (unless culture=0; day, region) ─▶ custom emoji first (key's app, tenant)
   ▼
metering (semantic_calls, batched to D1) + query_daily (keyed calls; + locale, country)
   + Analytics Engine point
```

### Regional data flow

The country of a request is known only at the edge: Cloudflare sets `request.cf.country` (ISO
3166-1 alpha-2, from the IP address). The Worker reads it once per search (`region.ts`), maps
unknown values (`XX`, Tor `T1`, local runs) to `XX`, and uses it in two places only:

```
request.cf.country ──▶ region=auto: regional culture entries of this one answer (after the cache)
                   └─▶ query_daily(app, day, query, locale, country): +1 search   (keyed calls only)
                         ├─▶ dashboard: the app's own counts by country and language
                         ├─▶ 04:23 shards: k-anonymous per locale ─▶ /p/<v>/[<locale>/]…   (public)
                         └─▶ 03:17 trends: k-anonymous per locale and country ─▶ trends_daily (private)
```

The IP address, the key and the user are never stored with the country. The shared cache key has
no country or region in it, so every country shares one cache entry per query. Cross-customer
outputs (shards, trends) are aggregates over apps of ≥ 3 accounts with ≥ 10 searches, after the
privacy filter.

## Regional trends (culture proposals)

The 03:17 cron runs `buildRegionalTrends` (`packages/worker/src/trends.ts`) before its prunes,
so the 7th day of the plans that keep 7 days is still there:

```
D1 query_daily, last 7 complete UTC days, rows with a locale (not 'und')
  ─▶ per (locale, country) and per (locale, '*'): apps of ≥ 3 accounts and ≥ 10 searches
     (unknown countries count only in '*'); privacyReason; normalize(q) = q
  ─▶ baseline = max(query_daily over the 28 days before, the rows of the runs 7/14/21/28 days ago)
  ─▶ score = (searches per day + 1) / (baseline per day + 1)
  ─▶ trends_daily(day, locale, country, query, score, searches, accounts): ≤ 500 per region,
     ≤ 10,000 per night, kept 90 days
readRegionalTrends ─▶ culture proposals (score ≥ 2 = rising)
```

Plans that keep 7 days of `query_daily` have no baseline there, so the earlier runs' rows (already
k-anonymous) are the long memory. Both baselines are lower bounds; the larger one is used.

## Nightly shard build (L2)

The API Worker builds the shards itself on a second cron (`23 4 * * *`, after the retention run),
so no job runner is needed. Code: `packages/worker/src/shards/`, shared build logic:
`@emojisense/data/shards`.

```
D1 query_daily, last 6 complete UTC days (keyed calls only), per locale ('und' rows count as en)
  ─▶ apps of ≥ 3 accounts and ≥ 10 searches in that locale; privacyReason drops emails, URLs, ids
  ─▶ drop what the locale's device answers (that locale's alias engine) and what its base layer holds
  ─▶ reuse the entries of this data's last build; embed new queries like GET /v1/search?mode=semantic&locale=<l>
     (embeddingText, template, shared + locale vectors), ≤ 100 per Workers AI call,
     ≤ 5,000 per night over every locale (most searched first), ≤ 20,000 queries per build
  ─▶ adaptive prefix split per locale (≤ 96 KB raw ≈ 25 KB gzip)
  ─▶ R2 CDN: p/<v>/f/<hash>.json (named by content, only the new ones are written)
     ─▶ state/<v>/<contentHash>.json (the pointer: files per locale, and the previous build's)
     ─▶ p/<v>/index.json and p/<v>/<locale>/index.json (live indexes, each naming its base index)

base layer (with the pack, build:shards:base + upload:shards): synthetic queries of every locale
  ─▶ the same answers, computed on a laptop ─▶ p/<v>/f/… and state/<v>/base.json

cdn.emojisense.com/p/<v>/…  ─▶ CDN cache ─▶ R2 (no Worker, free per request)
api.emojisense.com/p/<v>/…  ─▶ Worker ─▶ live index (per isolate, 5 min) ─▶ edge cache ─▶ R2
                                         (older clients ask for <key>.json; no build: public/p)
```

Files are named by their content, so a re-run on the same day writes nothing new and a shard that
two builds share is downloaded once. The files of the current and the previous build stay; a file
that nothing names is deleted a day later. Pointers of gone deployments (nothing written for 7
days) and other pack versions are deleted. Under one pack version the CDN serves the last
published build, so answers can lag a deploy until the next night.
`SHARDS_CRON_ENABLED` switches the build off; the served build then stays.
