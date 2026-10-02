# Held-out quality diagnosis

- Date: 2026-10-02 · pack 0.1.0 · production model bge-m3 @1024 · base: main at `6852e0e`.
- Question: why is recall@5 on the held-out set (alias 47.7, fused 49.2) far below the in-house
  suite (alias 96.7, fused 94.9)?
- Tool: `pnpm --filter @emojisense/eval eval:diagnose` gives each held-out miss one failure type
  and counts the types per locale and mode. Full tables after the fixes:
  [heldout-diagnosis.md](heldout-diagnosis.md).

**Held-out discipline.** This report uses the held-out set only for counts. It quotes no
held-out query and no label set. The examples below are paraphrases. The two fixes were
designed and calibrated on the in-house set; the held-out numbers are measurements only. No
held-out text went into aliases, curation, tests or prompts.

## 1. Top findings

| # | Finding | Evidence |
| - | ------- | -------- |
| 1 | The in-house set measures the alias author's own phrasing. | In-house: 214 queries, en + tr, written by the alias author. Held-out: 734 queries, 11 locales, 1–6-word chat phrases. 320 of the 384 alias misses are multi-word. |
| 2 | Fusion threw away alias hits. | A fixed semantic weight of 1 (with k = 60) put the semantic rank 1 above every alias hit with confidence < 0.6, and the whole semantic top 10 above it under 0.47. 57 alias top-5 hits were lost. Fused was below alias in 6 of 11 locales. **Fixed (prototype 1).** |
| 3 | The semantic tier is weak outside en, zh, ru and tr. | Semantic-only R@5: hi 28.6, es 35.9, ar 20.0, fr 36.1, bn 20.2, pt 29.7, id 28.6 (en 59.4, zh 56.3). The emoji documents hold English and Turkish text only. |
| 4 | Romanized input is 21% of the set and fails in both tiers. | 156 hi/bn/ar queries in Latin letters. Alias R@5 37 / 25 / 11, semantic 20 / 10 / 8. The bge-m3 top 5 holds a country flag for 69 of them (44%). |
| 5 | Multi-word intent phrases are read literally. | `phrase-partial` is the largest alias type (103). An idiom matches the alias of one of its words. |
| 6 | One in five alias misses is on the label side. | Disputed labels 64, emoji in the query 11, gendered variant only 5: 80 of 384. |
| 7 | Chinese runs did not split into words. | A run without spaces was one token: 20 of 39 zh alias misses, 18 with no result at all. **Fixed (prototype 2).** |
| 8 | The eval embeds the raw query; the Worker embeds `normalize(q)`. | 162 of 734 held-out queries change under normalization (accents, emoji, case). Embedding the normalized text: semantic R@5 36.8 → 33.4 (held-out), 85.5 → 82.2 (in-house). The eval overstates the shipped semantic tier. |
| 9 | Better fusion alone has a low ceiling. | A label is in the alias top 5 or the semantic top 5 for 59.5% of the queries. Fused is now 53.7. More recall needs better tiers (findings 3–5). |

## 2. Failure types on main (before the fixes)

Each miss gets the first type that applies, in this order. Modes: **alias** (core + ext packs),
**fused** (always fused, the held-out report's mode), **gated** (what a client shows: fused only
when `shouldUseSemantic` calls the semantic tier).

| Type | Meaning |
| ---- | ------- |
| `emoji-in-query` | The query text holds an emoji. Generator flaw. |
| `gendered-label` | A hit once ♂/♀ variants count as their neutral base. |
| `disputed-label` | Listed in queries/heldout-review.md. |
| `gate-skipped` | Gated mode only: the gate did not call the semantic tier, and fusion would have hit. |
| `fusion-dropped-alias` | Alias had a label in its top 5; fusion pushed it out. |
| `fusion-dropped-semantic` | Semantic had a label in its top 5 (alias did not); fusion pushed it out. |
| `romanized` | hi, bn, ar (or ru, zh) typed in Latin letters. |
| `unsegmented-script` | A Han, kana or Thai run that is not one indexed token. |
| `no-match` | The alias tier returned nothing. |
| `unknown-word` | A query word is in no phrase of the loaded packs. |
| `exact-phrase-other-emoji` | The query is an indexed phrase, but of other emoji than the labels. |
| `phrase-partial` | Every word is known; no phrase covers the query. |
| `word-sense` | One known word; its indexed sense differs from the labels' sense. |

### Alias mode (384 misses)

| Type | en | zh | hi | es | ar | fr | bn | pt | ru | id | tr | all |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| emoji-in-query | 0 | 0 | 0 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| gendered-label | 0 | 0 | 1 | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 1 | 5 |
| disputed-label | 2 | 7 | 4 | 8 | 7 | 8 | 4 | 6 | 2 | 13 | 3 | 64 |
| romanized | 0 | 0 | 34 | 0 | 14 | 0 | 42 | 0 | 0 | 0 | 0 | 90 |
| unsegmented-script | 0 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 20 |
| no-match | 0 | 0 | 0 | 0 | 1 | 0 | 2 | 0 | 1 | 1 | 2 | 7 |
| unknown-word | 2 | 0 | 2 | 3 | 1 | 5 | 2 | 1 | 3 | 5 | 4 | 28 |
| exact-phrase-other-emoji | 6 | 11 | 2 | 2 | 3 | 6 | 2 | 7 | 8 | 3 | 3 | 53 |
| phrase-partial | 16 | 0 | 4 | 8 | 7 | 10 | 7 | 12 | 17 | 7 | 15 | 103 |
| word-sense | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 3 |
| **misses** | 26 | 39 | 47 | 23 | 44 | 30 | 59 | 27 | 31 | 29 | 29 | 384 |

### Fused mode (373 misses)

| Type | en | zh | hi | es | ar | fr | bn | pt | ru | id | tr | all |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| emoji-in-query | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| gendered-label | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 2 |
| disputed-label | 1 | 7 | 5 | 8 | 8 | 8 | 5 | 6 | 2 | 14 | 3 | 67 |
| fusion-dropped-alias | 3 | 1 | 11 | 3 | 6 | 4 | 10 | 6 | 2 | 9 | 2 | 57 |
| fusion-dropped-semantic | 4 | 2 | 0 | 1 | 2 | 2 | 1 | 2 | 1 | 0 | 4 | 19 |
| romanized | 0 | 0 | 30 | 0 | 13 | 0 | 37 | 0 | 0 | 0 | 0 | 80 |
| unsegmented-script | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| no-match | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 1 | 3 |
| unknown-word | 2 | 0 | 2 | 3 | 0 | 5 | 2 | 1 | 1 | 4 | 3 | 23 |
| exact-phrase-other-emoji | 6 | 5 | 2 | 2 | 2 | 3 | 2 | 6 | 7 | 3 | 2 | 40 |
| phrase-partial | 7 | 0 | 3 | 5 | 4 | 9 | 4 | 9 | 8 | 4 | 10 | 63 |
| word-sense | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| **misses** | 24 | 23 | 53 | 23 | 45 | 31 | 63 | 30 | 22 | 34 | 25 | 373 |

Gated mode on main: 372 misses; the same pattern, plus `gate-skipped` 6 (zh 4, fr 1, ru 1).
Cross-cut: 83 fused misses had a country flag in the top 5 although no label is a flag (alias
mode: 15).

### Anonymized examples per type

| Type | Examples (paraphrased, no query text) |
| ---- | ------------------------------------- |
| `emoji-in-query` | An Arabizi phrase meaning "impossible" that ends with three tears-of-joy faces. An Arabizi call to leave that ends with the emoji that is also its first label. |
| `gendered-label` | A French disbelief phrase: the engine returns the woman-facepalming variant; the label is the man variant. A Hinglish "I need peace" phrase: the engine returns the neutral person in lotus position; the label is the man variant. |
| `disputed-label` | An English after-meal phrase labelled with the "food baby" joke emoji. A Chinese gaming-slang word with one label only. An Indonesian weather phrase with one label only. |
| `gate-skipped` | Short Chinese exclamations that are exact alias phrases (confidence 0.8–1.0). The gate skips the semantic tier, which had a label at rank 1. |
| `fusion-dropped-alias` | A romanized Bengali "that turned out great" phrase: alias had the clapping hands at rank 2; the fused top 5 held five unrelated emoji, three of them country flags. A native-script Arabic prayer phrase: alias rank 1 was right (confidence 0.54); fusion put four animal emoji above it. |
| `fusion-dropped-semantic` | An English encouragement phrase about growing strength: semantic had the flexed biceps first; partial alias matches (seedling, repeat sign) took the top places. A French "it is going to get hot" idiom: the phrase is pinned for other emoji; semantic had all labels in its top 3. |
| `romanized` | A one-word Hinglish verb for laughter: the alias tier maps it to a plain grin; the semantic tier returns a synagogue, a flag and a headscarf. A Banglish "very hungry" sentence: the intensifier and the verb form are unknown; semantic returns a mosque and four flags. An Arabizi holiday greeting: alias matches an unrelated romanized food phrase. |
| `unsegmented-script` | A four-character Chinese idiom for a big crowd: one unknown run, no alias result. A Chinese "want to cry" run: no result, although "cry" alone is a keyword. |
| `no-match` | A Russian rap interjection that is in no phrase. A Bengali "my body aches" sentence with a colloquial verb and a suffixed noun. |
| `unknown-word` | A Portuguese diminutive for "exhausted": the word is unknown and fuzzy-matches "mountain". An English phrase about body aches: the adjective fuzzy-matches a sneeze typo. |
| `exact-phrase-other-emoji` | An English hungry-plus-angry portmanteau is an alias of the cutlery and an ogre; the labels are angry faces. A Russian one-word "cringe" slang is a keyword of the confounded face; the labels are grimacing and clown faces. A Chinese "off we go" phrase is an alias of the cowboy face; the labels are travel emoji. |
| `phrase-partial` | A French "in the juice" idiom (= rushed) matches the juice box. A Russian "my back is falling off" idiom matches the gorilla through "back". A Portuguese "I am broke" slang (literally "broken") matches the broken chain and a crutch. |
| `word-sense` | A Spanish "go ahead" interjection matches a pointing-down alias by the literal verb. A Chinese word for "soothing" matches ❤️‍🩹 through a longer phrase. |

## 3. Proposals, ranked by impact per cost

Impact = estimated held-out recall@5 points (overall, fused/gated unless noted). Cost: S < 1 day,
M = a few days, L = a week or more. Estimates scale the type counts by a plausible fix rate; only
rows 1 and 2 are measured.

| Rank | Fix (generic) | Types it targets | Impact | Cost | Status |
| ---: | ------------- | ---------------- | -----: | :--: | ------ |
| 1 | **Confidence-weighted fusion**: semantic weight 0.4–1 from its best cosine (calibrated per model on the in-house set). | fusion-dropped-alias, flags in the top 5 | **+4.5 measured** | S | Done (prototype 1) |
| 2 | **Split unspaced-script runs** into the vocabulary tokens they hold. | unsegmented-script | **zh alias +10.9, overall alias +0.9 measured**; fused ±0 | S | Done (prototype 2) |
| 3 | Embed what ships, and keep accents for the model: the eval must embed exactly what the Worker embeds. The Worker can embed a light form (NFKC, lowercase, no emoji, accents kept) and keep `normalize(q)` as the cache key. | measurement; semantic weak | Raw text vs `normalize(q)`, measured: semantic +3.4, fused +0.6 (held-out); semantic +3.3, fused −0.5 (in-house) | S | Proposed |
| 4 | Label hygiene: a human decides the heldout-review.md rows; `judge()` folds ♂/♀; the generator already rejects emoji. | disputed-label, gendered-label, emoji-in-query | +2 to +5 *measured* recall, 0 real | S | Proposed (needs a human) |
| 5 | Multilingual emoji documents for the semantic tier: add each locale's CLDR keywords and top aliases (one document per emoji, or one vector file per locale). | semantic weak for the language, phrase-partial, unknown-word | +4 to +8 | M | Proposed |
| 6 | Intent-phrase alias pass: a NEW LLM pass with a different prompt (multi-word reactions, chat slang, inflected forms, 3–5 emoji incl. the main reaction face), written without held-out text, then the in-house gate. | phrase-partial, unknown-word, exact-phrase-other-emoji, word-sense | +3 to +6 | M | Proposed |
| 7 | Romanization layer: index transliterated forms of the hi/bn/ar (and ru, zh pinyin) aliases, and fold Latin spelling variants (vowel length, h-digraphs, Arabizi digits) at index and query time. | romanized | +3 to +5 | M–L | Proposed |
| 8 | Flag damping for non-flag intents: drop semantic-only country flags unless the alias tier also returns one. | flags in the top 5 (45 fused misses after fix 1) | 0 R@5 (measured), better precision | S | Proposed |
| 9 | Bundle all locale packs in the Worker (now en + tr only), so `mode=hybrid` HTTP clients get their locale's aliases. SDK clients fuse on the device and are not affected. | romanized, phrase-partial for HTTP-only clients | 0 for SDK clients | S–M | Proposed |
| 10 | Lower the gate threshold for non-en locales. | gate-skipped | ≤ +0.8 (6 queries) | S | Not now |
| 11 | Query-language detection. | romanized | Small alone; it only routes. The match itself needs row 7. | M | Not now |
| 12 | Phrase-level fallback to semantic. | phrase-partial | ~0: the gate already calls the semantic tier for phrases under 0.9. The semantic tier itself misses them. | S | Not needed |

## 4. Prototypes and results

### Prototype 1: confidence-weighted fusion (`packages/core/src/fusion.ts`)

- `fuse()` gave the semantic list a fixed weight of 1. With k = 60 the RRF terms of ranks 1–10
  differ by only 13%, so the weights decide the order. The alias weight is 0.4 + confidence:
  under 0.6 the semantic rank 1 went above the alias rank 1, and under 0.47 the whole semantic
  top 10 did.
- Now the semantic weight is `0.4 + 0.6 × semanticConfidence`, where `semanticConfidence` maps the
  best cosine from `floor` (0) to `ceiling` (1). bge-m3 @1024: 0.44–0.58 = 25th percentile of the
  semantic misses' best cosine and median of the hits' best cosine, both on the in-house set.
- A strong semantic list keeps its old weight. We also measured `0.4 + confidence` (up to 1.4).
  The in-house scores were equal, but it failed the CI gate for a non-shipped vector file. We
  chose the conservative form on in-house evidence, not on held-out numbers.
- `pnpm eval` now measures the calibration per vector file. Non-shipped models fuse with their
  own calibration (cosine scales differ: bge-small 0.56–0.70, embeddinggemma@256 0.39–0.50).
- Swift port and SDK docs updated.

### Prototype 2: split unspaced-script runs (`packages/core/src/engine.ts`, PACK_FORMAT §4)

- A Han, kana, Thai, Lao, Khmer or Myanmar run that is not a vocabulary token is split from the
  left into the longest vocabulary tokens it holds. Unknown code points stay together as one
  piece, which weighs like an unknown word. A run that a vocabulary token completes while typing
  stays whole.
- No pack change. en and tr results do not change (Swift golden conformance passes).
- Swift port and PACK_FORMAT §4 updated.

### Results

Recall@5 (MRR in brackets). In-house: 214 scored queries. Held-out: 734 queries.

| Build | In-house alias | In-house fused | In-house gated | Held-out alias | Held-out fused | Held-out gated |
| ----- | -------------: | -------------: | -------------: | -------------: | -------------: | -------------: |
| main | 96.7 (0.850) | 94.9 (0.885) | 95.3 (0.871) | 47.7 (0.328) | 49.2 (0.361) | 49.3 (0.358) |
| + fix 1 only | 96.7 (0.850) | 95.3 (0.887) | 95.8 (0.874) | 47.7 (0.328) | 53.8 (0.381) | 54.0 (0.378) |
| + fix 2 only | 96.7 (0.850) | 94.9 (0.885) | 95.3 (0.871) | 48.6 (0.336) | 49.2 (0.362) | 49.3 (0.359) |
| **+ both (this branch)** | **96.7 (0.850)** | **95.3 (0.887)** | **95.8 (0.874)** | **48.6 (0.336)** | **53.7 (0.381)** | **53.8 (0.378)** |

Held-out recall@5 per locale, main → this branch:

| Mode | en | zh | hi | es | ar | fr | bn | pt | ru | id | tr |
| ---- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| alias | 59.4 → 59.4 | 39.1 → **50.0** | 44.0 → 44.0 | 64.1 → 64.1 | 26.7 → 26.7 | 50.8 → 50.8 | 29.8 → 29.8 | 57.8 → 57.8 | 51.6 → 51.6 | 54.0 → 54.0 | 53.2 → 53.2 |
| fused | 62.5 → 60.9 | 64.1 → 62.5 | 36.9 → **50.0** | 64.1 → 67.2 | 25.0 → 28.3 | 49.2 → 50.8 | 25.0 → **35.7** | 53.1 → 57.8 | 65.6 → 65.6 | 46.0 → **58.7** | 59.7 → 58.1 |
| gated | 64.1 → 62.5 | 59.4 → 57.8 | 38.1 → **51.2** | 64.1 → 67.2 | 25.0 → 28.3 | 47.5 → 49.2 | 25.0 → **35.7** | 53.1 → 57.8 | 64.1 → 64.1 | 49.2 → **61.9** | 62.9 → 61.3 |

- Fused is now at or above alias in every locale (before: below in 6 of 11).
- en, zh and tr fused each lose one query (−1.6). Fix 1 trades `fusion-dropped-alias` 57 → 17
  for `fusion-dropped-semantic` 19 → 30: net 33 fewer fused misses.
- Fused misses with a country flag in the top 5: 83 → 45.
- No in-house row dropped; the CI gate passes. Every fused row of the benchmark models is equal
  or better on recall@5. `reports/baseline.json` and `reports/heldout-baseline.json` are
  rewritten with these numbers.

## 5. Caveats

- About 60–84 queries per locale: one query is 1.2–1.6 points.
- The held-out labels are one model's; 64 alias misses have disputed labels (not applied).
- The calibration is model-specific. A model change must update `DEFAULT_SEMANTIC_CALIBRATION`
  (TypeScript and Swift); `pnpm eval` prints the measured values.
- Finding 8 means the fused numbers here (and in heldout.md) are about 0.6 points above what the
  Worker serves today.
- Reproduce: `pnpm --filter @emojisense/eval eval -- --offline`, then
  `pnpm --filter @emojisense/eval eval:diagnose -- --offline`.
