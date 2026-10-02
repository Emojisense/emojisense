# Emojisense eval report

- Date: 2026-10-02 · pack 0.1.0 · 214 scored queries (+3 noise) · 46 labels marked for human review
- Hit = any acceptable emoji in the top k. MRR over the top 10. forbid@3 = a forbidden emoji in the top 3 (hard negatives).

## Engines

| Engine | R@1 | R@5 | R@10 | MRR | forbid@3 | Tier 1 calls | Note |
| --- | --: | --: | --: | --: | --: | --: | --- |
| **alias (core + ext)** | 76.6 | 95.8 | 97.2 | 0.848 | 1.4 | 0% |  |
| alias (core only, first load) | 71 | 85.5 | 86.4 | 0.77 | 1.4 | 0% |  |
| alias (core with ≤8 aliases) | 66.8 | 77.1 | 78 | 0.712 | 1.4 | 0% |  |
| alias (core with ≤16 aliases) | 71 | 85.5 | 86.4 | 0.77 | 1.4 | 0% |  |
| alias (core with ≤24 aliases) | 72 | 90.2 | 91.6 | 0.796 | 1.9 | 0% |  |
| alias (min coverage 0.5) | 75.2 | 95.3 | 98.1 | 0.838 | 1.4 | 0% |  |
| alias (min coverage 0.6) | 72.9 | 93 | 95.3 | 0.811 | 0.9 | 0% |  |

## Recall@5 by category

| Engine | exact (26) | typo (24) | slang (33) | pop (35) | idiom (21) | intent (32) | tr (33) | negative (10) |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| alias (core + ext) | 100 | 100 | 97 | 91.4 | 90.5 | 90.6 | 100 | 100 |
| alias (core only, first load) | 100 | 95.8 | 81.8 | 77.1 | 71.4 | 78.1 | 90.9 | 100 |
| alias (min coverage 0.5) | 100 | 100 | 97 | 91.4 | 90.5 | 90.6 | 97 | 100 |
| alias (min coverage 0.6) | 100 | 95.8 | 93.9 | 88.6 | 90.5 | 87.5 | 97 | 90 |

## Latency

| Measure | p50 | p95 | max | n |
| --- | --: | --: | --: | --: |
| Tier 0 per keystroke (Node, this machine) | 0.07 ms | 0.61 ms | 33 ms | 6237 |
| Tier 0 index build (en + tr) | 184 ms |  |  | 1 |

Noise queries with a confident (≥ 0.6) alias result: 0/3.

## Sizes

| Client pack | en gz | tr gz |
| --- | --: | --: |
| core (shipped) | 179.1 KB | 168.3 KB |
| ext (loaded when idle) | 247.3 KB | 89.9 KB |
| core with ≤8 aliases | 112.4 KB | 112.4 KB |
| core with ≤16 aliases | 179.1 KB | 168.3 KB |
| core with ≤24 aliases | 242.3 KB | 187.2 KB |

| Server file | raw | gz |
| --- | --: | --: |

## Layered cost per 1M searches

Model `@cf/baai/bge-m3` at $0.0120 / 1M tokens (listed). L0 share 54.7% (measured: eval gate, 214 queries, this run), L2 share 50% of semantic requests, L3 Cache API hit rate 10%, 1.5 requests per semantic search.

- **Search, all layers L0–L3: $0.145 per 1M searches** (usage beyond the included quotas).
- With reaction suggestions and images: $0.868 per 1M searches.
- All-in at 10M searches / month: $9.149 / month = $0.915 per 1M (plan fee and included quotas counted).
- ⚠ image price $0.0010 per image is an assumption.
- ⚠ Analytics Engine billing has not started (it would add $0.0902 per 1M searches).

| Layer | Volume per 1M searches | $ per 1M searches |
| --- | --: | --: |
| L0 on device | 546.7k searches | $0 |
| L2 static shards | 340k requests | $0 |
| L3 Worker, Cache API hit | 34k requests | $0.0116 |
| L3 Worker, embed + search | 306k requests | $0.133 |
| Reaction suggestions | 20k requests | $0.0222 |
| Image classification | 1k requests | $0.701 |
| **Total** | 361k Worker requests | **$0.868** |

| Cost line | $ per 1M searches |
| --- | --: |
| Worker requests | $0.108 |
| Worker CPU | $0.0145 |
| Workers AI embeddings | $0.0449 |
| Image model | $0.700 |
| Analytics Engine | $0 |
| Static shards (L2), on device (L0) | $0 |

### Sensitivity (one input at a time)

| Input | Low | Base | High | $ / 1M at low | at base | at high |
| --- | --: | --: | --: | --: | --: | --: |
| deviceShare | 40% | 54.7% | 90% | $0.915 | $0.868 | $0.755 |
| shardHitShare | 0% | 50% | 80% | $1.013 | $0.868 | $0.781 |
| cacheHitRate | 0% | 10% | 50% | $0.871 | $0.868 | $0.855 |
| requestsPerSemanticSearch | 1 | 1.5 | 3 | $0.819 | $0.868 | $1.013 |
| model.tokensPerQuery | 4 | 8 | 24 | $0.853 | $0.868 | $0.926 |
| model.pricePerMTokens | 0.012 | 0.012 | 0.067 | $0.868 | $0.868 | $1.074 |
| reactions.perSearch | 0 | 0.02 | 0.1 | $0.846 | $0.868 | $0.956 |
| images.perSearch | 0 | 0.001 | 0.01 | $0.167 | $0.868 | $7.173 |
| images.pricePerImage | 0.0002 | 0.001 | 0.005 | $0.308 | $0.868 | $3.668 |

### L0 share × L2 share ($ per 1M searches)

| L0 ↓ / L2 → | 0% | 25% | 50% | 75% | 90% |
| --- | --: | --: | --: | --: | --: |
| 40% | $1.107 | $1.011 | $0.915 | $0.819 | $0.761 |
| 60% | $0.979 | $0.915 | $0.851 | $0.787 | $0.748 |
| 80% | $0.851 | $0.819 | $0.787 | $0.755 | $0.736 |
| 90% | $0.787 | $0.771 | $0.755 | $0.739 | $0.729 |

### All-in by volume

| Searches / month | $ / month | $ per 1M searches |
| --- | --: | --: |
| 1M | $5.000 | $5.000 |
| 10M | $9.149 | $0.915 |
| 100M | $84.87 | $0.849 |
| 1B | $865.82 | $0.866 |

Inputs: `cost.assumptions.json`. Recompute with `pnpm --filter @emojisense/eval cost`.

## Misses of the best engine (alias (core + ext))

| Query | Category | Expected | Got (top 5) |
| --- | --- | --- | --- |
| touch grass ⓡ | slang | 🌱🌿☘️🌳 | 🚶 🥾 🦗 🟩 🛖 |
| super mario ⓡ | pop | 🍄🎮🪠🔧 | 🪙 🕹️ ⭐️ 💫 🌟 |
| minecraft ⓡ | pop | ⛏️🧱🟩🎮 | 💎 🟫 🪵 🧨 ♦️ |
| olympics | pop | 🏅🥇🏟️🏃 | ⛷️ 🏂️ 🗾 ⛸️ 🎿 |
| cost an arm and a leg ⓡ | idiom | 💸💰🤑💵 | 🦾 💪 🫷 🫸 🏋️ |
| bite the bullet ⓡ | idiom | 😬💪😤 | 🫦 🦟 🚅 🧛 🖕 |
| hang in there ⓡ | intent | 💪🙏🫂❤️ | 😣 🧗 ✊️ 🧗‍♂️ 🧗‍♀️ |
| on my way | intent | 🏃🚗🚶🔜 | 🌌 🤯 🦥 🏠️ 🛗 |
| weekend vibes ⓡ | intent | 😎🏖️🍹🥳 | 🙌 🍺 🪩 👕 👖 |

ⓡ = label marked for human review in queries.jsonl.
