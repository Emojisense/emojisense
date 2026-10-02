# Emojisense architecture

Emojisense is the search brain that any emoji picker plugs into. Most keystrokes never reach
a network or a model. A small alias index on the client answers them in one frame. A
semantic fallback at the edge handles conceptual queries. The fallback is cached aggressively.

## Request path

```
 keystroke
    │
    ▼
┌──────────────────────────── client (packages/core, < 15 KB gz) ───────────────────────────┐
│ normalize → Tier 0 alias index (pack.<locale>.json, ≤ 200 KB gz) → results in < 16 ms     │
│                │                                                                          │
│                └─ low confidence OR multi-word/conceptual? ── debounce 150–250 ms ──┐     │
│                                                                                     │     │
│ fuse(Tier 0, Tier 1) — reciprocal rank fusion; high-confidence alias hits stay put ◀┤     │
└─────────────────────────────────────────────────────────────────────────────────────┼─────┘
                                                                                      │ GET /v1/search
┌──────────────────────────── edge (packages/worker, Cloudflare) ─────────────────────▼─────┐
│ normalize → Tier 2 Cache API (key: query + locale + pack + model) ── hit → < 30 ms        │
│          → miss → Workers AI embed(query) → brute-force dot product over the in-memory    │
│                   emoji vectors (≈1.9k × 256 int8, bundled with the Worker) → cache.put   │
│          → Analytics Engine: counts + latency; low-confidence queries → miss log (Tier 3) │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

## Tiers

| Tier | Where | What | Budget |
| ---- | ----- | ---- | ------ |
| 0 | client | Alias dictionary: name > shortcode > CLDR keyword > generated alias, IDF-weighted token match, prefix match for the token being typed, bounded edit-distance fuzzy match | < 16 ms per keystroke, works offline |
| 1 | edge | Embedding of the query (one model, one dimensionality per index) + brute force over the emoji vectors | p95 < 150 ms on a cache miss |
| 2 | edge | Cache API per data center, keyed by the normalized query. Optional KV second tier later. | p95 < 30 ms on a hit |
| 3 | offline | Aggregated, anonymous low-confidence query log → nightly LLM proposes aliases → eval gate → new pack version | — |

## Data flow (build time)

```
emojibase-data (en) ─┐
CLDR annotations (tr)┴─▶ ingest ─▶ enrichment (aliases + description per emoji, en + tr)
                                         │
                                         ▼
                                    validate (dedupe, collision cap, blocklist, review.csv)
                                         │
                       ┌─────────────────┴──────────────────┐
                       ▼                                    ▼
             pack.<locale>.json (client)       embed (per model × dims) → vectors.<model>.<dims>.bin
                       └──────────────┬─────────────────────┘
                                      ▼
                         manifest.json (versions, sha256, sizes)
```

The pack format is platform-neutral and documented in [PACK_FORMAT.md](PACK_FORMAT.md). Swift
and Kotlin clients can implement it from that document alone.

## Packages

| Package | Role | Ships to |
| ------- | ---- | -------- |
| `packages/core` (`emojisense`) | Zero-dependency engine: normalizer, Tier 0 index, fusion, API client | npm |
| `packages/data` | Build pipeline: ingest → enrichment → validation → embeddings → pack | internal |
| `packages/eval` | Labelled queries, benchmark runner, report, CI regression gate | internal |
| `packages/worker` | Cloudflare Worker: `/v1/search`, `/v1/pack/*` | Cloudflare |
| `packages/react` (`@emojisense/react`) | `useEmojiSearch` hook + Frimousse adapter | npm |
| `apps/demo` | Side-by-side demo: keyword search vs Emojisense, latency and cost counters | Cloudflare |

## Invariants

1. Documents and queries are embedded by the same model with the same dimensionality. Each
   vector file names its model and dims. The Worker refuses a mismatch.
2. The client never blocks first render on a model or network call. Tier 0 alone must be a good
   experience.
3. Skin-tone variants map to their base emoji for search. The picker applies the user's tone.
4. No PII anywhere: no user IDs, no IPs, no raw keystrokes in logs. Only normalized, truncated
   query strings in aggregate.
5. Community custom emoji sets are used only for local evaluation. They are never committed or
   shipped.
