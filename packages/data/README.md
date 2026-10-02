# @emojisense/data

The data pipeline: Emojibase + CLDR + curated aliases → client packs, embedding vectors and
layer-2 shards. Formats: [docs/PACK_FORMAT.md](../../docs/PACK_FORMAT.md).

| Command (`pnpm --filter @emojisense/data …`) | Output |
| -------------------------------------------- | ------ |
| `build` | `build/` (base, validated aliases, documents) and `dist/packs/<packVersion>/` |
| `embed -- --models bge-m3 --dims 1024` | `dist/packs/<packVersion>/vectors.<model>.<dims>.bin` (needs `wrangler login`) |
| `build:shards -- --log queries.jsonl` | `dist/shards/<packVersion>/` from the analytics export |
| `build:shards -- --bootstrap` | the same from synthetic day-one queries (see the caveat below) |

`pack.config.json` holds the pack version, the most aliases per emoji a core pack keeps
(`initialAliases`; `build:pack` lowers it per locale until the core pack is ≤ 200 KB gz and
records the result in the manifest as `coreAliases`) and the production model
(`model.key`, `model.dims`). The shard builder and `pnpm --filter @emojisense/eval cost` use it.

## Layer-2 shards (`build:shards`)

```
analytics export {"q","n"} ─┐
--bootstrap (synthetic) ────┴─▶ normalize, merge ─▶ seen ≥ 5 times ─▶ top 1M by count
  ─▶ drop what the device answers (alias engine + shouldUseSemantic, core and core+ext packs)
  ─▶ resolve: same results as GET /v1/search?mode=semantic (reuses the previous build's entries)
  ─▶ adaptive prefix split, ≤ 30 KB gzip per shard
  ─▶ dist/shards/<packVersion>/index.json + <encodeURIComponent(key)>.json
```

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `--log FILE` | — | JSONL rows `{"q": "...", "n": 12}`, optional `"locale"` |
| `--bootstrap` | off | Add synthetic day-one queries (can be combined with `--log`) |
| `--min-count` | 5 | k-anonymity threshold; rare strings can be personal |
| `--max-queries` | 1000000 | Keep the most frequent queries |
| `--results` | 24 | Results per query (the API's default `limit`) |
| `--max-kb` | 30 | gzip budget per shard |
| `--resolver` | `workers-ai` | `workers-ai` (needs `wrangler login`), `cached` (offline: only queries whose embedding is in `.cache/`), `fake` (stand-in results for dry runs, written to `dist/shards-fake/`) |
| `--model`, `--dims` | `pack.config.json` | The model; its vector file must exist |
| `--out DIR` | see above | Output directory (it is replaced) |
| `--no-reuse` | off | Resolve every query again |

**Adaptive split.** Each first character starts as one key. When a shard is over budget, its
largest next-character groups move to longer keys (`t` → `th` → `the `) until the rest fits.
A query is always in the shard of the longest key that is a prefix of it, which is how clients
find it.

**Size budget.** gzip level 6 (the usual level of on-the-fly HTTP compression).

**Scale.** 1M synthetic queries, fake resolver, Apple silicon laptop: 242 s, 1.3 GB peak
memory, 13,333 shards (gzip p50 12.3 KB, max 30.0 KB, 188 MB in total). The alias gate
(~0.1 ms per query) and the gzip measurements take most of the time. A real run adds the
Workers AI calls, but it reuses the entries of the previous build, so a nightly run embeds only
new queries. The bootstrap set (59,805 queries) builds 711 shards in 11 s.

### Caveat: bootstrap queries are synthetic

Before any query log exists, `--bootstrap` builds queries from our own data:

- multi-word aliases (`alias` and `low`, English and Turkish), for example "ship it",
- 2–6-word fragments of the emoji descriptions, for example "fast growth",
- templates: moods ("feeling tired", "çok yorgun") and mood + animal ("sad dog").

These queries are **synthetic and biased toward our own aliases**. They show what we expect
people to type, not what they type. Many are alias phrases that the device already ranks well;
the shard adds the semantic neighbours. The gate drops only ~1.5% of them: an exact
multi-word alias match scores 0.8, below the 0.9 that `shouldUseSemantic` needs to stay on the
device. Queries we did not anticipate still go to the API. Do
not use bootstrap shards to estimate the real L2 hit rate. Replace them with the first nightly
build from real logs.

### Open points for serving

- File names are `encodeURIComponent(key)`, so the key `"the "` is the file `the%20.json`.
  Check that the static asset host serves that literal file name for the request path
  `/p/<packVersion>/the%20.json` (some hosts decode `%20` before the lookup).
- A nightly rebuild under the same pack version rewrites files in place. Do not serve them as
  `immutable` unless the path also carries a build id.
