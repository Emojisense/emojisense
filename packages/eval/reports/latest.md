# Emojisense eval report

- Date: 2026-10-02 · pack 0.1.0 · 214 scored queries (+3 noise) · 46 labels marked for human review
- Hit = any acceptable emoji in the top k. MRR over the top 10. forbid@3 = a forbidden emoji in the top 3 (hard negatives).

## Engines

| Engine | R@1 | R@5 | R@10 | MRR | forbid@3 | Tier 1 calls | Note |
| --- | --: | --: | --: | --: | --: | --: | --- |
| alias (core + ext) | 79.9 | 97.7 | 97.7 | 0.872 | 1.4 | 0% |  |
| alias (core only, first load) | 73.8 | 86.9 | 88.3 | 0.798 | 1.4 | 0% |  |
| alias (core with ≤8 aliases) | 65.9 | 77.6 | 78.5 | 0.708 | 1.4 | 0% |  |
| alias (core with ≤16 aliases) | 73.8 | 86.9 | 88.3 | 0.798 | 1.4 | 0% |  |
| alias (core with ≤24 aliases) | 77.1 | 92.5 | 94.9 | 0.838 | 1.9 | 0% |  |
| alias (min coverage 0.5) | 78.5 | 97.7 | 98.1 | 0.864 | 1.4 | 0% |  |
| alias (min coverage 0.6) | 75.7 | 95.3 | 96.3 | 0.836 | 0.5 | 0% |  |
| semantic bge-small@384 | 56.5 | 70.6 | 73.4 | 0.623 | 2.3 | 100% |  |
| fused bge-small@384 | 81.3 | 96.3 | 98.1 | 0.879 | 1.9 | 100% |  |
| fused-gated bge-small@384 | 80.8 | 97.2 | 97.7 | 0.877 | 1.4 | 9% |  |
| semantic bge-small@256 | 53.7 | 69.2 | 73.8 | 0.606 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-small@256 | 82.2 | 97.2 | 98.1 | 0.884 | 1.9 | 100% | truncated, model not MRL-trained |
| **fused-gated bge-small@256** | 81.8 | 97.7 | 97.7 | 0.882 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-small@128 | 47.7 | 60.7 | 65.9 | 0.533 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-small@128 | 78.5 | 97.7 | 98.1 | 0.866 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-small@128 | 79.9 | 97.2 | 97.7 | 0.871 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@1024 | 68.7 | 85.5 | 88.8 | 0.756 | 2.3 | 100% |  |
| fused bge-m3@1024 | 84.1 | 96.7 | 98.1 | 0.892 | 1.9 | 100% |  |
| fused-gated bge-m3@1024 | 81.8 | 97.2 | 97.7 | 0.881 | 1.4 | 9% |  |
| semantic bge-m3@768 | 65.4 | 85 | 88.3 | 0.738 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@768 | 83.6 | 96.7 | 97.7 | 0.891 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@768 | 81.3 | 97.2 | 97.7 | 0.878 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@512 | 61.2 | 82.7 | 86.4 | 0.696 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@512 | 83.2 | 96.7 | 98.1 | 0.89 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@512 | 80.4 | 97.2 | 97.7 | 0.873 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@256 | 52.8 | 72 | 77.1 | 0.607 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@256 | 81.3 | 96.7 | 97.7 | 0.878 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@256 | 81.3 | 97.2 | 97.7 | 0.878 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@128 | 36 | 51.9 | 62.1 | 0.432 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@128 | 78.5 | 95.8 | 97.2 | 0.852 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@128 | 78.5 | 97.2 | 97.2 | 0.857 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic embeddinggemma@768 | 75.7 | 88.3 | 93 | 0.815 | 1.4 | 100% |  |
| fused embeddinggemma@768 | 83.2 | 97.2 | 98.1 | 0.893 | 1.9 | 100% |  |
| fused-gated embeddinggemma@768 | 81.3 | 97.2 | 97.7 | 0.879 | 1.4 | 9% |  |
| semantic embeddinggemma@512 | 72.9 | 90.2 | 92.5 | 0.797 | 1.4 | 100% |  |
| fused embeddinggemma@512 | 83.6 | 97.2 | 98.1 | 0.894 | 1.9 | 100% |  |
| fused-gated embeddinggemma@512 | 81.3 | 97.2 | 97.7 | 0.878 | 1.4 | 9% |  |
| semantic embeddinggemma@256 | 73.8 | 86.9 | 90.2 | 0.795 | 1.4 | 100% |  |
| fused embeddinggemma@256 | 84.1 | 96.7 | 98.1 | 0.898 | 1.9 | 100% |  |
| fused-gated embeddinggemma@256 | 81.8 | 96.7 | 97.7 | 0.881 | 1.4 | 9% |  |
| semantic embeddinggemma@128 | 68.2 | 82.2 | 88.8 | 0.747 | 1.4 | 100% |  |
| fused embeddinggemma@128 | 85.5 | 97.2 | 97.7 | 0.905 | 1.4 | 100% |  |
| fused-gated embeddinggemma@128 | 81.3 | 97.7 | 97.7 | 0.88 | 1.4 | 9% |  |
| semantic qwen3@1024 | 61.2 | 80.8 | 85 | 0.698 | 2.8 | 100% |  |
| fused qwen3@1024 | 81.8 | 96.3 | 97.7 | 0.875 | 1.9 | 100% |  |
| fused-gated qwen3@1024 | 81.8 | 97.7 | 97.7 | 0.881 | 1.4 | 9% |  |
| semantic qwen3@768 | 59.8 | 80.4 | 85 | 0.687 | 2.8 | 100% |  |
| fused qwen3@768 | 81.8 | 96.3 | 97.7 | 0.875 | 1.9 | 100% |  |
| fused-gated qwen3@768 | 81.8 | 97.7 | 97.7 | 0.881 | 1.4 | 9% |  |
| semantic qwen3@512 | 58.9 | 77.6 | 83.2 | 0.665 | 2.3 | 100% |  |
| fused qwen3@512 | 80.8 | 96.7 | 97.7 | 0.871 | 1.9 | 100% |  |
| fused-gated qwen3@512 | 81.3 | 97.7 | 97.7 | 0.878 | 1.4 | 9% |  |
| semantic qwen3@256 | 54.2 | 74.8 | 79.4 | 0.626 | 1.9 | 100% |  |
| fused qwen3@256 | 81.3 | 96.3 | 97.7 | 0.875 | 1.9 | 100% |  |
| fused-gated qwen3@256 | 81.3 | 97.2 | 97.7 | 0.878 | 1.4 | 9% |  |
| semantic qwen3@128 | 50.5 | 71 | 75.7 | 0.584 | 0.9 | 100% |  |
| fused qwen3@128 | 82.2 | 97.2 | 97.7 | 0.883 | 1.9 | 100% |  |
| fused-gated qwen3@128 | 81.3 | 97.7 | 97.7 | 0.881 | 1.4 | 9% |  |

### Semantic calibration

Fusion weights the semantic list by its best cosine, from 0 at `floor` to 1 at `ceiling`. Measured here: floor = 25th percentile of the semantic misses' best cosine, ceiling = median of the hits'. The shipped model uses the client default (`DEFAULT_SEMANTIC_CALIBRATION`).

| Vectors | Measured floor–ceiling | Used |
| --- | --: | --: |
| bge-small@384 | 0.56–0.70 | 0.56–0.70 |
| bge-small@256 | 0.59–0.72 | 0.59–0.72 |
| bge-small@128 | 0.63–0.74 | 0.63–0.74 |
| bge-m3@1024 | 0.44–0.58 | 0.44–0.58 (client default) |
| bge-m3@768 | 0.47–0.59 | 0.47–0.59 |
| bge-m3@512 | 0.51–0.61 | 0.51–0.61 |
| bge-m3@256 | 0.44–0.54 | 0.44–0.54 |
| bge-m3@128 | 0.50–0.58 | 0.50–0.58 |
| embeddinggemma@768 | 0.31–0.45 | 0.31–0.45 |
| embeddinggemma@512 | 0.34–0.44 | 0.34–0.44 |
| embeddinggemma@256 | 0.39–0.50 | 0.39–0.50 |
| embeddinggemma@128 | 0.46–0.53 | 0.46–0.53 |
| qwen3@1024 | 0.50–0.60 | 0.50–0.60 |
| qwen3@768 | 0.53–0.61 | 0.53–0.61 |
| qwen3@512 | 0.55–0.63 | 0.55–0.63 |
| qwen3@256 | 0.57–0.64 | 0.57–0.64 |
| qwen3@128 | 0.61–0.67 | 0.61–0.67 |

## Held-out suite

734 queries in 11 locales, written and labelled by another model (not the alias author). Per locale and worst misses: [heldout.md](heldout.md).

| Mode | R@1 | R@5 | MRR | Macro R@5 |
| --- | --: | --: | --: | --: |
| alias (core + ext) | 23 | 49.2 | 0.34 | 49.8 |
| fused bge-m3@1024 | 27.2 | 54.4 | 0.386 | 54.8 |

## Recall@5 by category

| Engine | exact (26) | typo (24) | slang (33) | pop (35) | idiom (21) | intent (32) | tr (33) | negative (10) |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| alias (core + ext) | 100 | 100 | 97 | 100 | 90.5 | 93.8 | 100 | 100 |
| alias (core only, first load) | 100 | 95.8 | 78.8 | 85.7 | 71.4 | 78.1 | 93.9 | 100 |
| alias (min coverage 0.5) | 100 | 100 | 97 | 100 | 90.5 | 93.8 | 100 | 100 |
| alias (min coverage 0.6) | 100 | 95.8 | 90.9 | 100 | 90.5 | 90.6 | 100 | 90 |
| semantic bge-small@384 | 84.6 | 54.2 | 75.8 | 88.6 | 76.2 | 90.6 | 15.2 | 100 |
| fused-gated bge-small@384 | 100 | 100 | 97 | 100 | 85.7 | 93.8 | 100 | 100 |
| semantic bge-small@256 | 84.6 | 50 | 72.7 | 85.7 | 76.2 | 90.6 | 15.2 | 100 |
| fused-gated bge-small@256 | 100 | 100 | 97 | 100 | 90.5 | 93.8 | 100 | 100 |
| semantic bge-small@128 | 84.6 | 37.5 | 63.6 | 74.3 | 76.2 | 75 | 6.1 | 100 |
| fused-gated bge-small@128 | 100 | 100 | 97 | 100 | 85.7 | 93.8 | 100 | 100 |
| semantic bge-m3@1024 | 96.2 | 91.7 | 69.7 | 85.7 | 76.2 | 93.8 | 81.8 | 100 |
| fused-gated bge-m3@1024 | 100 | 100 | 97 | 100 | 85.7 | 93.8 | 100 | 100 |
| semantic bge-m3@768 | 92.3 | 95.8 | 72.7 | 85.7 | 76.2 | 93.8 | 75.8 | 100 |
| fused-gated bge-m3@768 | 100 | 100 | 97 | 100 | 85.7 | 93.8 | 100 | 100 |
| semantic bge-m3@512 | 92.3 | 95.8 | 66.7 | 77.1 | 81 | 84.4 | 81.8 | 100 |
| fused-gated bge-m3@512 | 100 | 100 | 97 | 100 | 85.7 | 93.8 | 100 | 100 |
| semantic bge-m3@256 | 84.6 | 83.3 | 54.5 | 71.4 | 66.7 | 78.1 | 60.6 | 100 |
| fused-gated bge-m3@256 | 100 | 100 | 97 | 100 | 85.7 | 93.8 | 100 | 100 |
| semantic bge-m3@128 | 57.7 | 66.7 | 45.5 | 42.9 | 52.4 | 50 | 48.5 | 70 |
| fused-gated bge-m3@128 | 100 | 95.8 | 97 | 100 | 90.5 | 93.8 | 100 | 100 |
| semantic embeddinggemma@768 | 88.5 | 91.7 | 84.8 | 94.3 | 81 | 93.8 | 78.8 | 100 |
| fused-gated embeddinggemma@768 | 100 | 100 | 97 | 100 | 85.7 | 93.8 | 100 | 100 |
| semantic embeddinggemma@512 | 88.5 | 95.8 | 90.9 | 91.4 | 85.7 | 96.9 | 78.8 | 100 |
| fused-gated embeddinggemma@512 | 100 | 100 | 97 | 100 | 85.7 | 93.8 | 100 | 100 |
| semantic embeddinggemma@256 | 92.3 | 91.7 | 72.7 | 91.4 | 81 | 96.9 | 78.8 | 100 |
| fused-gated embeddinggemma@256 | 100 | 100 | 97 | 97.1 | 85.7 | 93.8 | 100 | 100 |
| semantic embeddinggemma@128 | 88.5 | 83.3 | 75.8 | 82.9 | 81 | 93.8 | 66.7 | 100 |
| fused-gated embeddinggemma@128 | 100 | 100 | 97 | 100 | 90.5 | 93.8 | 100 | 100 |
| semantic qwen3@1024 | 92.3 | 91.7 | 75.8 | 82.9 | 71.4 | 90.6 | 57.6 | 100 |
| fused-gated qwen3@1024 | 100 | 100 | 97 | 100 | 90.5 | 93.8 | 100 | 100 |
| semantic qwen3@768 | 92.3 | 87.5 | 75.8 | 82.9 | 71.4 | 93.8 | 54.5 | 100 |
| fused-gated qwen3@768 | 100 | 100 | 97 | 100 | 90.5 | 93.8 | 100 | 100 |
| semantic qwen3@512 | 92.3 | 83.3 | 69.7 | 80 | 61.9 | 93.8 | 54.5 | 100 |
| fused-gated qwen3@512 | 100 | 100 | 97 | 100 | 90.5 | 93.8 | 100 | 100 |
| semantic qwen3@256 | 96.2 | 79.2 | 69.7 | 71.4 | 52.4 | 90.6 | 54.5 | 100 |
| fused-gated qwen3@256 | 100 | 100 | 97 | 100 | 85.7 | 93.8 | 100 | 100 |
| semantic qwen3@128 | 84.6 | 70.8 | 60.6 | 71.4 | 57.1 | 87.5 | 57.6 | 90 |
| fused-gated qwen3@128 | 100 | 100 | 97 | 100 | 90.5 | 93.8 | 100 | 100 |

## Latency

| Measure | p50 | p95 | max | n |
| --- | --: | --: | --: | --: |
| Tier 0 per keystroke (Node, this machine) | 0.07 ms | 0.46 ms | 1.95 ms | 6237 |
| Tier 0 index build (en + tr) | 188 ms |  |  | 1 |

Noise queries with a confident (≥ 0.6) alias result: 0/3.

## Sizes

| Client pack | en gz | tr gz |
| --- | --: | --: |
| core (shipped) | 179.2 KB | 170.3 KB |
| ext (loaded when idle) | 252.0 KB | 91.5 KB |
| core with ≤8 aliases | 112.8 KB | 112.6 KB |
| core with ≤16 aliases | 179.2 KB | 170.3 KB |
| core with ≤24 aliases | 243.6 KB | 190.8 KB |

| Server file | raw | gz |
| --- | --: | --: |
| vectors.bge-m3.1024.bin | 2177.5 KB | 1707.4 KB |
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

Model `@cf/baai/bge-m3` at $0.0120 / 1M tokens (listed). L0 share 90.7% (measured: eval gate, 214 queries, this run), L2 share 50% of semantic requests, L3 Cache API hit rate 10%, 1.5 requests per semantic search.

- **Search, all layers L0–L3: $0.0299 per 1M searches** (usage beyond the included quotas).
- With reaction suggestions and images: $0.753 per 1M searches.
- All-in at 10M searches / month: $8.916 / month = $0.892 per 1M (plan fee and included quotas counted).
- ⚠ image price $0.0010 per image is an assumption.
- ⚠ Analytics Engine billing has not started (it would add $0.0228 per 1M searches).

| Layer | Volume per 1M searches | $ per 1M searches |
| --- | --: | --: |
| L0 on device | 906.5k searches | $0 |
| L2 static shards | 70.1k requests | $0 |
| L3 Worker, Cache API hit | 7k requests | $0.0024 |
| L3 Worker, embed + search | 63.1k requests | $0.0275 |
| Reaction suggestions | 20k requests | $0.0222 |
| Image classification | 1k requests | $0.701 |
| **Total** | 91.1k Worker requests | **$0.753** |

| Cost line | $ per 1M searches |
| --- | --: |
| Worker requests | $0.0273 |
| Worker CPU | $0.0037 |
| Workers AI embeddings | $0.0216 |
| Image model | $0.700 |
| Analytics Engine | $0 |
| Static shards (L2), on device (L0) | $0 |

### Sensitivity (one input at a time)

| Input | Low | Base | High | $ / 1M at low | at base | at high |
| --- | --: | --: | --: | --: | --: | --: |
| deviceShare | 40% | 90.7% | 90% | $0.915 | $0.753 | $0.755 |
| shardHitShare | 0% | 50% | 80% | $0.783 | $0.753 | $0.735 |
| cacheHitRate | 0% | 10% | 50% | $0.753 | $0.753 | $0.750 |
| requestsPerSemanticSearch | 1 | 1.5 | 3 | $0.743 | $0.753 | $0.783 |
| model.tokensPerQuery | 4 | 8 | 24 | $0.750 | $0.753 | $0.765 |
| model.pricePerMTokens | 0.012 | 0.012 | 0.067 | $0.753 | $0.753 | $0.852 |
| reactions.perSearch | 0 | 0.02 | 0.1 | $0.730 | $0.753 | $0.841 |
| images.perSearch | 0 | 0.001 | 0.01 | $0.0520 | $0.753 | $7.058 |
| images.pricePerImage | 0.0002 | 0.001 | 0.005 | $0.193 | $0.753 | $3.553 |

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
| 10M | $8.916 | $0.892 |
| 100M | $73.86 | $0.739 |
| 1B | $750.75 | $0.751 |

Inputs: `cost.assumptions.json`. Recompute with `pnpm --filter @emojisense/eval cost`.

### Per engine

Same layer assumptions; query tokens ≈ chars / 4 of the formatted query.

| Engine | Tier 1 calls | $ / 1M tokens | Search $ / 1M searches | All layers $ / 1M searches |
| --- | --: | --: | --: | --: |
| fused-gated bge-small@384 | 9% | $0.0200 | $0.0448 | $0.778 |
| fused-gated bge-small@256 | 9% | $0.0200 | $0.0448 | $0.778 |
| fused-gated bge-small@128 | 9% | $0.0200 | $0.0448 | $0.778 |
| fused-gated bge-m3@1024 | 9% | $0.0120 | $0.0257 | $0.748 |
| fused-gated bge-m3@768 | 9% | $0.0120 | $0.0257 | $0.748 |
| fused-gated bge-m3@512 | 9% | $0.0120 | $0.0257 | $0.748 |
| fused-gated bge-m3@256 | 9% | $0.0120 | $0.0257 | $0.748 |
| fused-gated bge-m3@128 | 9% | $0.0120 | $0.0257 | $0.748 |
| fused-gated embeddinggemma@768 | 9% | $0.0200 ⚠ | $0.0360 | $0.769 |
| fused-gated embeddinggemma@512 | 9% | $0.0200 ⚠ | $0.0360 | $0.769 |
| fused-gated embeddinggemma@256 | 9% | $0.0200 ⚠ | $0.0360 | $0.769 |
| fused-gated embeddinggemma@128 | 9% | $0.0200 ⚠ | $0.0360 | $0.769 |
| fused-gated qwen3@1024 | 9% | $0.0120 | $0.0257 | $0.748 |
| fused-gated qwen3@768 | 9% | $0.0120 | $0.0257 | $0.748 |
| fused-gated qwen3@512 | 9% | $0.0120 | $0.0257 | $0.748 |
| fused-gated qwen3@256 | 9% | $0.0120 | $0.0257 | $0.748 |
| fused-gated qwen3@128 | 9% | $0.0120 | $0.0257 | $0.748 |

⚠ = model price is not published; `model.assumedPricePerMTokens` is used.

## Misses of the best engine (fused-gated bge-small@256)

| Query | Category | Expected | Got (top 5) |
| --- | --- | --- | --- |
| touch grass ⓡ | slang | 🌱🌿☘️🌳 | 🚶 🥾 🚶‍♂️ 🚶‍♀️ 🏕️ |
| cost an arm and a leg ⓡ | idiom | 💸💰🤑💵 | 🦾 💪 🫷 🫸 🏋️ |
| bite the bullet ⓡ | idiom | 😬💪😤 | 🫦 🍴 🦟 🚅 🧛 |
| hang in there ⓡ | intent | 💪🙏🫂❤️ | 😣 🧗 ✊️ 🧗‍♂️ 🧗‍♀️ |
| weekend vibes ⓡ | intent | 😎🏖️🍹🥳 | 🙌 🍺 🪩 👕 👖 |

ⓡ = label marked for human review in queries.jsonl.
