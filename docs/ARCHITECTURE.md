# Emojisense architecture

Emojisense is the search brain that any emoji picker plugs into. The design rule: **most
requests never cause a billed server call.** Each layer answers what it can, and passes only the
rest to the next layer. (Revised 2026-10-02 by Update #2; see DECISIONS.md.)

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
L2  precomputed results, static prefix shard /p/<v>/<prefix>.json ─── free asset ── exact hit? ──▶ fuse ▶ results
   │ miss (debounced 150–250 ms)
   ▼
L3  Worker GET /v1/search ─▶ Cache API ─▶ embed query with the chosen Workers AI model
                                         ─▶ dot product over ≈1.9k emoji vectors (≈ 1 ms) ─▶ fuse ▶ results
   │ key over its monthly limit
   └──▶ { overLimit: true } ─▶ client stays on L0 + L2 silently (never a hard failure)
```

| Layer | Where | Cost | Latency | State |
| ----- | ----- | ---- | ------- | ----- |
| L0 alias dictionary (prefix index, IDF, fuzzy) | device | $0 | p95 0.4 ms per keystroke | built |
| L1 on-device semantic | device | — | — | deferred: no small multilingual off-the-shelf model fits unchanged |
| L2 precomputed prefix shards | static assets | $0 (asset requests are free) | 10–30 ms first fetch, then local | Phase 1 |
| L3 Worker + Cache API + Workers AI embedding | edge | ≈ $0.6–0.9 per 1M | +20–80 ms for the model call | built (plans, metering: Phase 1) |

**Fusion.** The client merges L0 with L2 or L3 results by reciprocal rank fusion. Confident L0
hits stay pinned, so the list does not jump when semantic results arrive.

**Layer coupling.** L2 takes the most frequent queries, so the queries that still reach L3 are
the long tail. The L3 Cache API hit rate is therefore low. Cost estimates model the layers
together (`pnpm cost`), never with one global hit rate.

## Build and learning loop

```
emojibase (en) + CLDR (tr) ─▶ ingest ─▶ enrichment (aliases, descriptions) ─▶ validate
        ─▶ packs: pack.<locale>.json (core ≤ 200 KB gz) + pack.<locale>.ext.json (idle-loaded)
        ─▶ embed (chosen model × dims) ─▶ vectors.<model>.<dims>.bin ─▶ manifest.json

Worker query log (Analytics Engine: normalized text only, no IP/key/user)
        ─▶ nightly: queries seen ≥ 5 times
              ├─▶ top ~1M → precompute results → prefix shards (L2)          [open]
              └─▶ weak ones → LLM proposes aliases → eval gate → new pack   [closed, hosted only]
```

## Culture layer

Emoji meaning depends on culture, region and moment: 💀 means "dying of laughter", "goat" comes
with ⚽ 🇦🇷 🇵🇹 in football chat, 🪔 matters at Diwali. The culture layer maps these associations
and adds them to search. Phase 1 is editorial: AI proposes, a person approves. It does not learn
from search traffic.

```
culture/sources/*.json (holiday calendar, 2026–2027 events, slang notes) + analytics misses (seen ≥ 5)
   │
   ▼ culture:propose ── Workers AI, prompt culture/prompts/propose.v<N>.md ──▶ entries/<id>.json  status "draft"
   ▼ culture:review  ── preview per trigger: canonical vs with the entry ──▶ status "approved"  (git = audit trail)
   ▼ culture:check   ── schema, catalog hexcodes, windows, neutral context, exclusions.txt
   ▼ culture:build --date d ──▶ dist/culture/<packVersion>/culture.<locale>.json
   │                             lasting entries + seasonal/event entries active in [d, d+14], exact windows
   ▼ Worker sync ──▶ /v1/culture/<packVersion>/… static assets, max-age=3600 (rebuilt daily)
   ▼ SDK: loadCulture → engine.withCulture(culture) → session applies it after fusion
```

| Rule | Where |
| ---- | ----- |
| **Add, never replace.** Culture emoji go right after the canonical top result. They are above it only when the canonical list is empty. | `insertCulture` in `packages/core/src/culture.ts` |
| Applied last, after the semantic results are fused in, so a semantic answer cannot lift a culture emoji over the top result. | `packages/core/src/session.ts` |
| Results carry `source: "culture"`, `context` (the reason, localized) and `cultureId`. At most 5 per query. | `matchCulture` |
| A trigger matches the whole normalized query, or a prefix being typed (≥ 3 characters and ≥ half the trigger). | `matchCulture` |
| Windows are local calendar days. Yearly windows may wrap the year end. Lunar-calendar festivals get one dated entry per year. | `isActiveOn` |
| Without a region, only entries for every region (`"*"`) apply. `useEmojisense` and `<emojisense-picker>` default to the region of the browser's language, read on the device and never sent. | `CultureScope.region`, `deviceRegion` |
| `culture: false` keeps the canonical ranking (tests, benchmarks). Without a culture file nothing changes. | engine, session, React, web component |
| A "relevant now" shelf (featured seasonal and event emoji) is off by default. | `relevantNow`, `showRelevantNow` |
| CI gate: with every approved entry active, no top-1 answer of the eval suites changes, and each trigger brings its entry's strongest emoji into the top 3. | `packages/eval/src/culture-gate.ts` |

The culture file is optional and small (≤ 1.5 KB gz per locale today). A failed load leaves
search unchanged, and the engine index is shared, not rebuilt, when the file arrives.

## Packages

| Package | Role | License |
| ------- | ---- | ------- |
| `packages/core` (`emojisense`) | Zero-dependency engine: normalizer, L0 index, fusion, `SemanticProvider`s, layer-aware client | MIT |
| `packages/data` | Pipeline: ingest → enrichment → validation → embeddings → packs → shards | MIT |
| `packages/eval` | Labelled queries, benchmark, `pnpm cost`, CI gate | MIT |
| `packages/worker` | Cloudflare Worker: `/v1/search`, packs and shards as assets, plans, metering | MIT |
| `packages/react` (`@emojisense/react`) | Hooks, Frimousse adapter, shadcn registry item | MIT |
| `apps/web` `/playground/` | Playground: per-layer timings, cache state, copy-as-code, reactions and photo labs | MIT |
| private repo `emojisense-cloud` | Miss mining, daily alias updates, billing | closed |

## Invariants

1. Queries and emoji documents are embedded by the same model at the same dimensionality. The
   manifest pins model ID and dims. The Worker refuses a mismatch.
2. The client never blocks first render on a model or network call. L0 alone is a good
   experience, including offline.
3. Over a plan limit, search degrades to L0 + L2. It never fails.
4. No PII: no user IDs, IPs or keys in logs; the IP is only an in-memory rate-limit key. Query
   text is normalized, capped at 64 characters and used only when seen ≥ 5 times. Message text
   for reaction suggestions and images for classification are never stored.
5. Skin-tone variants map to their base emoji. The picker applies the user's tone.
6. Community custom emoji sets are used only for local evaluation, never shipped.
7. No servers to manage: no containers, no load balancers, no vector DB.
