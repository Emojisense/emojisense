# Emojisense eval report

- Date: 2026-10-02 · pack 0.1.0 · 214 scored queries (+3 noise) · 46 labels marked for human review
- Hit = any acceptable emoji in the top k. MRR over the top 10. forbid@3 = a forbidden emoji in the top 3 (hard negatives).

## Engines

| Engine | R@1 | R@5 | R@10 | MRR | forbid@3 | Tier 1 calls | Note |
| --- | --: | --: | --: | --: | --: | --: | --- |
| alias (core + ext) | 85 | 98.6 | 99.1 | 0.908 | 1.4 | 0% |  |
| alias (core only, first load) | 76.2 | 87.4 | 88.3 | 0.813 | 1.4 | 0% |  |
| alias (core with ≤8 aliases) | 69.2 | 78 | 79.4 | 0.731 | 1.4 | 0% |  |
| alias (core with ≤16 aliases) | 76.2 | 87.4 | 88.3 | 0.813 | 1.4 | 0% |  |
| alias (core with ≤24 aliases) | 79.4 | 93 | 95.3 | 0.855 | 1.9 | 0% |  |
| alias (min coverage 0.5) | 85.5 | 98.6 | 99.5 | 0.913 | 1.4 | 0% |  |
| alias (min coverage 0.6) | 83.2 | 96.3 | 97.7 | 0.889 | 0.5 | 0% |  |
| semantic bge-m3@1024 | 75.2 | 90.2 | 93 | 0.81 | 2.3 | 100% |  |
| fused bge-m3@1024 | 87.4 | 98.6 | 99.5 | 0.922 | 1.9 | 100% |  |
| fused-gated bge-m3@1024 | 86 | 98.6 | 99.1 | 0.912 | 1.4 | 9% |  |
| semantic bge-m3@768 | 70.1 | 86.4 | 92.1 | 0.775 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@768 | 87.9 | 98.6 | 99.5 | 0.925 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@768 | 86 | 98.6 | 99.1 | 0.912 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@512 | 67.8 | 83.2 | 87.9 | 0.745 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@512 | 87.4 | 98.6 | 99.5 | 0.923 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@512 | 86 | 98.6 | 99.1 | 0.912 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@256 | 56.1 | 77.6 | 81.8 | 0.647 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@256 | 86.4 | 98.6 | 99.5 | 0.917 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@256 | 86 | 98.6 | 99.1 | 0.912 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic bge-m3@128 | 40.2 | 58.9 | 66.4 | 0.48 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@128 | 86 | 98.1 | 98.6 | 0.911 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@128 | 85 | 98.1 | 98.6 | 0.905 | 1.4 | 9% | truncated, model not MRL-trained |
| semantic embeddinggemma@768 | 79 | 92.1 | 96.3 | 0.845 | 1.9 | 100% |  |
| **fused embeddinggemma@768** | 89.3 | 99.1 | 99.1 | 0.936 | 1.9 | 100% |  |
| fused-gated embeddinggemma@768 | 86.4 | 98.6 | 99.1 | 0.917 | 1.4 | 9% |  |
| semantic embeddinggemma@512 | 78 | 92.1 | 95.3 | 0.838 | 1.9 | 100% |  |
| fused embeddinggemma@512 | 87.9 | 99.1 | 99.5 | 0.927 | 1.9 | 100% |  |
| fused-gated embeddinggemma@512 | 86 | 98.6 | 99.1 | 0.914 | 1.4 | 9% |  |
| semantic embeddinggemma@256 | 79 | 89.3 | 92.5 | 0.831 | 1.4 | 100% |  |
| fused embeddinggemma@256 | 88.8 | 98.6 | 99.5 | 0.932 | 1.9 | 100% |  |
| fused-gated embeddinggemma@256 | 86 | 98.6 | 99.1 | 0.913 | 1.4 | 9% |  |
| semantic embeddinggemma@128 | 71 | 86 | 89.3 | 0.771 | 1.4 | 100% |  |
| fused embeddinggemma@128 | 89.3 | 99.1 | 99.5 | 0.936 | 1.9 | 100% |  |
| fused-gated embeddinggemma@128 | 86 | 98.6 | 99.1 | 0.913 | 1.4 | 9% |  |

### Semantic calibration

Fusion weights the semantic list by its best cosine, from 0 at `floor` to 1 at `ceiling`. Measured here: floor = 25th percentile of the semantic misses' best cosine, ceiling = median of the hits'. The shipped model uses the client default (`DEFAULT_SEMANTIC_CALIBRATION`).

| Vectors | Measured floor–ceiling | Used |
| --- | --: | --: |
| bge-m3@1024 | 0.47–0.62 | 0.47–0.62 |
| bge-m3@768 | 0.50–0.61 | 0.50–0.61 |
| bge-m3@512 | 0.52–0.64 | 0.52–0.64 |
| bge-m3@256 | 0.45–0.56 | 0.45–0.56 |
| bge-m3@128 | 0.52–0.60 | 0.52–0.60 |
| embeddinggemma@768 | 0.39–0.56 | 0.44–0.58 (client default) |
| embeddinggemma@512 | 0.42–0.56 | 0.42–0.56 |
| embeddinggemma@256 | 0.47–0.61 | 0.47–0.61 |
| embeddinggemma@128 | 0.47–0.55 | 0.47–0.55 |

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
| fused-gated bge-m3@1024 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@768 | 92.3 | 95.8 | 69.7 | 80 | 76.2 | 96.9 | 90.9 | 100 |
| fused-gated bge-m3@768 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@512 | 96.2 | 87.5 | 63.6 | 77.1 | 81 | 84.4 | 90.9 | 100 |
| fused-gated bge-m3@512 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@256 | 84.6 | 87.5 | 54.5 | 77.1 | 71.4 | 84.4 | 78.8 | 100 |
| fused-gated bge-m3@256 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic bge-m3@128 | 69.2 | 66.7 | 48.5 | 51.4 | 52.4 | 62.5 | 60.6 | 70 |
| fused-gated bge-m3@128 | 100 | 95.8 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic embeddinggemma@768 | 92.3 | 95.8 | 87.9 | 97.1 | 81 | 93.8 | 90.9 | 100 |
| fused-gated embeddinggemma@768 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic embeddinggemma@512 | 96.2 | 95.8 | 87.9 | 94.3 | 85.7 | 93.8 | 87.9 | 100 |
| fused-gated embeddinggemma@512 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic embeddinggemma@256 | 92.3 | 95.8 | 90.9 | 91.4 | 81 | 90.6 | 78.8 | 100 |
| fused-gated embeddinggemma@256 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |
| semantic embeddinggemma@128 | 92.3 | 87.5 | 75.8 | 88.6 | 81 | 93.8 | 78.8 | 100 |
| fused-gated embeddinggemma@128 | 100 | 100 | 100 | 97.1 | 95.2 | 96.9 | 100 | 100 |

## Latency

| Measure | p50 | p95 | max | n |
| --- | --: | --: | --: | --: |
| Tier 0 per keystroke (Node, this machine) | 0.09 ms | 0.72 ms | 26 ms | 6237 |
| Tier 0 index build (en + tr) | 133 ms |  |  | 1 |

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

Model `@cf/google/embeddinggemma-300m` at $0.0200 / 1M tokens (assumed). L0 share 91.1% (measured: eval gate, 214 queries, this run), L2 share 50% of semantic requests, L3 Cache API hit rate 10%, 1.5 requests per semantic search.

- **Search, all layers L0–L3: $0.0322 per 1M searches** (usage beyond the included quotas).
- With reaction suggestions and images: $0.765 per 1M searches.
- All-in at 10M searches / month: $9.055 / month = $0.906 per 1M (plan fee and included quotas counted).
- ⚠ model price is not published; $0.0200 / 1M tokens assumed.
- ⚠ image price $0.0010 per image is an assumption.
- ⚠ Analytics Engine billing has not started (it would add $0.0219 per 1M searches).

| Layer | Volume per 1M searches | $ per 1M searches |
| --- | --: | --: |
| L0 on device | 911.2k searches | $0 |
| L2 static shards | 66.6k requests | $0 |
| L3 Worker, Cache API hit | 6.7k requests | $0.0023 |
| L3 Worker, embed + search | 59.9k requests | $0.0300 |
| Reaction suggestions | 20k requests | $0.0324 |
| Image classification | 1k requests | $0.701 |
| **Total** | 87.6k Worker requests | **$0.765** |

| Cost line | $ per 1M searches |
| --- | --: |
| Worker requests | $0.0263 |
| Worker CPU | $0.0036 |
| Workers AI embeddings | $0.0355 |
| Image model | $0.700 |
| Analytics Engine | $0 |
| Static shards (L2), on device (L0) | $0 |

### Sensitivity (one input at a time)

| Input | Low | Base | High | $ / 1M at low | at base | at high |
| --- | --: | --: | --: | --: | --: | --: |
| deviceShare | 40% | 91.1% | 90% | $0.951 | $0.765 | $0.769 |
| shardHitShare | 0% | 50% | 80% | $0.798 | $0.765 | $0.746 |
| cacheHitRate | 0% | 10% | 50% | $0.766 | $0.765 | $0.761 |
| requestsPerSemanticSearch | 1 | 1.5 | 3 | $0.755 | $0.765 | $0.798 |
| model.tokensPerQuery | 4 | 8 | 24 | $0.761 | $0.765 | $0.785 |
| model.pricePerMTokens | 0.012 | 0.02 | 0.067 | $0.751 | $0.765 | $0.849 |
| reactions.perSearch | 0 | 0.02 | 0.1 | $0.733 | $0.765 | $0.895 |
| images.perSearch | 0 | 0.001 | 0.01 | $0.0646 | $0.765 | $7.072 |
| images.pricePerImage | 0.0002 | 0.001 | 0.005 | $0.205 | $0.765 | $3.565 |

### L0 share × L2 share ($ per 1M searches)

| L0 ↓ / L2 → | 0% | 25% | 50% | 75% | 90% |
| --- | --: | --: | --: | --: | --: |
| 40% | $1.169 | $1.060 | $0.951 | $0.842 | $0.777 |
| 60% | $1.024 | $0.951 | $0.878 | $0.806 | $0.762 |
| 80% | $0.878 | $0.842 | $0.806 | $0.769 | $0.748 |
| 90% | $0.806 | $0.788 | $0.769 | $0.751 | $0.740 |

### All-in by volume

| Searches / month | $ / month | $ per 1M searches |
| --- | --: | --: |
| 1M | $5.000 | $5.000 |
| 10M | $9.055 | $0.906 |
| 100M | $75.25 | $0.753 |
| 1B | $763.46 | $0.763 |

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
| fused-gated embeddinggemma@768 | 9% | $0.0200 ⚠ | $0.0342 | $0.767 |
| fused-gated embeddinggemma@512 | 9% | $0.0200 ⚠ | $0.0342 | $0.767 |
| fused-gated embeddinggemma@256 | 9% | $0.0200 ⚠ | $0.0342 | $0.767 |
| fused-gated embeddinggemma@128 | 9% | $0.0200 ⚠ | $0.0342 | $0.767 |

⚠ = model price is not published; `model.assumedPricePerMTokens` is used.

## Misses of the best engine (fused embeddinggemma@768)

| Query | Category | Expected | Got (top 5) |
| --- | --- | --- | --- |
| shrek ⓡ | pop | 🧌👹🟢 | 🫏 💚 🧅 🥺 📗 |
| bite the bullet ⓡ | idiom | 😬💪😤 | 🫦 🎯 🤐 👊 🤏 |

ⓡ = label marked for human review in queries.jsonl.
