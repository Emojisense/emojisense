# Romanized and slang dev set

- 116 queries (queries/romanized-dev.jsonl) · pack 0.1.0 · bge-m3@1024 (shared + 10 locales) · embedded text = `embeddingText(q)`, as the Worker embeds it
- gated = what a client shows: fused only when `shouldUseSemantic` calls the semantic tier.

## Recall@5 (R@1 in brackets)

| Category | n | alias | semantic | fused | gated |
| --- | --: | --: | --: | --: | --: |
| hinglish | 24 | 75 (58.3) | 12.5 (8.3) | 79.2 (62.5) | 79.2 (62.5) |
| banglish | 16 | 75 (50) | 12.5 (6.3) | 75 (37.5) | 75 (37.5) |
| arabizi | 18 | 61.1 (50) | 27.8 (11.1) | 66.7 (55.6) | 66.7 (55.6) |
| slang | 28 | 92.9 (71.4) | 35.7 (7.1) | 92.9 (64.3) | 92.9 (71.4) |
| country | 30 | 96.7 (86.7) | 96.7 (83.3) | 100 (93.3) | 100 (90) |
| all | 116 | 82.8 (66.4) | 42.2 (27.6) | 85.3 (66.4) | 85.3 (67.2) |

## Country flags

| Measure | alias | semantic | fused | gated |
| --- | --: | --: | --: | --: |
| Non-country queries with a country flag in the top 5, % | 7.0 | 34.9 | 8.1 | 8.1 |
| Country queries with their flag first | 26/30 | 25/30 | 28/30 | 27/30 |
