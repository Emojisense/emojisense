# Held-out quality diagnosis

- Date: 2026-10-02 · pack 0.1.0 · production model bge-m3 @1024 · base: main at `a1208f5`
  (ru/id second alias pass, culture layer, server-side aliases for every locale). Main moved to
  `7e2ca62` before the merge; those commits do not touch search, data or eval code.
- Question: why is recall@5 on the held-out set (alias 48.0, fused 48.9 on this base) far below
  the in-house suite (alias 96.7, fused 94.9)?
- Tool: `pnpm --filter @emojisense/eval eval:diagnose` gives each held-out miss one failure type
  and counts the types per locale and mode. Full tables after the fixes:
  [heldout-diagnosis.md](heldout-diagnosis.md).

**Held-out discipline.** This report uses the held-out set only for counts. It quotes no
held-out query and no label set; the examples are paraphrases. Every fix was designed, and every
parameter chosen, on the in-house set; the held-out numbers are measurements only. No held-out
text went into aliases, curation, tests or prompts. One canonical fix from in-house testing (a
zh cheering phrase) is also a held-out query, so it was **not** curated.

## 1. Top findings

| # | Finding | Evidence |
| - | ------- | -------- |
| 1 | The in-house set measures the alias author's own phrasing. | In-house: 214 queries, en + tr, written by the alias author. Held-out: 734 queries, 11 locales, 1–6-word chat phrases; over 80% of the alias misses are multi-word. |
| 2 | Fusion threw away alias hits. | A fixed semantic weight of 1 (k = 60) put the semantic rank 1 above every alias hit with confidence < 0.6, and the whole semantic top 10 above it under 0.47. 60 alias top-5 hits were lost; fused was below alias in 6 of 11 locales. **Fixed (prototype 1).** |
| 3 | The collision cap removed the weight of shared slang. | An alias on more than 8 emoji went to `low` on all of them (dropped above 20): 18,223 demotions, 7,022 drops. 20 alias misses (10 fused) were such phrases. Equal scores then fell to catalog order. **Fixed (prototype 3).** |
| 4 | The semantic tier is weak outside en, zh, ru and tr. | Semantic-only R@5: hi 28.6, es 35.9, ar 20.0, fr 36.1, bn 20.2, pt 29.7, id 28.6 (en 59.4, zh 56.3). The emoji documents hold English and Turkish text only. |
| 5 | Romanized input is 21% of the set and fails in both tiers. | 156 hi/bn/ar queries in Latin letters. Alias R@5 37 / 25 / 11, semantic 20 / 10 / 8. The bge-m3 top 5 holds a country flag for 69 of them (44%). |
| 6 | Multi-word intent phrases are read literally. | `phrase-partial` is the largest alias type (89 on main). An idiom matches the alias of one of its words. |
| 7 | One in five alias misses is on the label side. | Disputed labels 64, emoji in the query 11, gendered variant only 5: 80 of 382. |
| 8 | Chinese runs did not split into words. | A run without spaces was one token: 20 of 39 zh alias misses. **Fixed (prototype 2).** |
| 9 | A CLDR keyword (0.85) beats an alias (0.8) of the same phrase. | 12–15 held-out queries lose recall@1 this way (2–3 lose recall@5). Equal weights were measured: mixed (section 3, row 11). |
| 10 | The eval embeds the raw query; the Worker embeds `normalize(q)`. | 162 of 734 held-out queries change under normalization (accents, emoji, case). Embedding the normalized text: semantic R@5 36.8 → 33.4 (held-out), 85.5 → 82.2 (in-house). The eval overstates the shipped semantic tier. |
| 11 | Better ranking alone has a low ceiling. | A label is in the alias top 5 or the semantic top 5 for 59.9% of the queries; fused is now 54.4. More recall needs better tiers (findings 4–6). |

## 2. Failure types on main (`a1208f5`, before the fixes)

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
| `collision-capped` | The query or a query word is an alias of a label that the collision cap demoted or dropped. |
| `no-match` | The alias tier returned nothing. |
| `unknown-word` | A query word is in no phrase of the loaded packs. |
| `exact-phrase-other-emoji` | The query is an indexed phrase, but of other emoji than the labels. |
| `phrase-partial` | Every word is known; no phrase covers the query. |
| `word-sense` | One known word; its indexed sense differs from the labels' sense. |

Cross-cut (not a type): **name or keyword over alias**: another emoji has the whole query as its
name or CLDR keyword and ranks first, while a label has it as an alias.

### Alias mode (382 misses)

| Type | en | zh | hi | es | ar | fr | bn | pt | ru | id | tr | all |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| emoji-in-query | 0 | 0 | 0 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| gendered-label | 0 | 0 | 1 | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 1 | 5 |
| disputed-label | 2 | 7 | 4 | 8 | 7 | 8 | 4 | 6 | 2 | 13 | 3 | 64 |
| romanized | 0 | 0 | 34 | 0 | 14 | 0 | 42 | 0 | 0 | 0 | 0 | 90 |
| unsegmented-script | 0 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 20 |
| collision-capped | 3 | 0 | 0 | 2 | 3 | 2 | 0 | 6 | 2 | 0 | 2 | 20 |
| no-match | 0 | 0 | 0 | 0 | 1 | 0 | 2 | 0 | 1 | 2 | 2 | 8 |
| unknown-word | 2 | 0 | 2 | 3 | 1 | 5 | 2 | 1 | 2 | 4 | 4 | 26 |
| exact-phrase-other-emoji | 6 | 11 | 2 | 2 | 3 | 5 | 2 | 3 | 7 | 3 | 3 | 47 |
| phrase-partial | 13 | 0 | 4 | 7 | 4 | 9 | 7 | 10 | 17 | 5 | 13 | 89 |
| word-sense | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 2 |
| **misses** | 26 | 39 | 47 | 23 | 44 | 30 | 59 | 27 | 31 | 27 | 29 | 382 |

### Fused mode (375 misses)

| Type | en | zh | hi | es | ar | fr | bn | pt | ru | id | tr | all |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| emoji-in-query | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| gendered-label | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 2 |
| disputed-label | 1 | 7 | 5 | 8 | 8 | 8 | 5 | 6 | 2 | 14 | 3 | 67 |
| fusion-dropped-alias | 3 | 1 | 11 | 3 | 6 | 4 | 10 | 6 | 2 | 12 | 2 | 60 |
| fusion-dropped-semantic | 4 | 2 | 0 | 1 | 2 | 2 | 1 | 2 | 1 | 1 | 4 | 20 |
| romanized | 0 | 0 | 30 | 0 | 13 | 0 | 37 | 0 | 0 | 0 | 0 | 80 |
| unsegmented-script | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| collision-capped | 1 | 0 | 0 | 2 | 1 | 1 | 0 | 3 | 1 | 0 | 1 | 10 |
| no-match | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 1 | 3 |
| unknown-word | 2 | 0 | 2 | 3 | 0 | 5 | 2 | 1 | 1 | 3 | 3 | 22 |
| exact-phrase-other-emoji | 6 | 5 | 2 | 2 | 2 | 3 | 2 | 4 | 6 | 2 | 2 | 36 |
| phrase-partial | 6 | 0 | 3 | 4 | 3 | 8 | 4 | 8 | 8 | 4 | 9 | 57 |
| word-sense | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| **misses** | 24 | 23 | 53 | 23 | 45 | 31 | 63 | 30 | 22 | 36 | 25 | 375 |

Gated mode on main: 373 misses, the same pattern, plus `gate-skipped` 6 (zh 4, fr 1, ru 1).
Cross-cuts on main: 83 fused misses had a country flag in the top 5 although no label is a flag
(alias mode: 15); name or keyword over alias: 12 queries lose recall@1, 2 lose recall@5.

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
| `collision-capped` | An English two-word compliment for cuteness is an alias of 12 emoji, so it sat in `low` on all of them; 🩷 won. A Portuguese one-word "longing" is an alias of 17 emoji, demoted everywhere; a flag and a tombstone came first. A Spanish one-word "go ahead" interjection, an alias of 10 emoji, demoted everywhere. |
| `no-match` | A Russian rap interjection that is in no phrase. A Bengali "my body aches" sentence with a colloquial verb and a suffixed noun. |
| `unknown-word` | A Portuguese diminutive for "exhausted": the word is unknown and fuzzy-matches "mountain". An English phrase about body aches: the adjective fuzzy-matches a sneeze typo. |
| `exact-phrase-other-emoji` | An English hungry-plus-angry portmanteau is an alias of the cutlery and an ogre; the labels are angry faces. A Russian one-word "cringe" slang is a keyword of the confounded face; the labels are grimacing and clown faces. A Chinese "off we go" phrase is an alias of the cowboy face; the labels are travel emoji. |
| `phrase-partial` | A French "in the juice" idiom (= rushed) matches the juice box. A Russian "my back is falling off" idiom matches the gorilla through "back". A Portuguese "I am broke" slang (literally "broken") matches the broken chain and a crutch. |
| `word-sense` | A Spanish "go ahead" interjection matches a pointing-down alias by the literal verb. A Chinese word for "soothing" matches ❤️‍🩹 through a longer phrase. |
| name or keyword over alias | A Portuguese word meaning "dying (of laughter)": the dizzy face has it as a CLDR keyword and outranks the skull alias. A Russian "lol": a grinning face has it as a keyword; the label has it only as an alias. |

### Canonical misses from in-house testing (not held-out), by type

| Query (locale) | Before | Type | Fix |
| -------------- | ------ | ---- | --- |
| 情人节 (zh) | no result | collision-capped (dropped on > 20 emoji) | prototype 3: now 💌 💕 🌹 … |
| 奥运会 (zh), олимпиада (ru), olympics (en) | 🤽 / 🏊 / ⛷️ or ⏱️ | equal alias scores, catalog order | curation: `low` on the wrong owners → 🏅 |
| 666 (zh) | 6️⃣ | word-sense (number literal) | curation `add` → 👍 🔥 |
| день дурака (ru) | ♠️ (the card game "дурак") | phrase-partial | curation `add` → 😜 🤡 |
| навруз (ru), nowruz (en) | only 🇮🇷 🇹🇯 (low or fuzzy) | no-match / unknown-word | curation `add` → 🌷 🌱 |
| الهالوين (ar) | 🧛 only (via a longer phrase) | unknown-word (definite article ال) | curation `add` → 🎃; generic: article stripping (row 13) |
| football (en) | 🏈 before ⚽ | name or keyword over alias (🏈 has the shortcode, weight 1) | not changed: a regional default belongs to the culture layer |
| a zh cheering phrase | ⛽ (literal "add oil") | name or keyword over alias / word-sense | not changed: it is also a held-out query |

## 3. Proposals, ranked by impact per cost

Impact = held-out recall@5 points (overall, fused/gated unless noted). Cost: S < 1 day, M = a few
days, L = a week or more. Rows 1–3 and 11–12 are measured; the others scale the type counts by a
plausible fix rate.

| Rank | Fix (generic) | Types it targets | Impact | Cost | Status |
| ---: | ------------- | ---------------- | -----: | :--: | ------ |
| 1 | **Confidence-weighted fusion**: semantic weight 0.4–1 from its best cosine (calibrated per model on the in-house set). | fusion-dropped-alias, flags in the top 5 | **+4.6 fused, +4.6 gated (measured, with row 3)** | S | Done (prototype 1) |
| 2 | **Collision cap keeps the 8 strongest owners** of a shared alias at full weight (author order). | collision-capped, ties | **+0.9 fused, +0.8 gated, +0.3 alias (measured); in-house +1.0 alias, +1.4 fused, +1.4 gated; semantic calls 21% → 9% in-house** | S | Done (prototype 3) |
| 3 | **Split unspaced-script runs** into the vocabulary tokens they hold. | unsegmented-script | **zh alias +10.9, overall alias +0.9 (measured)**; fused ±0 | S | Done (prototype 2) |
| 4 | Embed what ships, and keep accents for the model: the eval must embed exactly what the Worker embeds. The Worker can embed a light form (NFKC, lowercase, no emoji, accents kept) and keep `normalize(q)` as the cache key. | measurement; semantic weak | Raw vs `normalize(q)`, measured: semantic +3.4, fused +0.6 (held-out); semantic +3.3, fused −0.5 (in-house) | S | Proposed |
| 5 | Label hygiene: a human decides the heldout-review.md rows; `judge()` folds ♂/♀; the generator already rejects emoji. | disputed-label, gendered-label, emoji-in-query | +2 to +5 *measured* recall, 0 real | S | Proposed (needs a human) |
| 6 | Multilingual emoji documents for the semantic tier: add each locale's CLDR keywords and top aliases (one document per emoji, or one vector file per locale). | semantic weak for the language, phrase-partial, unknown-word | +4 to +8 | M | Proposed |
| 7 | Intent-phrase alias pass: a NEW LLM pass with a different prompt (multi-word reactions, chat slang, inflected forms, 3–5 emoji incl. the main reaction face), written without held-out text, then the in-house gate. | phrase-partial, unknown-word, exact-phrase-other-emoji, word-sense | +3 to +6 | M | Proposed |
| 8 | Romanization layer: index transliterated forms of the hi/bn/ar (and ru, zh pinyin) aliases, and fold Latin spelling variants (vowel length, h-digraphs, Arabizi digits) at index and query time. | romanized | +3 to +5 | M–L | Proposed |
| 9 | Flag damping for non-flag intents: drop semantic-only country flags unless the alias tier also returns one. | flags in the top 5 (43 fused misses after the fixes, 83 before) | 0 R@5 (measured), better precision | S | Proposed |
| 10 | Curate canonical answers found in testing (`add` / `low` in curation.json). | ties, word-sense, no-match | 0 on held-out (none overlap); in-house MRR +0.003 | S | Done (9 queries, section 2) |
| 11 | CLDR keyword weight = alias weight (0.8). | name or keyword over alias | in-house R@1 +2.8, R@5 ±0; held-out R@1 −0.5, R@5 +0.4 (measured, alias mode) | S | Not now: mixed |
| 12 | Tie-break equal scores by the phrase's position in its author's list (instead of catalog order). | ties | in-house alias −1.4, fused −1.4 (measured) | S | Rejected |
| 13 | Arabic clitic stripping (ال، و، ب، ل) for unknown ar tokens; similar light stemming per locale. | unknown-word | +0.5 to +1 | M | Proposed |
| 14 | Lower the gate threshold for non-en locales. | gate-skipped | ≤ +1 (7 queries) | S | Not now |
| 15 | Query-language detection; phrase-level fallback to semantic. | romanized, phrase-partial | ~0 alone: they only route; the gate already sends phrases under 0.9 to the semantic tier. | S–M | Not needed |

Done on main meanwhile: the Worker now has server-side aliases for every pack locale (the
earlier proposal to bundle all locale packs).

## 4. Prototypes and results

### Prototype 1: confidence-weighted fusion (`packages/core/src/fusion.ts`)

- `fuse()` gave the semantic list a fixed weight of 1. With k = 60 the RRF terms of ranks 1–10
  differ by only 13%, so the weights decide the order.
- Now the semantic weight is `0.4 + 0.6 × semanticConfidence`, which maps the best cosine from
  `floor` (0) to `ceiling` (1). bge-m3 @1024: 0.44–0.58 = 25th percentile of the semantic
  misses' best cosine and median of the hits', both on the in-house set. A strong semantic list
  keeps its old weight. `0.4 + confidence` (up to 1.4) scored the same in-house for bge-m3 @1024
  but failed the CI gate for bge-m3 @128, so the conservative form was chosen.
- `pnpm eval` measures the calibration per vector file and fuses non-shipped models with their
  own (cosine scales differ: bge-small 0.56–0.70, embeddinggemma@256 0.39–0.50). Swift port and
  SDK docs updated.

### Prototype 2: split unspaced-script runs (`packages/core/src/engine.ts`, PACK_FORMAT §4)

- A Han, kana, Thai, Lao, Khmer or Myanmar run that is not a vocabulary token is split from the
  left into the longest vocabulary tokens it holds. Unknown code points stay together as one
  piece, which weighs like an unknown word. A run that a vocabulary token completes while typing
  stays whole. No pack change; Swift port updated.

### Prototype 3: collision cap keeps the strongest owners (`packages/data/src/collisions.ts`)

- An alias on more than 8 emoji stays at full weight on its 8 strongest owners: alias before
  typo before low, then its position in the author's list (aliases are written strongest first).
  The other owners still get it as `low` (up to 20 owners) or lose it (more). Demotions
  18,223 → 4,595, drops 7,022 → 5,006. Core packs stay under 200 KB gz with the same alias counts.
- Chosen on the in-house set from 0 (old rule), 3, 5 and 8 kept owners:

| Kept owners | In-house alias | fused | gated | Semantic calls (in-house) | Held-out alias | fused | gated |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 (old) | 96.7 | 95.3 | 95.8 | 21% | 48.9 | 53.5 | 53.8 |
| 3 | 97.2 | 96.3 | 96.7 | 11% | 49.3 | 54.5 | 54.5 |
| 5 | 95.8 | 96.3 | 95.8 | 11% | 49.7 | 54.6 | 54.9 |
| **8** | **97.7** | **96.7** | **97.2** | **9%** | **49.2** | **54.4** | **54.6** |

  (Rows with prototypes 1 and 2 applied, on the `ad48c8c` data.)

### Results on `a1208f5`

Recall@5 (MRR in brackets). In-house: 214 scored queries. Held-out: 734 queries.

| Build | In-house alias | In-house fused | In-house gated | Held-out alias | Held-out fused | Held-out gated |
| ----- | -------------: | -------------: | -------------: | -------------: | -------------: | -------------: |
| main | 96.7 (0.850) | 94.9 (0.885) | 95.3 (0.871) | 48.0 (0.329) | 48.9 (0.361) | 49.2 |
| + fusion, unspaced split | 96.7 (0.850) | 95.3 (0.887) | 95.8 (0.874) | 48.9 (0.338) | 53.5 (0.382) | 53.8 |
| + collision keep 8 | 97.7 (0.869) | 96.7 (0.892) | 97.2 (0.878) | 49.2 (0.340) | 54.4 (0.386) | 54.6 |
| **+ curations (this branch)** | **97.7 (0.872)** | **96.7 (0.892)** | **97.2 (0.881)** | **49.2 (0.340)** | **54.4 (0.386)** | **54.6** |

Earlier ablation (on `6852e0e`): fusion alone gave held-out fused 49.2 → 53.8, the unspaced split
alone gave alias 47.7 → 48.6 (zh 39.1 → 50.0) and nothing in fused mode.

Held-out recall@5 per locale, main → this branch:

| Mode | en | zh | hi | es | ar | fr | bn | pt | ru | id | tr |
| ---- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| alias | 59.4 → 57.8 | 39.1 → **50.0** | 44.0 → 44.0 | 64.1 → 67.2 | 26.7 → 25.0 | 50.8 → 50.8 | 29.8 → 28.6 | 57.8 → 59.4 | 51.6 → 53.1 | 57.1 → 57.1 | 53.2 → 54.8 |
| fused | 62.5 → 62.5 | 64.1 → 62.5 | 36.9 → **50.0** | 64.1 → 68.8 | 25.0 → 26.7 | 49.2 → 52.5 | 25.0 → **36.9** | 53.1 → 60.9 | 65.6 → 67.2 | 42.9 → **55.6** | 59.7 → 59.7 |
| gated | 64.1 → 64.1 | 59.4 → 57.8 | 38.1 → **51.2** | 64.1 → 70.3 | 25.0 → 26.7 | 47.5 → 50.8 | 25.0 → **36.9** | 53.1 → 59.4 | 64.1 → 65.6 | 47.6 → **60.3** | 62.9 → 62.9 |

- Fused misses 375 → 335. `fusion-dropped-alias` 60 → 18, `fusion-dropped-semantic` 20 → 28,
  `collision-capped` 10 → 6. Fused misses with a country flag in the top 5: 83 → 43.
- Fused is at or above alias in 10 of 11 locales (before: 5); id is 1.5 below.
- Losses: zh fused and gated −1.6, en/ar/bn alias −1.6/−1.7/−1.2 (one query each).
- In-house: no shipped-model row lost; the CI gate passes. Of the non-shipped benchmark rows, only
  embeddinggemma@256 lost (fused 97.7 → 96.7, gated 97.2 → 96.7); every other row is equal or
  better. `reports/baseline.json` and `reports/heldout-baseline.json` hold these numbers.
- The en and tr packs changed, so the Swift golden file is regenerated (Node 24, as `.nvmrc`);
  Swift conformance is 100%. The Worker's bundled en/tr packs (`packages/worker/src/generated`)
  predate this branch: run `pnpm --filter @emojisense/worker sync` before the next deploy.

## 5. Caveats

- About 60–84 queries per locale: one query is 1.2–1.6 points.
- The held-out labels are one model's; 64 alias misses have disputed labels (not applied).
- The semantic calibration is model-specific. A model change must update
  `DEFAULT_SEMANTIC_CALIBRATION` (TypeScript and Swift); `pnpm eval` prints the measured values.
- Finding 10 means the fused numbers here (and in heldout.md) are about 0.6 points above what the
  Worker serves today.
- Reproduce: `pnpm data:build`, then `pnpm --filter @emojisense/eval eval -- --offline` and
  `pnpm --filter @emojisense/eval eval:diagnose -- --offline`.
