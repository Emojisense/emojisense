# Emojisense eval report

- Date: 2026-10-02 · pack 0.1.0 · 214 scored queries (+3 noise) · 46 labels marked for human review
- Hit = any acceptable emoji in the top k. MRR over the top 10. forbid@3 = a forbidden emoji in the top 3 (hard negatives).

## Engines

| Engine | R@1 | R@5 | R@10 | MRR | forbid@3 | Tier 1 calls | Note |
| --- | --: | --: | --: | --: | --: | --: | --- |
| alias (core + ext) | 76.6 | 96.7 | 97.2 | 0.85 | 1.4 | 0% |  |
| alias (core only, first load) | 71 | 85.5 | 86.4 | 0.77 | 1.4 | 0% |  |
| alias (core with ≤8 aliases) | 66.8 | 77.1 | 78 | 0.712 | 1.4 | 0% |  |
| alias (core with ≤16 aliases) | 71 | 85.5 | 86.4 | 0.77 | 1.4 | 0% |  |
| alias (core with ≤24 aliases) | 72 | 90.2 | 91.6 | 0.796 | 1.9 | 0% |  |
| alias (min coverage 0.5) | 75.7 | 96.3 | 98.1 | 0.844 | 1.4 | 0% |  |
| alias (min coverage 0.6) | 72.9 | 93.5 | 95.3 | 0.814 | 0.5 | 0% |  |
| semantic bge-small@384 | 56.5 | 70.6 | 73.4 | 0.623 | 2.3 | 100% |  |
| fused bge-small@384 | 78 | 96.3 | 98.6 | 0.86 | 1.9 | 100% |  |
| fused-gated bge-small@384 | 79 | 97.2 | 98.1 | 0.866 | 1.4 | 21% |  |
| semantic bge-small@256 | 53.7 | 69.2 | 73.8 | 0.606 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-small@256 | 79 | 97.2 | 98.6 | 0.863 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-small@256 | 79 | 97.7 | 98.1 | 0.866 | 1.4 | 21% | truncated, model not MRL-trained |
| semantic bge-small@128 | 47.7 | 60.7 | 65.9 | 0.533 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-small@128 | 76.2 | 97.7 | 98.6 | 0.851 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-small@128 | 77.6 | 97.2 | 98.1 | 0.858 | 1.4 | 21% | truncated, model not MRL-trained |
| semantic bge-m3@1024 | 68.7 | 85.5 | 88.8 | 0.756 | 2.3 | 100% |  |
| fused bge-m3@1024 | 83.2 | 94.9 | 97.7 | 0.885 | 1.9 | 100% |  |
| fused-gated bge-m3@1024 | 80.4 | 95.3 | 97.2 | 0.871 | 1.4 | 21% |  |
| semantic bge-m3@768 | 65.4 | 85 | 88.3 | 0.738 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@768 | 82.7 | 94.9 | 97.2 | 0.883 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@768 | 79.9 | 95.3 | 97.2 | 0.869 | 1.4 | 21% | truncated, model not MRL-trained |
| semantic bge-m3@512 | 61.2 | 82.7 | 86.4 | 0.696 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@512 | 81.8 | 95.3 | 97.7 | 0.878 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@512 | 79.4 | 95.3 | 97.2 | 0.865 | 1.4 | 21% | truncated, model not MRL-trained |
| semantic bge-m3@256 | 52.8 | 72 | 77.1 | 0.607 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@256 | 79 | 95.8 | 97.2 | 0.862 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@256 | 79.4 | 96.3 | 97.2 | 0.866 | 1.4 | 21% | truncated, model not MRL-trained |
| semantic bge-m3@128 | 36 | 51.9 | 62.1 | 0.432 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@128 | 75.2 | 93.9 | 95.3 | 0.829 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@128 | 75.7 | 94.9 | 95.3 | 0.836 | 1.4 | 21% | truncated, model not MRL-trained |
| semantic embeddinggemma@768 | 75.7 | 88.3 | 93 | 0.815 | 1.4 | 100% |  |
| fused embeddinggemma@768 | 83.2 | 97.2 | 98.6 | 0.892 | 1.9 | 100% |  |
| fused-gated embeddinggemma@768 | 80.8 | 96.7 | 98.1 | 0.877 | 1.4 | 21% |  |
| semantic embeddinggemma@512 | 72.9 | 90.2 | 92.5 | 0.797 | 1.4 | 100% |  |
| fused embeddinggemma@512 | 83.2 | 97.2 | 99.1 | 0.893 | 1.9 | 100% |  |
| fused-gated embeddinggemma@512 | 80.8 | 96.7 | 98.6 | 0.877 | 1.4 | 21% |  |
| semantic embeddinggemma@256 | 73.8 | 86.9 | 90.2 | 0.795 | 1.4 | 100% |  |
| **fused embeddinggemma@256** | 83.2 | 97.7 | 98.6 | 0.893 | 1.9 | 100% |  |
| fused-gated embeddinggemma@256 | 80.4 | 97.2 | 98.1 | 0.873 | 1.4 | 21% |  |
| semantic embeddinggemma@128 | 68.2 | 82.2 | 88.8 | 0.747 | 1.4 | 100% |  |
| fused embeddinggemma@128 | 85 | 97.2 | 98.1 | 0.898 | 1.4 | 100% |  |
| fused-gated embeddinggemma@128 | 80.8 | 97.2 | 98.1 | 0.874 | 1.4 | 21% |  |
| semantic qwen3@1024 | 61.2 | 80.8 | 85 | 0.698 | 2.8 | 100% |  |
| fused qwen3@1024 | 78 | 94.4 | 97.2 | 0.851 | 1.9 | 100% |  |
| fused-gated qwen3@1024 | 78.5 | 95.3 | 97.2 | 0.859 | 1.4 | 21% |  |
| semantic qwen3@768 | 59.8 | 80.4 | 85 | 0.687 | 2.8 | 100% |  |
| fused qwen3@768 | 79 | 94.4 | 96.7 | 0.857 | 1.9 | 100% |  |
| fused-gated qwen3@768 | 79 | 95.3 | 96.7 | 0.863 | 1.4 | 21% |  |
| semantic qwen3@512 | 58.9 | 77.6 | 83.2 | 0.665 | 2.3 | 100% |  |
| fused qwen3@512 | 78 | 95.3 | 96.7 | 0.854 | 1.9 | 100% |  |
| fused-gated qwen3@512 | 78.5 | 96.3 | 96.7 | 0.86 | 1.4 | 21% |  |
| semantic qwen3@256 | 54.2 | 74.8 | 79.4 | 0.626 | 1.9 | 100% |  |
| fused qwen3@256 | 78.5 | 95.3 | 96.7 | 0.857 | 1.9 | 100% |  |
| fused-gated qwen3@256 | 78 | 95.8 | 96.7 | 0.858 | 1.4 | 21% |  |
| semantic qwen3@128 | 50.5 | 71 | 75.7 | 0.584 | 0.9 | 100% |  |
| fused qwen3@128 | 79 | 96.3 | 97.2 | 0.862 | 1.9 | 100% |  |
| fused-gated qwen3@128 | 77.6 | 96.3 | 97.2 | 0.856 | 1.4 | 21% |  |

## Recall@5 by category

| Engine | exact (26) | typo (24) | slang (33) | pop (35) | idiom (21) | intent (32) | tr (33) | negative (10) |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| alias (core + ext) | 100 | 100 | 97 | 97.1 | 90.5 | 90.6 | 100 | 100 |
| alias (core only, first load) | 100 | 95.8 | 81.8 | 77.1 | 71.4 | 78.1 | 90.9 | 100 |
| alias (min coverage 0.5) | 100 | 100 | 97 | 94.3 | 90.5 | 90.6 | 100 | 100 |
| alias (min coverage 0.6) | 100 | 95.8 | 93.9 | 91.4 | 90.5 | 87.5 | 97 | 90 |
| semantic bge-small@384 | 84.6 | 54.2 | 75.8 | 88.6 | 76.2 | 90.6 | 15.2 | 100 |
| fused-gated bge-small@384 | 100 | 100 | 100 | 100 | 85.7 | 93.8 | 97 | 100 |
| semantic bge-small@256 | 84.6 | 50 | 72.7 | 85.7 | 76.2 | 90.6 | 15.2 | 100 |
| fused-gated bge-small@256 | 100 | 100 | 100 | 100 | 90.5 | 93.8 | 97 | 100 |
| semantic bge-small@128 | 84.6 | 37.5 | 63.6 | 74.3 | 76.2 | 75 | 6.1 | 100 |
| fused-gated bge-small@128 | 100 | 100 | 100 | 100 | 85.7 | 93.8 | 97 | 100 |
| semantic bge-m3@1024 | 96.2 | 91.7 | 69.7 | 85.7 | 76.2 | 93.8 | 81.8 | 100 |
| fused-gated bge-m3@1024 | 100 | 100 | 97 | 91.4 | 85.7 | 93.8 | 97 | 100 |
| semantic bge-m3@768 | 92.3 | 95.8 | 72.7 | 85.7 | 76.2 | 93.8 | 75.8 | 100 |
| fused-gated bge-m3@768 | 100 | 100 | 97 | 91.4 | 85.7 | 93.8 | 97 | 100 |
| semantic bge-m3@512 | 92.3 | 95.8 | 66.7 | 77.1 | 81 | 84.4 | 81.8 | 100 |
| fused-gated bge-m3@512 | 100 | 100 | 97 | 94.3 | 85.7 | 90.6 | 97 | 100 |
| semantic bge-m3@256 | 84.6 | 83.3 | 54.5 | 71.4 | 66.7 | 78.1 | 60.6 | 100 |
| fused-gated bge-m3@256 | 100 | 100 | 97 | 97.1 | 90.5 | 90.6 | 97 | 100 |
| semantic bge-m3@128 | 57.7 | 66.7 | 45.5 | 42.9 | 52.4 | 50 | 48.5 | 70 |
| fused-gated bge-m3@128 | 100 | 91.7 | 97 | 94.3 | 90.5 | 90.6 | 97 | 100 |
| semantic embeddinggemma@768 | 88.5 | 91.7 | 84.8 | 94.3 | 81 | 93.8 | 78.8 | 100 |
| fused-gated embeddinggemma@768 | 100 | 100 | 100 | 94.3 | 85.7 | 93.8 | 100 | 100 |
| semantic embeddinggemma@512 | 88.5 | 95.8 | 90.9 | 91.4 | 85.7 | 96.9 | 78.8 | 100 |
| fused-gated embeddinggemma@512 | 100 | 100 | 100 | 94.3 | 85.7 | 93.8 | 100 | 100 |
| semantic embeddinggemma@256 | 92.3 | 91.7 | 72.7 | 91.4 | 81 | 96.9 | 78.8 | 100 |
| fused-gated embeddinggemma@256 | 100 | 100 | 100 | 97.1 | 85.7 | 93.8 | 100 | 100 |
| semantic embeddinggemma@128 | 88.5 | 83.3 | 75.8 | 82.9 | 81 | 93.8 | 66.7 | 100 |
| fused-gated embeddinggemma@128 | 100 | 100 | 97 | 100 | 90.5 | 93.8 | 97 | 100 |
| semantic qwen3@1024 | 92.3 | 91.7 | 75.8 | 82.9 | 71.4 | 90.6 | 57.6 | 100 |
| fused-gated qwen3@1024 | 100 | 100 | 97 | 91.4 | 90.5 | 90.6 | 97 | 100 |
| semantic qwen3@768 | 92.3 | 87.5 | 75.8 | 82.9 | 71.4 | 93.8 | 54.5 | 100 |
| fused-gated qwen3@768 | 100 | 100 | 97 | 91.4 | 90.5 | 90.6 | 97 | 100 |
| semantic qwen3@512 | 92.3 | 83.3 | 69.7 | 80 | 61.9 | 93.8 | 54.5 | 100 |
| fused-gated qwen3@512 | 100 | 100 | 97 | 97.1 | 90.5 | 90.6 | 97 | 100 |
| semantic qwen3@256 | 96.2 | 79.2 | 69.7 | 71.4 | 52.4 | 90.6 | 54.5 | 100 |
| fused-gated qwen3@256 | 100 | 100 | 97 | 97.1 | 85.7 | 90.6 | 97 | 100 |
| semantic qwen3@128 | 84.6 | 70.8 | 60.6 | 71.4 | 57.1 | 87.5 | 57.6 | 90 |
| fused-gated qwen3@128 | 100 | 100 | 97 | 97.1 | 90.5 | 90.6 | 97 | 100 |

## Latency

| Measure | p50 | p95 | max | n |
| --- | --: | --: | --: | --: |
| Tier 0 per keystroke (Node, this machine) | 0.16 ms | 12 ms | 506 ms | 6237 |
| Tier 0 index build (en + tr) | 3404 ms |  |  | 1 |

Noise queries with a confident (≥ 0.6) alias result: 0/3.

## Sizes

| Client pack | en gz | tr gz |
| --- | --: | --: |
| core (shipped) | 179.1 KB | 168.3 KB |
| ext (loaded when idle) | 247.3 KB | 89.9 KB |
| core with ≤8 aliases | 112.4 KB | 112.4 KB |
| core with ≤16 aliases | 179.1 KB | 168.3 KB |
| core with ≤24 aliases | 242.2 KB | 187.2 KB |

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

Model `@cf/baai/bge-m3` at $0.0120 / 1M tokens (listed). L0 share 79% (measured: eval gate, 214 queries, this run), L2 share 50% of semantic requests, L3 Cache API hit rate 10%, 1.5 requests per semantic search.

- **Search, all layers L0–L3: $0.0672 per 1M searches** (usage beyond the included quotas).
- With reaction suggestions and images: $0.790 per 1M searches.
- All-in at 10M searches / month: $8.992 / month = $0.899 per 1M (plan fee and included quotas counted).
- ⚠ image price $0.0010 per image is an assumption.
- ⚠ Analytics Engine billing has not started (it would add $0.0447 per 1M searches).

| Layer | Volume per 1M searches | $ per 1M searches |
| --- | --: | --: |
| L0 on device | 789.7k searches | $0 |
| L2 static shards | 157.7k requests | $0 |
| L3 Worker, Cache API hit | 15.8k requests | $0.0054 |
| L3 Worker, embed + search | 141.9k requests | $0.0619 |
| Reaction suggestions | 20k requests | $0.0222 |
| Image classification | 1k requests | $0.701 |
| **Total** | 178.7k Worker requests | **$0.790** |

| Cost line | $ per 1M searches |
| --- | --: |
| Worker requests | $0.0536 |
| Worker CPU | $0.0072 |
| Workers AI embeddings | $0.0292 |
| Image model | $0.700 |
| Analytics Engine | $0 |
| Static shards (L2), on device (L0) | $0 |

### Sensitivity (one input at a time)

| Input | Low | Base | High | $ / 1M at low | at base | at high |
| --- | --: | --: | --: | --: | --: | --: |
| deviceShare | 40% | 79% | 90% | $0.915 | $0.790 | $0.755 |
| shardHitShare | 0% | 50% | 80% | $0.857 | $0.790 | $0.750 |
| cacheHitRate | 0% | 10% | 50% | $0.792 | $0.790 | $0.784 |
| requestsPerSemanticSearch | 1 | 1.5 | 3 | $0.768 | $0.790 | $0.857 |
| model.tokensPerQuery | 4 | 8 | 24 | $0.783 | $0.790 | $0.817 |
| model.pricePerMTokens | 0.012 | 0.012 | 0.067 | $0.790 | $0.790 | $0.924 |
| reactions.perSearch | 0 | 0.02 | 0.1 | $0.768 | $0.790 | $0.879 |
| images.perSearch | 0 | 0.001 | 0.01 | $0.0894 | $0.790 | $7.095 |
| images.pricePerImage | 0.0002 | 0.001 | 0.005 | $0.230 | $0.790 | $3.590 |

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
| 10M | $8.992 | $0.899 |
| 100M | $77.10 | $0.771 |
| 1B | $788.11 | $0.788 |

Inputs: `cost.assumptions.json`. Recompute with `pnpm --filter @emojisense/eval cost`.

### Per engine

Same layer assumptions; query tokens ≈ chars / 4 of the formatted query.

| Engine | Tier 1 calls | $ / 1M tokens | Search $ / 1M searches | All layers $ / 1M searches |
| --- | --: | --: | --: | --: |
| fused-gated bge-small@384 | 21% | $0.0200 | $0.101 | $0.834 |
| fused-gated bge-small@256 | 21% | $0.0200 | $0.101 | $0.834 |
| fused-gated bge-small@128 | 21% | $0.0200 | $0.101 | $0.834 |
| fused-gated bge-m3@1024 | 21% | $0.0120 | $0.0577 | $0.780 |
| fused-gated bge-m3@768 | 21% | $0.0120 | $0.0577 | $0.780 |
| fused-gated bge-m3@512 | 21% | $0.0120 | $0.0577 | $0.780 |
| fused-gated bge-m3@256 | 21% | $0.0120 | $0.0577 | $0.780 |
| fused-gated bge-m3@128 | 21% | $0.0120 | $0.0577 | $0.780 |
| fused-gated embeddinggemma@768 | 21% | $0.0200 ⚠ | $0.0810 | $0.814 |
| fused-gated embeddinggemma@512 | 21% | $0.0200 ⚠ | $0.0810 | $0.814 |
| fused-gated embeddinggemma@256 | 21% | $0.0200 ⚠ | $0.0810 | $0.814 |
| fused-gated embeddinggemma@128 | 21% | $0.0200 ⚠ | $0.0810 | $0.814 |
| fused-gated qwen3@1024 | 21% | $0.0120 | $0.0577 | $0.780 |
| fused-gated qwen3@768 | 21% | $0.0120 | $0.0577 | $0.780 |
| fused-gated qwen3@512 | 21% | $0.0120 | $0.0577 | $0.780 |
| fused-gated qwen3@256 | 21% | $0.0120 | $0.0577 | $0.780 |
| fused-gated qwen3@128 | 21% | $0.0120 | $0.0577 | $0.780 |

⚠ = model price is not published; `model.assumedPricePerMTokens` is used.

## Misses of the best engine (fused embeddinggemma@256)

| Query | Category | Expected | Got (top 5) |
| --- | --- | --- | --- |
| minecraft ⓡ | pop | ⛏️🧱🟩🎮 | 🟫 🪵 🪏 🪎 ⚒️ |
| break a leg | idiom | 🍀🎭🤞🌟 | 🦵 🦿 🍗 🩼 ⛓️‍💥 |
| cost an arm and a leg ⓡ | idiom | 💸💰🤑💵 | 🦴 🦾 🩼 🦵 🤏 |
| bite the bullet ⓡ | idiom | 😬💪😤 | 🫦 🚅 🥕 🎯 💉 |
| hang in there ⓡ | intent | 💪🙏🫂❤️ | 😣 🧗 ✊️ 🤙 🧗‍♂️ |

ⓡ = label marked for human review in queries.jsonl.
