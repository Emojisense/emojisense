# Verified external facts

Checked on 2026-10-02 against official docs, model cards and npm tarballs. Re-check before you
depend on a number. ⚠ = not verified, or the sources conflict.

## Workers AI embedding models

| Model ID | Dims | Max tokens | Batch | $/1M tokens | Notes |
| -------- | ---- | ---------- | ----- | ----------- | ----- |
| `@cf/baai/bge-small-en-v1.5` | 384 | 512 | 100 | 0.020 | `pooling: "mean"` (default) or `"cls"`. The two give incompatible vectors. MIT. |
| `@cf/baai/bge-base-en-v1.5` | 768 | 512 | 100 | 0.067 | |
| `@cf/baai/bge-large-en-v1.5` | 1024 | 512 | 100 | 0.204 | |
| `@cf/baai/bge-m3` | 1024 | ⚠ 512 vs 60k | 100 | 0.012 | Multilingual. No query instruction needed. MIT. |
| `@cf/google/embeddinggemma-300m` | 768 ⚠ | 512 ⚠ | 100 | ⚠ **not listed** | Beta. Pricing issue cloudflare-docs#27490 is still open. It is unknown if the task prompt is added server-side. |
| `@cf/qwen/qwen3-embedding-0.6b` | 1024 | ⚠ 8,192 vs 4,096 | 32 | 0.012 | Inputs `queries` / `documents` / `instruction`. Apache-2.0. |

- Price: $0.011 per 1,000 neurons. 10,000 neurons/day free on all plans.
- Rate limit: 3,000 requests/min for embeddings.
- Sources: developers.cloudflare.com/workers-ai/models/, /workers-ai/platform/pricing/, /workers-ai/platform/limits/

## Model prompt formats (from the model cards)

| Model | Query | Document |
| ----- | ----- | -------- |
| EmbeddingGemma | `task: search result \| query: {q}` | `title: {title or "none"} \| text: {content}` |
| Qwen3-Embedding | `Instruct: {task}\nQuery:{q}` (no space after `Query:`) | no prefix |
| bge-small-en-v1.5 | optional `Represent this sentence for searching relevant passages: ` | no prefix |
| bge-m3 | none | none |

- EmbeddingGemma supports Matryoshka truncation to 768/512/256/128. Re-normalize after you
  truncate. It does not support float16 activations. License: Gemma Terms of Use. Never bundle
  the weights in the OSS SDK.
- Qwen3-Embedding has MRL from 32 to 1024.
- BGE models are not MRL-trained. Truncated BGE vectors are reported for completeness only.

## Workers platform

| Item | Value |
| ---- | ----- |
| Paid plan | $5/month. 10M requests included, then $0.30 per 1M. 30M CPU-ms included, then $0.02 per 1M CPU-ms. |
| Free plan | 100k requests/day. 10 ms CPU per invocation. |
| Cache API | Local to each data center. Works on `*.workers.dev` (fixed 2025). GET only. No `stale-while-revalidate`. A request served from cache still bills the Worker request. |
| Workers Cache (`[cache] enabled`) | Tiered. A hit skips the Worker (no CPU, no rate limiter, no analytics). The request is still billed. |
| Rate limiting binding | `[[ratelimits]]`, `simple = { limit, period = 10 \| 60 }`. Per location. Eventually consistent. ⚠ price not documented. |
| Analytics Engine | ≤ 20 blobs, 20 doubles, 1 index per point. 10M writes/month included on Paid. Billing has not started yet. "Data written to Workers Analytics Engine is stored for three months" (/analytics/analytics-engine/limits/, checked 2026-10-02). |
| Workers Logs | Retention 3 days (Free), 7 days (Paid). `observability.logs.invocation_logs: false` turns off the per-request log (request URL, response, metadata); `console.*` logs stay (/workers/observability/logs/workers-logs/, checked 2026-10-02). |
| D1 | "By default, D1 enforces that foreign key constraints are valid within all queries and migrations" (/d1/sql-api/foreign-keys/). Time Travel restores up to 30 days back (Paid) or 7 days (Free) (/d1/reference/time-travel/). Both checked 2026-10-02. |
| Script size | 64 MiB uncompressed. Global scope must start in ≤ 1 s. A `.bin` import gives an `ArrayBuffer`. |
| KV | 1 write/s per key. Propagation is up to 60 s or more. Writes $5 per 1M (Paid). |
| Static sites | Pages docs: "Start new projects with Workers". Static asset requests are free. |

## Emoji data

- `emojibase-data` 17.0.0 (MIT) covers Emoji 17.0 / CLDR 48. Locales: 28, without `tr`.
- `en/data.json`: 1,949 entries = 1,914 base + 26 regional indicators + 9 components. 2,030 skin variants.
- Shortcode presets: cldr, cldr-native, emojibase, emojibase-legacy, github, iamcal, joypixels.
- `cldr-annotations-full` / `cldr-annotations-derived-full` 48.2.0 (Unicode License V3) give
  Turkish for all 1,914. Keys have no U+FE0F.

## Pickers

- **Frimousse 0.4.0** (MIT): `resolveEmojiData(locale, {emojiVersion, emojibaseUrl, signal})`.
  There is no search override. The built-in filter does a substring match on label/tags, then
  regroups the results by category. Open request: liveblocks/frimousse#11.
- **emoji-mart 5.6.0**: no custom search function. It has headless `SearchIndex.search` and custom data.

## Update #2 checks (2026-10-02)

### Cloudflare platform

| Item | Value |
| ---- | ----- |
| Static assets | 20,000 files per version (Free), 100,000 (Paid); 25 MiB per file; asset requests free and unlimited |
| `run_worker_first` | `false` (default) serves the matching asset; `true` = always Worker; or an array of patterns with `!` negation (negatives win, ≤ 100 entries). On Free, routes matching it get 429 when the quota runs out. |
| `_headers` | 100 rules; **not applied to Worker responses** (default asset header `public, max-age=0, must-revalidate`) |
| Workers limits | 128 MB memory per isolate; 64 MiB script (no compressed limit); 1 s startup; CPU per request 10 ms Free, 30 s default up to 5 min Paid |
| Durable Objects (Paid) | 1M requests/mo incl., then $0.15/M; 400k GB-s incl., then $12.50/M GB-s; SQLite rows written 50M incl., then $1/M. Free plan: SQLite-backed only. |
| Workers KV Instant | exists, **private beta** (announced 2026-10-01): reads $0.20/M, writes $0.10 **each**, storage $100/MB-month; ≤ 1 MB and ≤ 10k keys per namespace; 1 write/s per namespace; p99 read < 2 ms; ~250 ms replication |
| Analytics Engine | billing **not started** ("Currently, you will not be billed"); planned Paid: 10M writes incl. then $0.25/M, 1M queries incl. then $1/M |
| EmbeddingGemma | still Beta and **not priced** (issue #27490 open, no Cloudflare reply) |

### Workers AI vision models (caption candidates)

| Model ID | $/M in | $/M out | Note |
|---|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` | 0.10 | 0.30 | vision; no license-accept step |
| `@cf/meta/llama-3.2-11b-vision-instruct` | 0.049 | 0.676 | needs a one-time `"prompt":"agree"` (Meta license) |
| `@cf/moondream/moondream3.1-9B-A2B` | 0.30 | 1.00 | has a `caption` task |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 0.27 | 0.85 | vision |

Images are billed as input tokens (no per-image price). `gemma-3-12b-it` was deprecated on
2026-05-30.

### Other models

- **Granite embedding R2:** `311m-multilingual-r2` (768 dims, MRL 512–128, Turkish, Apache-2.0,
  tokenizer derived from Gemma 3) and `97m-multilingual-r2` (384 dims, no MRL). **Not on Workers
  AI.** On HF Inference only 97m is live. → not conveniently hosted; skipped.
- **potion-base-8M:** 29,528 × 256 fp32 (30 MB), BERT WordPiece uncased, mean pooling + L2,
  MIT; MTEB retrieval 31.1 vs bge-small 51.7. Not used (owner decision).
- **Gemini:** 2.5 Flash-Lite $0.10/$0.40 (only for earlier users); 3.5 Flash-Lite $0.30/$2.50.
  The free tier uses data to improve Google products; the paid tier does not.

### Licenses for output vectors

Gemma ToU §3.3: Google claims no rights in Outputs, and Outputs are not Model Derivatives (but a
model trained on outputs to behave like Gemma is). bge (MIT), Qwen3-Embedding-0.6B (Apache-2.0),
potion (MIT): no output restrictions.

### Business facts

Emoji set licenses, payment-provider fees, the Google Docs insertion options, the shadcn registry,
editor hooks, Raycast/MCP and Slack/Discourse facts are in PRICING.md and INTEGRATIONS.md (sources
are listed in the research report from 2026-10-02).
