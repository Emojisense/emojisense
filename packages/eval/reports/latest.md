# Emojisense eval report

- Date: 2026-10-03 · pack 0.1.0 · 214 scored queries (+3 noise) · 46 labels marked for human review
- Hit = any acceptable emoji in the top k. MRR over the top 10. forbid@3 = a forbidden emoji in the top 3 (hard negatives).

## Engines

| Engine | R@1 | R@5 | R@10 | MRR | forbid@3 | Tier 1 calls | Note |
| --- | --: | --: | --: | --: | --: | --: | --- |
| alias (core + ext) | 85 | 98.6 | 99.1 | 0.909 | 1.9 | 0% |  |
| alias (core only, first load) | 76.6 | 87.9 | 88.8 | 0.818 | 1.9 | 0% |  |
| alias (core with ≤8 aliases) | 69.6 | 78 | 79.4 | 0.735 | 1.9 | 0% |  |
| alias (core with ≤16 aliases) | 76.6 | 87.9 | 88.8 | 0.818 | 1.9 | 0% |  |
| alias (core with ≤24 aliases) | 79.4 | 93.5 | 95.8 | 0.857 | 1.9 | 0% |  |
| alias (min coverage 0.5) | 85 | 98.6 | 99.5 | 0.909 | 1.4 | 0% |  |
| alias (min coverage 0.6) | 82.7 | 96.3 | 97.7 | 0.885 | 0.5 | 0% |  |
| semantic bge-small@384 | 56.5 | 70.6 | 73.4 | 0.623 | 2.3 | 100% |  |
| fused bge-small@384 | 87.4 | 98.6 | 99.5 | 0.924 | 1.9 | 100% |  |
| fused-gated bge-small@384 | 86.4 | 98.6 | 99.1 | 0.917 | 1.9 | 9% |  |
| semantic bge-small@256 | 53.7 | 69.2 | 73.8 | 0.606 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-small@256 | 87.4 | 99.1 | 99.5 | 0.923 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-small@256 | 86.4 | 98.6 | 99.1 | 0.917 | 1.9 | 9% | truncated, model not MRL-trained |
| semantic bge-small@128 | 47.7 | 60.7 | 65.9 | 0.533 | 1.4 | 100% | truncated, model not MRL-trained |
| **fused bge-small@128** | 85.5 | 99.5 | 99.5 | 0.914 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-small@128 | 86 | 98.6 | 99.1 | 0.912 | 1.9 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@1024 | 71 | 85.5 | 92.5 | 0.78 | 2.3 | 100% |  |
| fused bge-m3@1024 | 88.8 | 98.6 | 99.1 | 0.93 | 1.9 | 100% |  |
| fused-gated bge-m3@1024 | 86.9 | 98.6 | 99.1 | 0.92 | 1.9 | 9% |  |
| semantic bge-m3@768 | 67.3 | 87.4 | 89.7 | 0.757 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@768 | 86.9 | 98.6 | 99.5 | 0.921 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@768 | 86 | 98.6 | 99.1 | 0.914 | 1.9 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@512 | 63.1 | 83.6 | 88.3 | 0.713 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@512 | 88.3 | 98.6 | 99.5 | 0.929 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@512 | 86 | 98.6 | 99.1 | 0.914 | 1.9 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@256 | 51.9 | 74.8 | 79.4 | 0.61 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@256 | 86.9 | 98.6 | 99.1 | 0.918 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@256 | 86 | 98.6 | 99.1 | 0.914 | 1.9 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@128 | 36.4 | 53.7 | 63.1 | 0.441 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@128 | 84.6 | 97.7 | 98.6 | 0.903 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@128 | 84.6 | 98.1 | 98.6 | 0.902 | 1.9 | 9% | truncated, model not MRL-trained |
| semantic embeddinggemma@768 | 76.6 | 91.6 | 95.8 | 0.824 | 1.9 | 100% |  |
| fused embeddinggemma@768 | 88.8 | 98.6 | 99.5 | 0.932 | 1.9 | 100% |  |
| fused-gated embeddinggemma@768 | 86.9 | 98.6 | 99.1 | 0.92 | 1.9 | 9% |  |
| semantic embeddinggemma@512 | 76.6 | 90.7 | 94.9 | 0.824 | 1.4 | 100% |  |
| fused embeddinggemma@512 | 87.9 | 99.1 | 99.5 | 0.929 | 1.9 | 100% |  |
| fused-gated embeddinggemma@512 | 86 | 98.6 | 99.1 | 0.915 | 1.9 | 9% |  |
| semantic embeddinggemma@256 | 74.3 | 88.3 | 92.1 | 0.801 | 1.4 | 100% |  |
| fused embeddinggemma@256 | 87.9 | 98.6 | 99.1 | 0.926 | 1.9 | 100% |  |
| fused-gated embeddinggemma@256 | 86 | 98.6 | 99.1 | 0.914 | 1.9 | 9% |  |
| semantic embeddinggemma@128 | 67.8 | 82.2 | 88.8 | 0.744 | 1.4 | 100% |  |
| fused embeddinggemma@128 | 88.8 | 98.6 | 99.1 | 0.931 | 1.4 | 100% |  |
| fused-gated embeddinggemma@128 | 86 | 98.6 | 99.1 | 0.914 | 1.9 | 9% |  |
| semantic qwen3@1024 | 67.8 | 83.2 | 87.9 | 0.744 | 3.3 | 100% |  |
| fused qwen3@1024 | 86 | 99.1 | 99.5 | 0.915 | 1.9 | 100% |  |
| fused-gated qwen3@1024 | 85.5 | 98.6 | 99.1 | 0.911 | 1.9 | 9% |  |
| semantic qwen3@768 | 59.8 | 80.4 | 85 | 0.687 | 2.8 | 100% |  |
| fused qwen3@768 | 86 | 98.6 | 99.5 | 0.915 | 1.9 | 100% |  |
| fused-gated qwen3@768 | 86 | 98.6 | 99.1 | 0.914 | 1.9 | 9% |  |
| semantic qwen3@512 | 63.1 | 80.4 | 85 | 0.7 | 2.8 | 100% |  |
| fused qwen3@512 | 84.1 | 98.6 | 99.5 | 0.906 | 1.9 | 100% |  |
| fused-gated qwen3@512 | 85.5 | 98.6 | 99.1 | 0.911 | 1.9 | 9% |  |
| semantic qwen3@256 | 63.6 | 79.4 | 83.2 | 0.702 | 2.8 | 100% |  |
| fused qwen3@256 | 84.6 | 99.1 | 99.5 | 0.908 | 1.9 | 100% |  |
| fused-gated qwen3@256 | 85.5 | 98.6 | 99.1 | 0.911 | 1.9 | 9% |  |
| semantic qwen3@128 | 50.5 | 71 | 75.7 | 0.584 | 0.9 | 100% |  |
| fused qwen3@128 | 86 | 98.6 | 99.5 | 0.918 | 1.9 | 100% |  |
| fused-gated qwen3@128 | 85 | 98.6 | 99.1 | 0.909 | 1.9 | 9% |  |

### Semantic calibration

Fusion weights the semantic list by its best cosine, from 0 at `floor` to 1 at `ceiling`. Measured here: floor = 25th percentile of the semantic misses' best cosine, ceiling = median of the hits'. The shipped model uses the client default (`DEFAULT_SEMANTIC_CALIBRATION`).

| Vectors | Measured floor–ceiling | Used |
| --- | --: | --: |
| bge-small@384 | 0.56–0.70 | 0.56–0.70 |
| bge-small@256 | 0.59–0.72 | 0.59–0.72 |
| bge-small@128 | 0.63–0.74 | 0.63–0.74 |
| bge-m3@1024 | 0.46–0.60 | 0.46–0.60 |
| bge-m3@768 | 0.47–0.59 | 0.47–0.59 |
| bge-m3@512 | 0.51–0.61 | 0.51–0.61 |
| bge-m3@256 | 0.44–0.54 | 0.44–0.54 |
| bge-m3@128 | 0.51–0.58 | 0.51–0.58 |
| embeddinggemma@768 | 0.35–0.53 | 0.35–0.53 (client default) |
| embeddinggemma@512 | 0.38–0.54 | 0.38–0.54 |
| embeddinggemma@256 | 0.45–0.58 | 0.45–0.58 |
| embeddinggemma@128 | 0.47–0.54 | 0.47–0.54 |
| qwen3@1024 | 0.52–0.65 | 0.52–0.65 |
| qwen3@768 | 0.53–0.61 | 0.53–0.61 |
| qwen3@512 | 0.55–0.67 | 0.55–0.67 |
| qwen3@256 | 0.59–0.69 | 0.59–0.69 |
| qwen3@128 | 0.61–0.67 | 0.61–0.67 |

## Held-out suite

734 queries in 11 locales, written and labelled by another model (not the alias author). Per locale and worst misses: [heldout.md](heldout.md).

| Mode | R@1 | R@5 | MRR | Macro R@5 |
| --- | --: | --: | --: | --: |
| alias (core + ext) | 32.2 | 57.1 | 0.427 | 57.5 |
| fused embeddinggemma@768 | 36.4 | 64.9 | 0.486 | 65.4 |

## Recall@5 by category

| Engine | exact (26) | typo (24) | slang (33) | pop (35) | idiom (21) | intent (32) | tr (33) | negative (10) |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| alias (core + ext) | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| alias (core only, first load) | 100 | 95.8 | 78.8 | 85.7 | 76.2 | 78.1 | 97 | 100 |
| alias (min coverage 0.5) | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| alias (min coverage 0.6) | 100 | 95.8 | 93.9 | 97.1 | 95.2 | 93.8 | 100 | 90 |
| semantic bge-small@384 | 84.6 | 54.2 | 75.8 | 88.6 | 76.2 | 90.6 | 15.2 | 100 |
| fused-gated bge-small@384 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-small@256 | 84.6 | 50 | 72.7 | 85.7 | 76.2 | 90.6 | 15.2 | 100 |
| fused-gated bge-small@256 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-small@128 | 84.6 | 37.5 | 63.6 | 74.3 | 76.2 | 75 | 6.1 | 100 |
| fused-gated bge-small@128 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@1024 | 92.3 | 95.8 | 81.8 | 80 | 76.2 | 87.5 | 81.8 | 100 |
| fused-gated bge-m3@1024 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@768 | 92.3 | 95.8 | 72.7 | 85.7 | 76.2 | 93.8 | 90.9 | 100 |
| fused-gated bge-m3@768 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@512 | 92.3 | 95.8 | 66.7 | 77.1 | 81 | 84.4 | 87.9 | 100 |
| fused-gated bge-m3@512 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@256 | 84.6 | 83.3 | 54.5 | 71.4 | 66.7 | 78.1 | 78.8 | 100 |
| fused-gated bge-m3@256 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@128 | 57.7 | 66.7 | 45.5 | 42.9 | 52.4 | 50 | 60.6 | 70 |
| fused-gated bge-m3@128 | 100 | 95.8 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic embeddinggemma@768 | 92.3 | 95.8 | 90.9 | 97.1 | 81 | 90.6 | 87.9 | 100 |
| fused-gated embeddinggemma@768 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic embeddinggemma@512 | 92.3 | 95.8 | 93.9 | 91.4 | 85.7 | 96.9 | 75.8 | 100 |
| fused-gated embeddinggemma@512 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic embeddinggemma@256 | 88.5 | 95.8 | 87.9 | 91.4 | 81 | 96.9 | 72.7 | 100 |
| fused-gated embeddinggemma@256 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic embeddinggemma@128 | 88.5 | 83.3 | 75.8 | 82.9 | 81 | 93.8 | 66.7 | 100 |
| fused-gated embeddinggemma@128 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic qwen3@1024 | 96.2 | 87.5 | 78.8 | 82.9 | 76.2 | 81.3 | 75.8 | 100 |
| fused-gated qwen3@1024 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic qwen3@768 | 92.3 | 87.5 | 75.8 | 82.9 | 71.4 | 93.8 | 54.5 | 100 |
| fused-gated qwen3@768 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic qwen3@512 | 96.2 | 87.5 | 72.7 | 77.1 | 76.2 | 87.5 | 63.6 | 100 |
| fused-gated qwen3@512 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic qwen3@256 | 92.3 | 83.3 | 75.8 | 82.9 | 71.4 | 87.5 | 57.6 | 100 |
| fused-gated qwen3@256 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic qwen3@128 | 84.6 | 70.8 | 60.6 | 71.4 | 57.1 | 87.5 | 57.6 | 90 |
| fused-gated qwen3@128 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |

## Latency

| Measure | p50 | p95 | max | n |
| --- | --: | --: | --: | --: |
| Tier 0 per keystroke (Node, this machine) | 0.08 ms | 0.69 ms | 19 ms | 6237 |
| Tier 0 index build (en + tr) | 214 ms |  |  | 1 |

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
| vectors.bge-m3.1024.<locale>.bin × 10 | 21775.0 KB | 17018.0 KB |
| vectors.bge-m3.1024.bin | 2177.5 KB | 1710.2 KB |
| vectors.bge-m3.128.<locale>.bin × 10 | 2934.1 KB | 2674.7 KB |
| vectors.bge-m3.128.bin | 293.4 KB | 266.7 KB |
| vectors.bge-m3.256.<locale>.bin × 10 | 5625.6 KB | 5181.3 KB |
| vectors.bge-m3.256.bin | 562.6 KB | 516.9 KB |
| vectors.bge-m3.512.<locale>.bin × 10 | 11008.8 KB | 8594.5 KB |
| vectors.bge-m3.512.bin | 1100.9 KB | 861.1 KB |
| vectors.bge-m3.768.<locale>.bin × 10 | 16391.9 KB | 12828.9 KB |
| vectors.bge-m3.768.bin | 1639.2 KB | 1286.1 KB |
| vectors.bge-small.128.bin | 293.4 KB | 226.2 KB |
| vectors.bge-small.256.bin | 562.6 KB | 442.7 KB |
| vectors.bge-small.384.bin | 831.7 KB | 658.2 KB |
| vectors.embeddinggemma.128.<locale>.bin × 10 | 2934.2 KB | 2645.1 KB |
| vectors.embeddinggemma.128.bin | 293.4 KB | 262.5 KB |
| vectors.embeddinggemma.256.<locale>.bin × 10 | 5625.8 KB | 5124.3 KB |
| vectors.embeddinggemma.256.bin | 562.6 KB | 504.9 KB |
| vectors.embeddinggemma.512.<locale>.bin × 10 | 11008.9 KB | 10059.7 KB |
| vectors.embeddinggemma.512.bin | 1100.9 KB | 992.5 KB |
| vectors.embeddinggemma.768.<locale>.bin × 10 | 16392.0 KB | 14975.7 KB |
| vectors.embeddinggemma.768.bin | 1639.2 KB | 1479.7 KB |
| vectors.qwen3.1024.<locale>.bin × 10 | 21775.2 KB | 19582.6 KB |
| vectors.qwen3.1024.bin | 2177.5 KB | 1968.5 KB |
| vectors.qwen3.128.bin | 293.4 KB | 264.3 KB |
| vectors.qwen3.256.<locale>.bin × 10 | 5625.8 KB | 5033.4 KB |
| vectors.qwen3.256.bin | 562.6 KB | 506.0 KB |
| vectors.qwen3.512.<locale>.bin × 10 | 11008.9 KB | 9913.5 KB |
| vectors.qwen3.512.bin | 1100.9 KB | 997.2 KB |
| vectors.qwen3.768.bin | 1639.2 KB | 1478.9 KB |

## Layered cost per 1M searches

Model `@cf/google/embeddinggemma-300m` at $0.0670 / 1M tokens (assumed). L0 share 91.1% (measured: eval gate, 214 queries, this run), L2 share 50% of semantic requests, L3 Cache API hit rate 10%, 1.5 requests per semantic search.

- **Search, all layers L0–L3: $0.161 per 1M searches** (usage beyond the included quotas).
- With reaction suggestions and images: $0.338 per 1M searches.
- All-in at 10M searches / month: $5.000 / month = $0.500 per 1M (plan fee and included quotas counted).
- ⚠ model price is not published; $0.0670 / 1M tokens assumed.
- ⚠ image price $0.0001 per image is an assumption.
- ⚠ Analytics Engine billing has not started (it would add $0.0219 per 1M searches).

| Layer | Volume per 1M searches | $ per 1M searches |
| --- | --: | --: |
| L0 on device | 911.2k searches | $0 |
| L2 shards on the CDN | 66.6k requests | $0 |
| L3 Worker, Cache API hit | 6.7k requests | $0.0129 |
| L3 Worker, embed + search | 59.9k requests | $0.148 |
| Reaction suggestions | 20k requests | $0.105 |
| Image classification | 1k requests | $0.0721 |
| **Total** | 87.6k Worker requests | **$0.338** |

| Cost line | $ per 1M searches |
| --- | --: |
| Worker requests | $0.0263 |
| Worker CPU | $0.0036 |
| Workers AI embeddings | $0.119 |
| Image model | $0.0700 |
| Analytics Engine | $0 |
| Workers Logs | $0.0526 |
| D1 query counts | $0.0666 |
| Shards on the CDN (L2), on device (L0) | $0 |

### Sensitivity (one input at a time)

| Input | Low | Base | High | $ / 1M at low | at base | at high |
| --- | --: | --: | --: | --: | --: | --: |
| deviceShare | 40% | 91.1% | 90% | $1.267 | $0.338 | $0.358 |
| shardHitShare | 0% | 50% | 80% | $0.499 | $0.338 | $0.241 |
| cacheHitRate | 0% | 10% | 50% | $0.342 | $0.338 | $0.324 |
| requestsPerSemanticSearch | 1 | 1.5 | 3 | $0.284 | $0.338 | $0.499 |
| model.tokensPerQuery | 4 | 8 | 24 | $0.322 | $0.338 | $0.402 |
| model.pricePerMTokens | 0.012 | 0.067 | 0.2 | $0.240 | $0.338 | $0.574 |
| reactions.perSearch | 0 | 0.02 | 0.1 | $0.233 | $0.338 | $0.756 |
| images.perSearch | 0 | 0.001 | 0.01 | $0.266 | $0.338 | $0.987 |
| images.pricePerImage | 0.00005 | 0.0001 | 0.001 | $0.303 | $0.338 | $0.968 |

### L0 share × L2 share ($ per 1M searches)

| L0 ↓ / L2 → | 0% | 25% | 50% | 75% | 90% |
| --- | --: | --: | --: | --: | --: |
| 40% | $2.357 | $1.812 | $1.267 | $0.722 | $0.395 |
| 60% | $1.630 | $1.267 | $0.903 | $0.540 | $0.322 |
| 80% | $0.903 | $0.722 | $0.540 | $0.358 | $0.249 |
| 90% | $0.540 | $0.449 | $0.358 | $0.268 | $0.213 |

### All-in by volume

| Searches / month | $ / month | $ per 1M searches |
| --- | --: | --: |
| 1M | $5.000 | $5.000 |
| 10M | $5.000 | $0.500 |
| 100M | $20.60 | $0.206 |
| 1B | $274.09 | $0.274 |

Inputs: `cost.assumptions.json`. Recompute with `pnpm --filter @emojisense/eval cost`.

### Per engine

Same layer assumptions; query tokens ≈ chars / 4 of the formatted query.

| Engine | Tier 1 calls | $ / 1M tokens | Search $ / 1M searches | All layers $ / 1M searches |
| --- | --: | --: | --: | --: |
| fused-gated bge-small@384 | 9% | $0.0200 | $0.149 | $0.265 |
| fused-gated bge-small@256 | 9% | $0.0200 | $0.149 | $0.265 |
| fused-gated bge-small@128 | 9% | $0.0200 | $0.149 | $0.265 |
| fused-gated bge-m3@1024 | 9% | $0.0120 | $0.131 | $0.236 |
| fused-gated bge-m3@768 | 9% | $0.0120 | $0.131 | $0.236 |
| fused-gated bge-m3@512 | 9% | $0.0120 | $0.131 | $0.236 |
| fused-gated bge-m3@256 | 9% | $0.0120 | $0.131 | $0.236 |
| fused-gated bge-m3@128 | 9% | $0.0120 | $0.131 | $0.236 |
| fused-gated embeddinggemma@768 | 9% | $0.0670 ⚠ | $0.168 | $0.345 |
| fused-gated embeddinggemma@512 | 9% | $0.0670 ⚠ | $0.168 | $0.345 |
| fused-gated embeddinggemma@256 | 9% | $0.0670 ⚠ | $0.168 | $0.345 |
| fused-gated embeddinggemma@128 | 9% | $0.0670 ⚠ | $0.168 | $0.345 |
| fused-gated qwen3@1024 | 9% | $0.0120 | $0.131 | $0.236 |
| fused-gated qwen3@768 | 9% | $0.0120 | $0.131 | $0.236 |
| fused-gated qwen3@512 | 9% | $0.0120 | $0.131 | $0.236 |
| fused-gated qwen3@256 | 9% | $0.0120 | $0.131 | $0.236 |
| fused-gated qwen3@128 | 9% | $0.0120 | $0.131 | $0.236 |

⚠ = model price is not published; `model.assumedPricePerMTokens` is used.

## Misses of the best engine (fused bge-small@128)

| Query | Category | Expected | Got (top 5) |
| --- | --- | --- | --- |
| bite the bullet ⓡ | idiom | 😬💪😤 | 🍴 🍔 🫦 🦟 🚅 |

ⓡ = label marked for human review in queries.jsonl.
