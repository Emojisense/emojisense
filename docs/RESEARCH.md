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
| Analytics Engine | ≤ 20 blobs, 20 doubles, 1 index per point. 10M writes/month included on Paid. Billing has not started yet. |
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
