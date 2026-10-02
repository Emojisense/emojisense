# Romanized and slang dev set

- 116 queries (queries/romanized-dev.jsonl) · pack 0.1.0 · bge-m3@1024 · embedded text = `embeddingText(q)`, as the Worker embeds it
- gated = what a client shows: fused only when `shouldUseSemantic` calls the semantic tier.

## Recall@5 (R@1 in brackets)

| Category | n | alias | semantic | fused | gated |
| --- | --: | --: | --: | --: | --: |
| hinglish | 24 | 75 (58.3) | 12.5 (12.5) | 79.2 (62.5) | 79.2 (62.5) |
| banglish | 16 | 75 (50) | 0 (0) | 75 (50) | 75 (50) |
| arabizi | 18 | 61.1 (50) | 16.7 (11.1) | 66.7 (55.6) | 66.7 (55.6) |
| slang | 28 | 89.3 (46.4) | 7.1 (3.6) | 89.3 (50) | 89.3 (46.4) |
| country | 30 | 96.7 (86.7) | 96.7 (86.7) | 100 (93.3) | 100 (90) |
| all | 116 | 81.9 (60.3) | 31.9 (27.6) | 84.5 (64.7) | 84.5 (62.9) |

## Country flags

| Measure | alias | semantic | fused | gated |
| --- | --: | --: | --: | --: |
| Non-country queries with a country flag in the top 5, % | 7.0 | 40.7 | 8.1 | 8.1 |
| Country queries with their flag first | 26/30 | 26/30 | 28/30 | 27/30 |
