# Emojisense eval report

- Date: 2026-10-02 · pack 0.1.0 · 214 scored queries (+3 noise) · 46 labels marked for human review
- Hit = any acceptable emoji in the top k. MRR over the top 10. forbid@3 = a forbidden emoji in the top 3 (hard negatives).

## Engines

| Engine | R@1 | R@5 | R@10 | MRR | forbid@3 | Tier 1 calls | Note |
| --- | --: | --: | --: | --: | --: | --: | --- |
| alias (core + ext) | 76.6 | 95.8 | 97.2 | 0.848 | 1.4 | 0% |  |
| alias (core only, first load) | 71 | 85.5 | 86.4 | 0.77 | 1.4 | 0% |  |
| alias (core with ≤8 aliases) | 66.8 | 77.1 | 78 | 0.712 | 1.4 | 0% |  |
| alias (core with ≤16 aliases) | 71 | 85.5 | 86.4 | 0.77 | 1.4 | 0% |  |
| alias (core with ≤24 aliases) | 72 | 90.2 | 91.6 | 0.796 | 1.9 | 0% |  |
| semantic bge-small@384 | 56.5 | 70.6 | 73.4 | 0.623 | 2.3 | 100% |  |
| fused bge-small@384 | 79.4 | 96.3 | 98.6 | 0.863 | 1.9 | 100% |  |
| fused-gated bge-small@384 | 80.4 | 97.2 | 98.6 | 0.87 | 1.9 | 45% |  |
| semantic bge-small@256 | 53.7 | 69.2 | 73.8 | 0.606 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-small@256 | 79.4 | 95.8 | 98.6 | 0.863 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-small@256 | 79.4 | 96.3 | 98.6 | 0.866 | 1.9 | 45% | truncated, model not MRL-trained |
| semantic bge-small@128 | 47.7 | 60.7 | 65.9 | 0.533 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-small@128 | 75.7 | 95.8 | 98.6 | 0.842 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-small@128 | 77.1 | 95.8 | 98.6 | 0.849 | 1.9 | 45% | truncated, model not MRL-trained |
| semantic bge-m3@1024 | 68.7 | 85.5 | 88.8 | 0.756 | 2.3 | 100% |  |
| fused bge-m3@1024 | 84.6 | 94.9 | 97.7 | 0.893 | 1.9 | 100% |  |
| fused-gated bge-m3@1024 | 81.8 | 95.3 | 97.7 | 0.878 | 1.9 | 45% |  |
| semantic bge-m3@768 | 65.4 | 85 | 88.3 | 0.738 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@768 | 84.1 | 94.9 | 97.2 | 0.891 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@768 | 81.3 | 95.3 | 97.2 | 0.876 | 1.9 | 45% | truncated, model not MRL-trained |
| semantic bge-m3@512 | 61.2 | 82.7 | 86.4 | 0.696 | 2.3 | 100% | truncated, model not MRL-trained |
| fused bge-m3@512 | 82.2 | 95.3 | 97.7 | 0.879 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@512 | 79.9 | 94.9 | 97.7 | 0.866 | 1.9 | 45% | truncated, model not MRL-trained |
| semantic bge-m3@256 | 52.8 | 72 | 77.1 | 0.607 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@256 | 78 | 95.8 | 97.2 | 0.855 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@256 | 78.5 | 95.3 | 97.2 | 0.858 | 1.9 | 45% | truncated, model not MRL-trained |
| semantic bge-m3@128 | 36 | 51.9 | 62.1 | 0.432 | 1.4 | 100% | truncated, model not MRL-trained |
| fused bge-m3@128 | 73.4 | 93.9 | 95.3 | 0.817 | 1.9 | 100% | truncated, model not MRL-trained |
| fused-gated bge-m3@128 | 73.8 | 93.5 | 95.3 | 0.82 | 1.9 | 45% | truncated, model not MRL-trained |
| semantic embeddinggemma@768 | 75.7 | 88.3 | 93 | 0.815 | 1.4 | 100% |  |
| fused embeddinggemma@768 | 83.6 | 97.2 | 98.6 | 0.892 | 1.9 | 100% |  |
| fused-gated embeddinggemma@768 | 81.8 | 97.2 | 98.6 | 0.881 | 1.9 | 45% |  |
| semantic embeddinggemma@512 | 72.9 | 90.2 | 92.5 | 0.797 | 1.4 | 100% |  |
| fused embeddinggemma@512 | 83.6 | 97.2 | 99.1 | 0.893 | 1.9 | 100% |  |
| fused-gated embeddinggemma@512 | 81.8 | 97.2 | 99.1 | 0.88 | 1.9 | 45% |  |
| semantic embeddinggemma@256 | 73.8 | 86.9 | 90.2 | 0.795 | 1.4 | 100% |  |
| **fused embeddinggemma@256** | 83.2 | 97.7 | 98.6 | 0.891 | 1.9 | 100% |  |
| fused-gated embeddinggemma@256 | 80.8 | 97.7 | 98.6 | 0.875 | 1.9 | 45% |  |
| semantic embeddinggemma@128 | 68.2 | 82.2 | 88.8 | 0.747 | 1.4 | 100% |  |
| fused embeddinggemma@128 | 85.5 | 96.7 | 98.1 | 0.899 | 1.4 | 100% |  |
| fused-gated embeddinggemma@128 | 81.3 | 96.3 | 98.1 | 0.875 | 1.9 | 45% |  |
| semantic qwen3@1024 | 61.2 | 80.8 | 85 | 0.698 | 2.8 | 100% |  |
| fused qwen3@1024 | 79 | 92.1 | 97.2 | 0.847 | 1.9 | 100% |  |
| fused-gated qwen3@1024 | 79.4 | 93 | 97.2 | 0.855 | 1.9 | 45% |  |
| semantic qwen3@768 | 59.8 | 80.4 | 85 | 0.687 | 2.8 | 100% |  |
| fused qwen3@768 | 79.9 | 92.5 | 96.7 | 0.855 | 1.9 | 100% |  |
| fused-gated qwen3@768 | 79.9 | 93.5 | 96.7 | 0.86 | 1.9 | 45% |  |
| semantic qwen3@512 | 58.9 | 77.6 | 83.2 | 0.665 | 2.3 | 100% |  |
| fused qwen3@512 | 78 | 93.5 | 96.7 | 0.846 | 1.9 | 100% |  |
| fused-gated qwen3@512 | 78.5 | 93.9 | 96.7 | 0.851 | 1.9 | 45% |  |
| semantic qwen3@256 | 54.2 | 74.8 | 79.4 | 0.626 | 1.9 | 100% |  |
| fused qwen3@256 | 78.5 | 93.5 | 96.7 | 0.849 | 1.9 | 100% |  |
| fused-gated qwen3@256 | 78 | 93.5 | 96.7 | 0.849 | 1.9 | 45% |  |
| semantic qwen3@128 | 50.5 | 71 | 75.7 | 0.584 | 0.9 | 100% |  |
| fused qwen3@128 | 78.5 | 93.9 | 97.2 | 0.852 | 1.4 | 100% |  |
| fused-gated qwen3@128 | 77.1 | 93.5 | 97.2 | 0.846 | 1.4 | 45% |  |

## Recall@5 by category

| Engine | exact (26) | typo (24) | slang (33) | pop (35) | idiom (21) | intent (32) | tr (33) | negative (10) |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| alias (core + ext) | 100 | 100 | 97 | 91.4 | 90.5 | 90.6 | 100 | 100 |
| alias (core only, first load) | 100 | 95.8 | 81.8 | 77.1 | 71.4 | 78.1 | 90.9 | 100 |
| semantic bge-small@384 | 84.6 | 54.2 | 75.8 | 88.6 | 76.2 | 90.6 | 15.2 | 100 |
| fused-gated bge-small@384 | 100 | 100 | 100 | 97.1 | 85.7 | 96.9 | 97 | 100 |
| semantic bge-small@256 | 84.6 | 50 | 72.7 | 85.7 | 76.2 | 90.6 | 15.2 | 100 |
| fused-gated bge-small@256 | 100 | 100 | 100 | 97.1 | 85.7 | 93.8 | 93.9 | 100 |
| semantic bge-small@128 | 84.6 | 37.5 | 63.6 | 74.3 | 76.2 | 75 | 6.1 | 100 |
| fused-gated bge-small@128 | 100 | 100 | 100 | 94.3 | 85.7 | 93.8 | 93.9 | 100 |
| semantic bge-m3@1024 | 96.2 | 91.7 | 69.7 | 85.7 | 76.2 | 93.8 | 81.8 | 100 |
| fused-gated bge-m3@1024 | 100 | 100 | 97 | 91.4 | 81 | 96.9 | 97 | 100 |
| semantic bge-m3@768 | 92.3 | 95.8 | 72.7 | 85.7 | 76.2 | 93.8 | 75.8 | 100 |
| fused-gated bge-m3@768 | 100 | 100 | 97 | 91.4 | 81 | 96.9 | 97 | 100 |
| semantic bge-m3@512 | 92.3 | 95.8 | 66.7 | 77.1 | 81 | 84.4 | 81.8 | 100 |
| fused-gated bge-m3@512 | 100 | 100 | 97 | 91.4 | 81 | 93.8 | 97 | 100 |
| semantic bge-m3@256 | 84.6 | 83.3 | 54.5 | 71.4 | 66.7 | 78.1 | 60.6 | 100 |
| fused-gated bge-m3@256 | 100 | 100 | 97 | 94.3 | 85.7 | 90.6 | 97 | 100 |
| semantic bge-m3@128 | 57.7 | 66.7 | 45.5 | 42.9 | 52.4 | 50 | 48.5 | 70 |
| fused-gated bge-m3@128 | 100 | 91.7 | 97 | 91.4 | 85.7 | 90.6 | 97 | 90 |
| semantic embeddinggemma@768 | 88.5 | 91.7 | 84.8 | 94.3 | 81 | 93.8 | 78.8 | 100 |
| fused-gated embeddinggemma@768 | 100 | 100 | 100 | 94.3 | 85.7 | 96.9 | 100 | 100 |
| semantic embeddinggemma@512 | 88.5 | 95.8 | 90.9 | 91.4 | 85.7 | 96.9 | 78.8 | 100 |
| fused-gated embeddinggemma@512 | 100 | 100 | 100 | 94.3 | 85.7 | 96.9 | 100 | 100 |
| semantic embeddinggemma@256 | 92.3 | 91.7 | 72.7 | 91.4 | 81 | 96.9 | 78.8 | 100 |
| fused-gated embeddinggemma@256 | 100 | 100 | 100 | 97.1 | 85.7 | 96.9 | 100 | 100 |
| semantic embeddinggemma@128 | 88.5 | 83.3 | 75.8 | 82.9 | 81 | 93.8 | 66.7 | 100 |
| fused-gated embeddinggemma@128 | 100 | 100 | 97 | 97.1 | 90.5 | 93.8 | 93.9 | 100 |
| semantic qwen3@1024 | 92.3 | 91.7 | 75.8 | 82.9 | 71.4 | 90.6 | 57.6 | 100 |
| fused-gated qwen3@1024 | 100 | 100 | 97 | 91.4 | 81 | 87.5 | 90.9 | 100 |
| semantic qwen3@768 | 92.3 | 87.5 | 75.8 | 82.9 | 71.4 | 93.8 | 54.5 | 100 |
| fused-gated qwen3@768 | 100 | 100 | 97 | 91.4 | 81 | 87.5 | 93.9 | 100 |
| semantic qwen3@512 | 92.3 | 83.3 | 69.7 | 80 | 61.9 | 93.8 | 54.5 | 100 |
| fused-gated qwen3@512 | 100 | 100 | 97 | 94.3 | 81 | 87.5 | 93.9 | 100 |
| semantic qwen3@256 | 96.2 | 79.2 | 69.7 | 71.4 | 52.4 | 90.6 | 54.5 | 100 |
| fused-gated qwen3@256 | 100 | 100 | 97 | 91.4 | 76.2 | 90.6 | 93.9 | 100 |
| semantic qwen3@128 | 84.6 | 70.8 | 60.6 | 71.4 | 57.1 | 87.5 | 57.6 | 90 |
| fused-gated qwen3@128 | 100 | 100 | 97 | 91.4 | 81 | 90.6 | 90.9 | 100 |

## Latency

| Measure | p50 | p95 | max | n |
| --- | --: | --: | --: | --: |
| Tier 0 per keystroke (Node, this machine) | 0.07 ms | 0.59 ms | 90 ms | 6237 |
| Tier 0 index build (en + tr) | 175 ms |  |  | 1 |

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
| vectors.qwen3.1024.bin | 2177.5 KB | 1959.2 KB |
| vectors.qwen3.128.bin | 293.4 KB | 264.3 KB |
| vectors.qwen3.256.bin | 562.6 KB | 504.9 KB |
| vectors.qwen3.512.bin | 1100.9 KB | 993.5 KB |
| vectors.qwen3.768.bin | 1639.2 KB | 1478.9 KB |

## Estimated cost per 1M searches (Workers Paid, beyond included quota)

Assumptions: 1.5 debounced requests per semantic search, 2 ms CPU per request, query tokens ≈ chars / 4.

| Engine | Tier 1 calls | Cache hit 70% | Cache hit 30% | Every search hits Tier 1, 70% hit |
| --- | --: | --: | --: | --: |
| fused-gated bge-small@384 | 45% | $0.299 | $0.390 | $0.660 |
| fused-gated bge-small@256 | 45% | $0.299 | $0.390 | $0.660 |
| fused-gated bge-small@128 | 45% | $0.299 | $0.390 | $0.660 |
| fused-gated bge-m3@1024 | 45% | $0.237 | $0.245 | $0.523 |
| fused-gated bge-m3@768 | 45% | $0.237 | $0.245 | $0.523 |
| fused-gated bge-m3@512 | 45% | $0.237 | $0.245 | $0.523 |
| fused-gated bge-m3@256 | 45% | $0.237 | $0.245 | $0.523 |
| fused-gated bge-m3@128 | 45% | $0.237 | $0.245 | $0.523 |
| fused-gated embeddinggemma@768 | 45% | $0.271 ⚠ | $0.323 ⚠ | $0.597 ⚠ |
| fused-gated embeddinggemma@512 | 45% | $0.271 ⚠ | $0.323 ⚠ | $0.597 ⚠ |
| fused-gated embeddinggemma@256 | 45% | $0.271 ⚠ | $0.323 ⚠ | $0.597 ⚠ |
| fused-gated embeddinggemma@128 | 45% | $0.271 ⚠ | $0.323 ⚠ | $0.597 ⚠ |
| fused-gated qwen3@1024 | 45% | $0.237 | $0.245 | $0.523 |
| fused-gated qwen3@768 | 45% | $0.237 | $0.245 | $0.523 |
| fused-gated qwen3@512 | 45% | $0.237 | $0.245 | $0.523 |
| fused-gated qwen3@256 | 45% | $0.237 | $0.245 | $0.523 |
| fused-gated qwen3@128 | 45% | $0.237 | $0.245 | $0.523 |

⚠ = model price is not published; $0.02 / 1M tokens (bge-small rate) assumed.

## Misses of the best engine (fused embeddinggemma@256)

| Query | Category | Expected | Got (top 5) |
| --- | --- | --- | --- |
| minecraft ⓡ | pop | ⛏️🧱🟩🎮 | 🟫 🪵 🪏 🪎 ⚒️ |
| break a leg | idiom | 🍀🎭🤞🌟 | 🦵 🦿 🍗 🩼 ⛓️‍💥 |
| cost an arm and a leg ⓡ | idiom | 💸💰🤑💵 | 🦴 🦾 🩼 🦵 🤏 |
| bite the bullet ⓡ | idiom | 😬💪😤 | 🫦 🚅 🥕 🎯 💉 |
| hang in there ⓡ | intent | 💪🙏🫂❤️ | 😣 ✊️ 🤙 🧗 🧗‍♂️ |

ⓡ = label marked for human review in queries.jsonl.
