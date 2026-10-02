# Emojisense eval report

- Date: 2026-10-02 · pack 0.1.0 · 214 scored queries (+3 noise) · 46 labels marked for human review
- Hit = any acceptable emoji in the top k. MRR over the top 10. forbid@3 = a forbidden emoji in the top 3 (hard negatives).

## Engines

| Engine | R@1 | R@5 | R@10 | MRR | forbid@3 | Tier 1 calls | Note |
| --- | --: | --: | --: | --: | --: | --: | --- |
| alias (core + ext) | 85 | 98.6 | 99.1 | 0.908 | 1.4 | 0% |  |
| alias (core only, first load) | 75.7 | 87.4 | 88.3 | 0.81 | 1.4 | 0% |  |
| alias (core with ≤8 aliases) | 68.7 | 78.5 | 79.9 | 0.731 | 1.4 | 0% |  |
| alias (core with ≤16 aliases) | 75.7 | 87.4 | 88.3 | 0.81 | 1.4 | 0% |  |
| alias (core with ≤24 aliases) | 79 | 93 | 95.3 | 0.853 | 1.9 | 0% |  |
| alias (min coverage 0.5) | 85.5 | 98.6 | 99.5 | 0.913 | 1.4 | 0% |  |
| alias (min coverage 0.6) | 83.2 | 96.3 | 97.7 | 0.889 | 0.5 | 0% |  |
| semantic bge-m3@1024 | 75.2 | 90.2 | 93 | 0.81 | 2.3 | 100% |  |
| **fused bge-m3@1024** | 88.3 | 99.1 | 100 | 0.928 | 1.9 | 100% |  |
| fused-gated bge-m3@1024 | 86.4 | 99.1 | 99.5 | 0.917 | 1.4 | 9% |  |
| semantic bge-m3@768 | 68.7 | 85 | 90.7 | 0.761 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@768 | 87.9 | 98.6 | 99.5 | 0.925 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@768 | 86 | 98.6 | 99.1 | 0.912 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@512 | 67.3 | 81.8 | 86.9 | 0.736 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@512 | 87.4 | 98.6 | 99.5 | 0.923 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@512 | 86 | 98.6 | 99.1 | 0.912 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@256 | 56.1 | 75.7 | 81.8 | 0.64 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@256 | 86.4 | 98.6 | 99.5 | 0.917 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@256 | 86 | 98.6 | 99.1 | 0.912 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@128 | 39.7 | 57.5 | 64.5 | 0.471 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@128 | 86 | 98.1 | 98.6 | 0.911 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@128 | 85 | 98.1 | 98.6 | 0.905 | 1.4 | 9% | truncated, model not MRL-trained |

> Skipped bge-small: bge-small: 214 query embeddings not cached and --offline is set
> Skipped embeddinggemma: embeddinggemma: 214 query embeddings not cached and --offline is set
> Skipped qwen3: qwen3: 214 query embeddings not cached and --offline is set

### Semantic calibration

Fusion weights the semantic list by its best cosine, from 0 at `floor` to 1 at `ceiling`. Measured here: floor = 25th percentile of the semantic misses' best cosine, ceiling = median of the hits'. The shipped model uses the client default (`DEFAULT_SEMANTIC_CALIBRATION`).

| Vectors | Measured floor–ceiling | Used |
| --- | --: | --: |
| bge-m3@1024 | 0.47–0.62 | 0.44–0.58 (client default) |
| bge-m3@768 | 0.50–0.61 | 0.50–0.61 |
| bge-m3@512 | 0.52–0.63 | 0.52–0.63 |
| bge-m3@256 | 0.45–0.56 | 0.45–0.56 |
| bge-m3@128 | 0.52–0.60 | 0.52–0.60 |

## Held-out suite

Not run (`--no-heldout`). `pnpm eval:heldout` runs it alone.

## Recall@5 by category

| Engine | exact (26) | typo (24) | slang (33) | pop (35) | idiom (21) | intent (32) | tr (33) | negative (10) |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| alias (core + ext) | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| alias (core only, first load) | 100 | 95.8 | 78.8 | 85.7 | 71.4 | 78.1 | 97 | 100 |
| alias (min coverage 0.5) | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| alias (min coverage 0.6) | 100 | 95.8 | 93.9 | 97.1 | 95.2 | 93.8 | 100 | 90 |
| semantic bge-m3@1024 | 92.3 | 95.8 | 87.9 | 82.9 | 81 | 96.9 | 90.9 | 100 |
| fused-gated bge-m3@1024 | 100 | 100 | 100 | 97.1 | 100 | 96.9 | 100 | 100 |
| semantic bge-m3@768 | 92.3 | 95.8 | 69.7 | 80 | 76.2 | 96.9 | 81.8 | 100 |
| fused-gated bge-m3@768 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@512 | 96.2 | 87.5 | 63.6 | 77.1 | 81 | 84.4 | 81.8 | 100 |
| fused-gated bge-m3@512 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@256 | 84.6 | 87.5 | 54.5 | 77.1 | 71.4 | 84.4 | 66.7 | 100 |
| fused-gated bge-m3@256 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@128 | 69.2 | 66.7 | 48.5 | 51.4 | 52.4 | 62.5 | 51.5 | 70 |
| fused-gated bge-m3@128 | 100 | 95.8 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |

## Latency

| Measure | p50 | p95 | max | n |
| --- | --: | --: | --: | --: |
| Tier 0 per keystroke (Node, this machine) | 0.06 ms | 0.43 ms | 9.71 ms | 6237 |
| Tier 0 index build (en + tr) | 102 ms |  |  | 1 |

Noise queries with a confident (≥ 0.6) alias result: 0/3.

## Sizes

| Client pack | en gz | tr gz |
| --- | --: | --: |
| core (shipped) | 179.7 KB | 168.7 KB |
| ext (loaded when idle) | 255.1 KB | 92.3 KB |
| core with ≤8 aliases | 113.9 KB | 112.2 KB |
| core with ≤16 aliases | 179.7 KB | 168.7 KB |
| core with ≤24 aliases | 243.6 KB | 189.0 KB |

| Server file | raw | gz |
| --- | --: | --: |
| vectors.bge-m3.1024.<locale>.bin × 10 | 21775.0 KB | 17034.6 KB |
| vectors.bge-m3.1024.bin | 2177.5 KB | 1710.2 KB |
| vectors.bge-m3.128.bin | 293.4 KB | 266.7 KB |
| vectors.bge-m3.256.bin | 562.6 KB | 516.9 KB |
| vectors.bge-m3.512.bin | 1100.9 KB | 861.1 KB |
| vectors.bge-m3.768.bin | 1639.2 KB | 1286.1 KB |
| vectors.bge-small.128.bin | 293.4 KB | 226.2 KB |
| vectors.bge-small.256.bin | 562.6 KB | 442.7 KB |
| vectors.bge-small.384.bin | 831.7 KB | 658.2 KB |
| vectors.embeddinggemma.128.bin | 293.4 KB | 262.5 KB |
| vectors.embeddinggemma.256.bin | 562.6 KB | 508.9 KB |
| vectors.embeddinggemma.512.bin | 1100.9 KB | 999.7 KB |
| vectors.embeddinggemma.768.bin | 1639.2 KB | 1490.6 KB |
| vectors.qwen3.1024.bin | 2177.5 KB | 1959.3 KB |
| vectors.qwen3.128.bin | 293.4 KB | 264.3 KB |
| vectors.qwen3.256.bin | 562.6 KB | 504.9 KB |
| vectors.qwen3.512.bin | 1100.9 KB | 993.5 KB |
| vectors.qwen3.768.bin | 1639.2 KB | 1478.9 KB |

## Layered cost per 1M searches

Model `@cf/baai/bge-m3` at $0.0120 / 1M tokens (listed). L0 share 91.1% (measured: eval gate, 214 queries, this run), L2 share 50% of semantic requests, L3 Cache API hit rate 10%, 1.5 requests per semantic search.

- **Search, all layers L0–L3: $0.0284 per 1M searches** (usage beyond the included quotas).
- With reaction suggestions and images: $0.751 per 1M searches.
- All-in at 10M searches / month: $8.913 / month = $0.891 per 1M (plan fee and included quotas counted).
- ⚠ image price $0.0010 per image is an assumption.
- ⚠ Analytics Engine billing has not started (it would add $0.0219 per 1M searches).

| Layer | Volume per 1M searches | $ per 1M searches |
| --- | --: | --: |
| L0 on device | 911.2k searches | $0 |
| L2 static shards | 66.6k requests | $0 |
| L3 Worker, Cache API hit | 6.7k requests | $0.0023 |
| L3 Worker, embed + search | 59.9k requests | $0.0261 |
| Reaction suggestions | 20k requests | $0.0222 |
| Image classification | 1k requests | $0.701 |
| **Total** | 87.6k Worker requests | **$0.751** |

| Cost line | $ per 1M searches |
| --- | --: |
| Worker requests | $0.0263 |
| Worker CPU | $0.0036 |
| Workers AI embeddings | $0.0213 |
| Image model | $0.700 |
| Analytics Engine | $0 |
| Static shards (L2), on device (L0) | $0 |

### Sensitivity (one input at a time)

| Input | Low | Base | High | $ / 1M at low | at base | at high |
| --- | --: | --: | --: | --: | --: | --: |
| deviceShare | 40% | 91.1% | 90% | $0.915 | $0.751 | $0.755 |
| shardHitShare | 0% | 50% | 80% | $0.780 | $0.751 | $0.734 |
| cacheHitRate | 0% | 10% | 50% | $0.752 | $0.751 | $0.749 |
| requestsPerSemanticSearch | 1 | 1.5 | 3 | $0.742 | $0.751 | $0.780 |
| model.tokensPerQuery | 4 | 8 | 24 | $0.748 | $0.751 | $0.763 |
| model.pricePerMTokens | 0.012 | 0.012 | 0.067 | $0.751 | $0.751 | $0.849 |
| reactions.perSearch | 0 | 0.02 | 0.1 | $0.729 | $0.751 | $0.840 |
| images.perSearch | 0 | 0.001 | 0.01 | $0.0506 | $0.751 | $7.057 |
| images.pricePerImage | 0.0002 | 0.001 | 0.005 | $0.191 | $0.751 | $3.551 |

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
| 10M | $8.913 | $0.891 |
| 100M | $73.83 | $0.738 |
| 1B | $749.26 | $0.749 |

Inputs: `cost.assumptions.json`. Recompute with `pnpm --filter @emojisense/eval cost`.

### Per engine

Same layer assumptions; query tokens ≈ chars / 4 of the formatted query.

| Engine | Tier 1 calls | $ / 1M tokens | Search $ / 1M searches | All layers $ / 1M searches |
| --- | --: | --: | --: | --: |
| fused-gated bge-m3@1024 | 9% | $0.0120 | $0.0244 | $0.747 |
| fused-gated bge-m3@768 | 9% | $0.0120 | $0.0244 | $0.747 |
| fused-gated bge-m3@512 | 9% | $0.0120 | $0.0244 | $0.747 |
| fused-gated bge-m3@256 | 9% | $0.0120 | $0.0244 | $0.747 |
| fused-gated bge-m3@128 | 9% | $0.0120 | $0.0244 | $0.747 |

⚠ = model price is not published; `model.assumedPricePerMTokens` is used.

## Misses of the best engine (fused bge-m3@1024)

| Query | Category | Expected | Got (top 5) |
| --- | --- | --- | --- |
| shrek ⓡ | pop | 🧌👹🟢 | 💚 🧅 🫏 🥺 🤷‍♂️ |
| among us ⓡ | pop | 📮🔪🚀🤨 | 🫘 👯‍♂️ 🎮️ 👯 ⏏️ |

ⓡ = label marked for human review in queries.jsonl.
