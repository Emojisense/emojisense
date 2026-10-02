# @emojisense/data

The data pipeline: Emojibase + CLDR + curated aliases → client packs, embedding vectors and
layer-2 shards. Formats: [docs/PACK_FORMAT.md](../../docs/PACK_FORMAT.md).

| Command (`pnpm --filter @emojisense/data …`) | Output |
| -------------------------------------------- | ------ |
| `build` | `build/` (base, validated aliases, documents) and `dist/packs/<packVersion>/` |
| `embed -- --models bge-m3 --dims 1024` | `dist/packs/<packVersion>/vectors.<model>.<dims>.bin` from the English documents, plus `vectors.<model>.<dims>.<locale>.bin` per other locale for a multilingual model (needs `wrangler login`; 211 Workers AI calls, cached in `.cache/`) |
| `build:shards -- --log queries.jsonl` | `dist/shards/<packVersion>/` from the analytics export |
| `build:shards -- --bootstrap` | the same from synthetic day-one queries (see the caveat below) |
| `culture:propose` | draft culture entries with Workers AI (needs `wrangler login`; see below) |
| `culture:review` | preview drafts per trigger; `--approve <id> --reviewer <name>` |
| `culture:check` | validate every culture entry (`--fix` normalizes triggers) |
| `culture:build -- --date YYYY-MM-DD` | `dist/culture/<packVersion>/culture.<locale>.json` |

`pack.config.json` holds the pack version, the most aliases per emoji a core pack keeps
(`initialAliases`; `build:pack` lowers it per locale until the core pack is ≤ 200 KB gz and
records the result in the manifest as `coreAliases`) and the production model
(`model.key`, `model.dims`). The shard builder and `pnpm --filter @emojisense/eval cost` use it.

## Aliases: enrichment, overlay and curation (`enrichment/`)

| Path | Content |
| ---- | ------- |
| `enrichment/<group>.json` | English and Turkish aliases: one record per base emoji with an `en` and a `tr` block (`desc`, the lists `synonym`, `slang`, `pop_culture`, `dev`, `typo`, `intent`, `low`, and an optional `top`). Writing rules: `enrichment/STYLE.md`. |
| `enrichment/i18n/<locale>/<group>.json` | The other locales (zh, hi, es, ar, fr, bn, pt, ru, id): one record per emoji and language with the same lists. Rules: `enrichment/STYLE_I18N.md`. |
| `enrichment/i18n/tr/<group>.json` | The **Turkish overlay**: extra Turkish phrases, kept out of the combined files so two writers do not edit the same records. A record has `hexcode`, `emoji` and only the lists it adds (no `desc`). |
| `enrichment/curation.json` | Human overrides on the generated aliases (below). |

**Alias order.** `validate` places a block's aliases as `top` (at most 3, the strongest real-world
phrases), then `synonym`, `slang`, `pop_culture`, `dev`, `intent` (`src/alias-order.ts`); `typo`
and `low` are separate pack fields. The core pack keeps the first aliases per emoji (manifest
`coreAliases`) and the collision cap keeps a shared alias on the owners that rank it highest, so
`top` is the way to put a slang or intent phrase ahead of the synonyms.

**Turkish overlay** (`src/overlay.ts`). Before curation, moderation and the collision cap, each
overlay record joins its emoji's `tr` block: its phrases go first in each list (`top` included), a
base phrase that the overlay lists again is dropped from the base lists, and an overlay `low`
entry demotes a base alias. An unknown hexcode, or one listed twice, fails the build.

**Curation** (`src/curation.ts`). `curation.json` is an array; `validate` applies every entry:

```json
[
  { "hexcode": "1F6A2", "locale": "en", "alias": "ship it", "action": "low", "why": "🚀 is the canonical 'ship it'" },
  { "hexcode": "1F9B5", "locale": "*", "alias": "break a leg", "action": "remove", "why": "idiom means good luck, not a leg" },
  { "hexcode": "1F602", "locale": "pt", "phrase": "kkkk", "action": "add", "why": "the usual Brazilian laugh; the batch had only longer runs" }
]
```

| `action` | Needs | Effect |
| -------- | ----- | ------ |
| `remove` | `alias` | Drops that alias or CLDR keyword of that emoji from the pack |
| `low` | `alias` | Moves it to the `low` field (weight 0.55; a keyword goes to the ext part) |
| `add` | `phrase`, optional `field` (`alias` by default, or `typo`) | Adds a phrase the batch missed |

`locale` is a pack locale or `"*"` for every locale. `alias` names an alias or a CLDR keyword
(`tags`) and is compared in its normalized form (docs/PACK_FORMAT.md §3); the CLDR label is never
curated. A keyword has weight 0.85, above every alias, so `low` is how another emoji becomes the
answer for it. The build warns about a `remove` or `low` entry that matches nothing
(`⚠ curation: …`). `why` is optional but expected: it is the review trail. A malformed entry fails
the build with its index. Append new entries at the end of the file. More rules:
`enrichment/STYLE.md`, "Curation".

## Culture layer (`culture/`)

Editorial associations by culture, region and moment (docs/ARCHITECTURE.md, "Culture layer";
file format: docs/PACK_FORMAT.md §9).

| Path | Content |
| ---- | ------- |
| `culture/entries/<id>.json` | One association: status, kind, context per locale, window, regions, locales, triggers, emoji with weights, provenance. Schema: `culture/schema.json`. |
| `culture/sources/calendar.json` | Holidays for the main regions of the 11 locales; lunar dates listed for 2026 and 2027 |
| `culture/sources/events.json` | Big sports events of 2026–2027, neutral titles |
| `culture/sources/slang.json` | Meaning shifts (💀 = laughing, 🧢 = lie, 加油 = keep going) |
| `culture/prompts/propose.v1.md` | The prompt of `culture:propose`. Change it in a new version file. |
| `culture/exclusions.txt` | No political candidates or parties, tragedies, hate, sexual content involving minors (plus the alias blocklist) |

Workflow: `culture:propose` writes `status: "draft"` files (Workers AI, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
by default; `--provider none` drafts from the sources alone; `--misses misses.jsonl` adds
queries seen ≥ 5 times) → an editor runs `culture:review`, edits the file and approves it →
`culture:check` (also a unit test) → the Worker sync runs `culture:build` and the deploy publishes
it. A build covers 366 days and clients check the windows by their own day, so it needs no daily
rebuild, only a sync and a deploy when entries change. The CI culture gate (`packages/eval`,
`culture:gate`) checks that no eval top-1 answer changes.

Writing rules: context is neutral, ≤ 90 characters, no emoji or exclamation marks, in English and
every targeted locale. Triggers are what people of that locale type, normalized. A lunar-calendar
festival gets one dated entry per year. Regional entries apply only when the app passes a region.

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

### Serving and the nightly build

The API Worker builds the shards every night from `query_daily` with the same code
(`@emojisense/data/shards`) and serves them from R2 (ARCHITECTURE.md, "Nightly shard build").
It accepts a key file name encoded or not (`the%20.json`), and it never sends `immutable`: the
files change under one pack version. This CLI stays for bootstrap shards, dry runs and exports
(`--log`). Rows of a log go through the same privacy filter (`src/shards/privacy.ts`). The CLI
writes the English (`locale=en`) shards only; the nightly build also writes one directory per
other pack locale (`/p/<v>/<locale>/…`, PACK_FORMAT.md §6).
