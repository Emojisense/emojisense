# Emojisense pack format v1

This document is normative. A client in any language (TypeScript, Swift, Kotlin) that follows it
gets the same search results as `packages/core`. The words MUST and SHOULD have their RFC 2119
meaning.

A **pack version** (e.g. `0.1.0`) is a directory of immutable files:

```
/v1/pack/<packVersion>/
  manifest.json                       versions, hashes, sizes
  pack.en.json                        Tier 0 core, English (always load first; ≤ 200 KB gz)
  pack.en.ext.json                    Tier 0 extension, English (load when idle)
  pack.<locale>.json / .ext.json      core / extension of every other locale (zh, hi, es, ar, fr,
                                      bn, pt, ru, id, tr; load next to English for that UI locale)
  vectors.<model>.<dims>.bin          Tier 1 emoji vectors, one file per model × dims (English documents)
  vectors.<model>.<dims>.<locale>.bin Tier 1 emoji vectors of one locale's documents (optional, §5)
  vectors.<model>.<dims>.glyph.bin    Tier 1 glyph vectors, several rows per emoji (optional, §5)
```

Files never change after publication. A change produces a new pack version. Serve them with
`Cache-Control: public, max-age=31536000, immutable`.

## 1. manifest.json

```json
{
  "format": "emojisense-manifest",
  "formatVersion": 1,
  "packVersion": "0.1.0",
  "emojiVersion": "17.0",
  "emojiCount": 1914,
  "source": { "emojibaseVersion": "17.0.0", "cldrVersion": "48.2.0" },
  "coreAliases": { "en": 16, "hi": 14 },
  "files": {
    "pack.en.json": { "sha256": "…", "bytes": 1234, "gzipBytes": 456, "locale": "en" },
    "vectors.bge-m3.1024.bin": {
      "sha256": "…", "bytes": 2229760, "gzipBytes": 1751207,
      "model": "@cf/baai/bge-m3", "dims": 1024,
      "queryTemplate": "{q}"
    },
    "vectors.bge-m3.1024.es.bin": {
      "sha256": "…", "bytes": 2229760, "gzipBytes": 1762125, "locale": "es",
      "model": "@cf/baai/bge-m3", "dims": 1024,
      "queryTemplate": "{q}"
    }
  }
}
```

- Clients SHOULD verify `sha256` (lowercase hex of the raw file bytes) before they cache a file.
- `coreAliases` is informational: how many aliases per emoji each locale's core part keeps (§2).
- `queryTemplate` is the exact string to embed for a query. `{q}` is replaced by the
  query's embedding text (§3, "Embedding text"). Only needed by clients that embed queries
  themselves.
- A vector file with a `locale` key holds that locale's document vectors (§5). The glyph file has
  `"glyph": true`.
- `source.popularity` credits the popularity data of `pack.en.json` (§2), as its license asks.

## 2. pack.<locale>.json

```json
{
  "format": "emojisense-pack",
  "formatVersion": 1,
  "packVersion": "0.1.0",
  "locale": "en",
  "emojiVersion": "17.0",
  "groups": ["smileys-emotion", "people-body", "…"],
  "weights": { "alias": 0.8 },
  "emoji": [
    ["🦖", "1F996", 2, 5, 0, "T-Rex", "t rex", "dinosaur|rex|t|t rex|tyrannosaurus", "jurassic park|dino|…", "dinasour|…", "…"]
  ]
}
```

A client MUST reject a pack whose `format` differs or whose `formatVersion` it does not support.

**Popularity.** The English core pack has an optional pack-level key `popularity`: one integer
0–100 per row, in row order, the percentile of how often people use that emoji (0 = unknown). It
breaks equal alias scores (§4) and is a feature of fusion (§10). Source: Emoji-SP (Ferré et al.
2023, CC BY 4.0), rated frequency of use of 1,031 emoji; a gender or skin-tone variant without
its own rating takes its family's best (`packages/data/src/popularity.ts`). A client that loads
other packs MUST take `popularity` from whichever loaded pack has it; packs without the key rank
as before.

### Core and extension parts

Each locale ships in two parts with the same row layout and row order:

| Part | File | `part` key | Holds |
| ---- | ---- | ---------- | ----- |
| core | `pack.<locale>.json` | absent or `"core"` | label, shortcodes, keywords, the first N aliases (N ≤ `pack.config.json` → `initialAliases`, lowered per locale until the part is ≤ 200 KB gz; manifest `coreAliases`) |
| ext | `pack.<locale>.ext.json` | `"ext"` | the remaining aliases, all typos, all low-confidence phrases. `label`, `shortcode` and `keyword` are empty. |

Render with the core parts. Load the ext parts when the device is idle and rebuild the index with
all parts. Index order: every core part first (English first), then the ext parts. All parts of
one locale count as that locale for the preferred-locale factor (§4). An empty `label` MUST NOT
replace a label from another part.

A third part, `"custom"`, holds an app's own emoji. It is not a file of a pack version: the API
builds it per app (§8).

### Rows

Each element of `emoji` is an array with 11 positions. Row order is the display order (CLDR
order). Every locale pack of one pack version has the same rows in the same order.

| # | Name | Type | Meaning |
| - | ---- | ---- | ------- |
| 0 | emoji | string | The emoji, fully qualified (with U+FE0F where CLDR has it). |
| 1 | hexcode | string | Emojibase hexcode of the **base** emoji, e.g. `1F44D`. This is the stable id. |
| 2 | group | int | Index into `groups`. |
| 3 | version | number | Emoji version that introduced it (e.g. `15.1`). Hide rows the OS cannot render. |
| 4 | skins | 0 \| 1 | 1 = supports skin tones. Variant = hexcode + `-1F3FB` … `-1F3FF`. |
| 5 | label | string | Display label in this locale. Not normalized. |
| 6 | shortcode | phrases | Shortcodes (GitHub, Slack-style, Emojibase), normalized. |
| 7 | keyword | phrases | CLDR keywords for this locale. |
| 8 | alias | phrases | Generated aliases: synonyms, slang, pop culture, dev, intent. Strongest first. |
| 9 | typo | phrases | Common misspellings. |
| 10 | low | phrases | Low-confidence or demoted aliases. |

**phrases** = phrases joined with `|`. Each phrase is already normalized (§3), so it contains
only `[a-z0-9+ ]` after folding plus letters of other scripts. It never contains `|`. An empty
string means no phrases.

Search fields, strongest first, with default weights (a pack MAY override them in `weights`):

| Field | Source | Weight |
| ----- | ------ | -----: |
| name | `normalize(label)` (derived, not stored) | 1.00 |
| shortcode | row[6] | 0.95 |
| keyword | row[7] | 0.85 |
| alias | row[8] | 0.80 |
| typo | row[9] | 0.75 |
| low | row[10] | 0.55 |

When the same phrase occurs twice for one emoji, only the strongest field counts.

## 3. Normalization

Apply to every query, and to `label` to get the `name` field. In order:

1. Unicode NFKC.
2. Replace every code point with property `Extended_Pictographic`, `Emoji_Modifier` or
   `Regional_Indicator`, and U+E0020–U+E007F, with a space.
3. Remove U+200D, U+FE0E, U+FE0F and U+20E3.
4. Lowercase (locale-independent Unicode default case mapping).
5. Unicode NFD, then remove only the **optional** marks: U+0300–U+036F (Latin, Greek and
   Cyrillic diacritics), U+064B–U+065F and U+0670 (Arabic harakat), U+0640 (tatweel), and
   U+0591–U+05C7 (Hebrew points). Keep all other marks: in Devanagari, Bengali, Thai or Japanese
   they are part of the spelling.
6. Replace `ı`→`i`, `đ`→`d`, `ł`→`l`, `ø`→`o`, `ß`→`ss`.
7. Unicode NFC (recomposes Hangul and kana).
8. Remove the apostrophes `'` `’` `` ` `` `´`.
9. Replace each run of characters that are not a letter (`L`), a mark (`M`), a number (`N`) or
   `+` with one space.
10. Replace each `+` that is not followed by a digit with a space.
11. Collapse whitespace runs to one space and trim.
12. Truncate to 64 UTF-16 code units, then trim the end.

Scripts without spaces between words (Chinese, Japanese, Thai) form one token per run. Prefix
matching still completes them while the user types. A query run that is not one indexed token is
split at search time (§4, "Unspaced scripts").

Examples: `"İYİ Kİ DOĞDUN"` → `"iyi ki dogdun"`, `"¡Feliz cumpleaños!"` → `"feliz cumpleanos"`,
`"Ёлка"` → `"елка"`, `"مَرْحَبًا"` → `"مرحبا"`, `"नमस्ते"` → `"नमस्ते"` (unchanged), `"i'm exhausted"` → `"im exhausted"`,
`":rocket:"` → `"rocket"`, `"+1"` → `"+1"`, `"🚀 launch 👍🏽"` → `"launch"`.

Tokens are the result split on single spaces.

**Embedding text.** The semantic tier embeds a lighter form of the query, because the embedding
model reads accents and punctuation (folding them cost about 3 points of semantic recall@5):
Unicode NFKC, lowercase, NFKC again, each run of `\p{Cc}`, `\p{Z}` or U+FEFF to one space, trim,
then truncate to 64 UTF-16 code units without splitting a surrogate pair. Accents, punctuation
and emoji stay: `"  Doğum GÜNÜ!! "` → `"doğum günü!!"`. Its normalized form (steps 1–12) is the
normalized query. Reference: `embeddingText` in `packages/core/src/normalize.ts`.

## 4. Tier 0 search (reference algorithm)

The reference implementation is `packages/core/src/engine.ts`. A port SHOULD match it, so that
the shared eval set gives the same numbers on every platform.

**Index.** For every row of every loaded pack, collect phrases per field. Build a sorted
vocabulary of all tokens, postings token → phrases, and for each token
`idf = ln(1 + E / df)`, where `E` is the emoji count and `df` is the number of distinct emoji
that have the token in any phrase.

**Query.** Normalize and tokenize the query, keeping at most 8 tokens.

**Function words.** Each pack locale has a list of function words: pronouns, articles,
prepositions, conjunctions, auxiliaries, particles and intensifiers, plus common romanized forms
(Hinglish, Banglish, Arabizi, Russian translit). Negations and question words are never in it.
The entries are normalized (§3) single tokens; the reference lists are `FUNCTION_WORDS` in
`packages/core/src/function-words.ts`, and a port MUST copy them exactly. A query uses the list
of its preferred locale (see below) plus the `en` and `tr` lists; for a locale without a list,
only `en` and `tr`. Lists of other locales do not apply: es `son` ("they are") is en `son`. A
query token in that set is a function word. Changing a list changes rankings like any change to
this algorithm; no file of a pack version changes.

**Unspaced scripts.** A query token that holds a code point in U+0E00–0EFF (Thai, Lao),
U+1000–109F (Myanmar), U+1780–17FF (Khmer), U+3040–30FF (kana), U+3400–4DBF, U+4E00–9FFF,
U+F900–FAFF or U+20000–3134F (Han) is split when it is not a vocabulary token, unless it is the
last token while typing and a longer vocabulary token starts with it. Split from the left: at each
code point take the longest vocabulary token or function word (at most 16 code points) that
starts there. Code points where neither starts form one unknown piece together with the unknown
code points next to them. The pieces replace the token, in order; keep at most 8 tokens again.
The pieces are the query's `tokens`. Example, with 生日快乐 indexed: 今天生日快乐 → 今天 · 生日快乐;
with 躺平 indexed: 我想躺平 → 我 · 想 · 躺平 (我 and 想 are zh function words).

For each query token, find candidate vocabulary tokens with a match quality:

| Match | Quality |
| ----- | ------: |
| exact | 1.0 |
| prefix (only the last token, only while typing, i.e. the raw query does not end with whitespace) | 0.6 + 0.35 × len(query token) / len(vocab token); × 0.5 when the query token is itself a vocabulary token |
| final repeated letter removed (`upp` → `up`), only if there is no exact match | 0.85 |
| optimal-string-alignment distance 1 (token length 4–7) or ≤ 2 (length ≥ 8), only if there is no exact match | 0.8 (d = 1; 0.7 for a query token of at most 5 UTF-16 code units), 0.65 (d = 2) |

A query token that is a whole vocabulary word means that word before its completions: en "hell"
is hell (😈 👿) before "hello" (👋), "bee" is 🐝 before "beer" (🍺); the completions stay in the
list, lower (added 2026-10-03). A one-edit typo of a short token is weaker because a short unknown
word is often a name: en "messi" is not "messy".

When the query has at least one token that is not a function word, a function word has one
candidate only: the vocabulary token equal to it (quality 1.0), if there is one. It is never a
prefix or a typo of another token, so a trailing zh 了 does not stand for 了解. A query made only
of function words (ru "я тоже", en "me too") is expanded like any other query.

The weight of query token *i* is the idf of its best candidate, or the largest idf in the index
when there is no candidate. The weight of a function word is capped at 0.3, so function words
cannot keep a phrase that covers the content words below the coverage threshold.

**Phrase score.** `coverage = Σ quality_i × weight_i / Σ weight_i`, with `quality_i` the best
quality of a candidate of token *i* inside this phrase. Phrases with coverage < 0.34 are
ignored. Then:

```
score = fieldWeight × coverage × (0.6 + 0.4 × min(1, matchedTokens / phraseTokens))
        × (exactPhrase ? (query tokens ≥ 2 ? 1.1 : 1) : 0.9) × (phrase in preferred-locale pack ? 1 : 0.92)
```

`exactPhrase` = every query token matched exactly and the phrase has as many tokens as the query.
The **preferred locale** is the query's locale, or the locale of the first loaded pack when the
query has none. A phrase is in a preferred-locale pack when any pack of that locale (core or ext)
contains it for this emoji.

**Emoji score.** The best phrase score, plus 0.02 for every other matching phrase that is in a
preferred-locale pack (at most +0.06), capped at 1. Phrases of other locales never add this
bonus, so many loaded languages that share a loanword ("halloween") cannot lift every emoji to
the cap.

**Whole query before a partial match.** The bonus breaks near-ties only. For each emoji whose
best phrase is not an `exactPhrase` match, let `W` be the lowest emoji score among the emoji
whose best phrase is an `exactPhrase` match in a preferred-locale pack and has a higher phrase
score (before the bonus). When there is one, the emoji scores at most `W − 0.01`. Without this,
en "ship it" gave 🚢 (name `ship`, the stopword uncovered, plus +0.06 from its other ship
phrases) before 🚀 (alias `ship it`).

**Preferred exact match first.** Let `P` be the highest emoji score among the emoji that have
an `exactPhrase` match in the `name`, `shortcode`, `keyword` or `alias` field of a
preferred-locale pack. When there is one, every emoji without such a match whose best phrase is
an `exactPhrase` match in the `name` or `shortcode` field of another pack scores at most
`P − 0.01`. These two fields outweigh a preferred keyword or alias even after the foreign
factor, so without this fr "foot" gave 🦶 (English name `foot`) before ⚽ (French alias `foot`).

**Partial matches.** Names the dictionary does not know must not borrow a part of a word
(added 2026-10-02; en "kendrick lamar" gave 💍 by id "lamaran" and 🦙 by tr "lama"):

- A token *matches nothing* when it has no candidate (function words do not count).
- *Preferred-locale token*: a vocabulary token that occurs in a phrase of a preferred-locale
  pack (custom packs count for every locale).
- *Prefix completion into another locale's word*: a prefix candidate that is not a
  preferred-locale token. Its quality is `(0.6 + 0.35 × len(query token) / len(vocab token)) × 0.7`,
  and it is a **partial** match.
- *Short typo*: for a query token of at most 5 UTF-16 code units, a candidate of the
  optimal-string-alignment step is used only when it is a preferred-locale token and the query
  token does not start with it ("rockt" is "rocket", not "rock"; en "lamar" is not tr "lama").
  The repeated-final-letter step is not affected.
- In a query with a token that matches nothing, a phrase that matches exactly one query token,
  and not exactly (by prefix or typo), is ignored.
- After the two caps above: let `L` be the lowest emoji score among the emoji whose best phrase
  is in a preferred-locale pack and has no partial match. When there is one, every emoji whose
  best phrase has a partial match scores at most `max(0, L − 0.01)`.

**Coverage.** For each phrase that is kept, its *whole coverage* is `Σ weight_i / Σ weight` over
the query tokens it matches with a candidate that is not partial (exact, a typo, or a completion
of the token being typed into a preferred-locale word). The output's `coverage` is the largest
whole coverage, rounded to 3 decimals (0 without results). `assessConfidence` (core,
`confidence.ts`) calls the dictionary sure of a query when `coverage ≥ 0.85` and the top score
`≥ 0.6`.

Sort by score (descending), then by `popularity` (§2, descending), then by row order.
`confidence` = the top score; `coverage` as above. Without `popularity`, equal scores keep row order.

**Split words** (added 2026-10-03). Find the first pair of neighbouring query tokens, both at least
2 UTF-16 code units, whose concatenation is a vocabulary token and has no unspaced-script code
point (en "hallo ween" → "halloween", "rain bow" → "rainbow"). When there is one, search the query
with that pair joined as well (one token; a trailing space of the raw query is kept) and merge:
start from the as-typed results; for each joined result, its score × 0.95, rounded to 3
decimals, replaces the as-typed score of the same emoji when there is none or it is higher. Sort
by score, descending, stable (as-typed order, then joined order), and cut to `limit`.
`confidence` = the top score; `coverage` = the larger of the two; `query` and `tokens` stay the
as-typed ones.

## 5. Vectors (`vectors.<model>.<dims>.bin`, "ESVEC1")

Little-endian. All offsets are in bytes from the file start.

| Offset | Size | Field |
| -----: | ---: | ----- |
| 0 | 8 | magic `"ESVEC1\0\0"` (ASCII) |
| 8 | 4 | u32 `count` (rows) |
| 12 | 4 | u32 `dims` (multiple of 8) |
| 16 | 4 | u32 `modelLength` (bytes) |
| 20 | 4 | u32 `idsLength` (bytes) |
| 24 | 8 | reserved, zero |
| 32 | modelLength | model id, UTF-8 (e.g. `@cf/baai/bge-m3`) |
| A = align4(32 + modelLength) | idsLength | hexcodes joined with `\n`, UTF-8; row order |
| S = align4(A + idsLength) | 4 × count | f32 `scale` per row |
| V = S + 4 × count | count × dims | i8 quantized components, row-major |
| V + count × dims | count × dims / 8 | sign bits, row-major; bit `k` of the row is byte `(r·dims + k) >> 3`, bit `(r·dims + k) & 7`; 1 = component > 0 |

- Component `d` of row `r` ≈ `i8[r·dims + d] × scale[r]`. Before quantization, each row was
  L2-normalized, so a dot product with a normalized query is cosine similarity.
- Rows were embedded at the model's native dims, truncated to `dims` (Matryoshka), and then
  L2-normalized again. A query vector MUST get the same treatment.
- Queries MUST be embedded with the same model, using `queryTemplate` from the manifest.
  A vector file must never be compared with vectors from another model or with other dims.
- Sign bits allow a cheap Hamming-distance shortlist on weak devices before an int8 rerank.

**Shared and locale files.** Each model × dims has one **shared** file, embedded from English
documents. A multilingual model MAY also have one **locale** file per pack locale,
`vectors.<model>.<dims>.<locale>.bin` (e.g. `vectors.bge-m3.1024.es.bin`), embedded from that
locale's documents. A document is `"<label>. <description> <CLDR keywords>, <first 40 aliases>"`
in its language (`packages/data/src/documents.ts`). All files of one model × dims have the same
binary layout, `model`, `dims` and rows (hexcodes in pack order). In the manifest, a locale file
has a `locale` key; the shared file has none.

- A query of locale `L` scores each emoji by its best row over the shared file and `L`'s file:
  `max(cos(q, shared[e]), cos(q, L[e]))`. Without a file for `L` (English, or a locale that has
  none), the shared file alone gives the ranking. Reference: `searchVectorSets` in
  `emojisense/vectors` (`packages/core/src/vectors.ts`).
- A client MAY load the shared file only. Its results stay valid; they are the English-document
  ranking.

**Glyph file.** `vectors.<model>.<dims>.glyph.bin` (optional) has the same layout, but its rows are
not one per emoji: each row embeds a short text that holds the emoji itself, and its id may
repeat. The published file holds the bare glyph, fully qualified (`"💀"`), one row per emoji;
a gender or skin-tone variant embeds its base glyph. A glyph the model reads as an unknown token
embeds to the same vector as every other unknown glyph: such rows are dropped (bge-m3: 910 of
1,914). Texts: `packages/data/src/glyph-documents.ts`; build: `pnpm --filter @emojisense/data
embed:glyph`. Readers that know only document files ignore it (its name has no locale).

**Semantic score.** The Search API ranks its semantic list (`mode=semantic`, the semantic half of
`hybrid`, and the shards of §6) by

```
score(e) = max over the document files (above)
         + 0.04 × popularity(e)                                   popularity: §2, 0–1
         + 0.25 × (g(e) − mean of g over the emoji with a glyph row)   0 without a glyph row
```

where `g(e)` is the best cosine of the query to `e`'s glyph rows. Centring per query removes the
part every lone glyph shares (a cosine ≈ 0.55 to most queries). `score` is what the API returns,
to three decimals. Reference: `semanticBonus` in `packages/data/src/semantic-score.ts`.

## 6. Shards (layer 2: precomputed results)

Queries that the on-device dictionary cannot answer get their semantic results precomputed and
published as static files, in two layers per locale:

- **live**: real queries, rebuilt every night from the query counts (ARCHITECTURE.md, "Nightly
  shard build"),
- **base**: synthetic queries from our own data, built with the pack (`pnpm --filter
  @emojisense/data build:shards:base`, published with `upload:shards`), so layer 2 answers
  before any query log exists.

```
/p/<packVersion>/index.json            live index, English: {"format":"emojisense-shards","formatVersion":1,
                                        "packVersion":"0.1.0","model":"embeddinggemma@768",
                                        "keys":["a","ab", … ,"th","the "],
                                        "files":{"a":"f/3f9a0c1d2e4b5a69.json", …},"base":"f/b1c2….json"}
/p/<packVersion>/<locale>/index.json   the live index of another pack locale, e.g. /p/0.1.0/tr/index.json
                                        ("files":{"do":"../f/….json"}, "base":"../f/….json")
/p/<packVersion>/f/<hash>.json         a shard file {"key":"co","entries":{"congrats on the launch":[["🚀","1F680",0.81], …]}}
                                        or a base index (the index shape, no "base" of its own)
```

- `keys` are sorted. A query uses the **longest key that is a prefix of the normalized query**.
  Hot prefixes get longer keys (adaptive split), so each shard stays ≤ ~30 KB gz.
- `files` maps each key to its file, as a URL relative to the index. Files are named by their
  content (the first 16 hex digits of the SHA-256 of the file), so a file never changes: it is
  served `immutable` for a year, and a file that two nightly builds share is downloaded once.
- `base` names the base index of the same locale, relative to the live index. Its `files` are
  relative to the base index. A client asks the live layer, then the base layer; it may load
  both shards at once. The nightly build leaves out the queries that the base layer holds.
- **Older clients** (no `files`) read `<key>.json` next to the index, file name
  `encodeURIComponent(key)`, and know no base layer. The API Worker's `/p/*` route maps that
  name to the hashed file, so those URLs keep working on the API host.
- `entries` maps a normalized query (§3) to semantic results `[emoji, hexcode, score]`, best
  first. These are the same results the API returns with `mode=semantic` for that model and
  locale: the English files hold the `locale=en` answers (the shared vector file only, §5), the
  files of `<locale>/` the answers of that locale (the shared vector file and the locale's own).
- **Locale shards.** A client reads the directory of its search locale: English (and no locale)
  at `/p/<packVersion>/`, every other pack locale at `/p/<packVersion>/<locale>/`, where `<locale>`
  is the language subtag in lowercase (`pt-BR` → `pt`), like the API's `locale`. `en/` is an alias
  of the English files on the API host. A locale without shards answers `404` for its
  `index.json`, and the client asks the API.
- A live query is in a locale's files only when it was searched in that locale (the k-anonymity
  thresholds hold per locale) and that locale's on-device dictionary does not answer it with
  confidence.
- A client downloads each index once per session (`index.json` is cached for 1 hour) and each
  shard file at most once, then answers locally, between keystrokes and without a debounce. A
  query that is not in its shards goes to the API.
- Shards are valid only for the `model` they name. A new model or pack version publishes a new
  directory.
- A client uses a shard only when `embeddingText(query)` equals `normalize(query)` (§3). The API
  embeds the text as typed, accents and punctuation kept, so a query such as "doğum günü" or
  "i'm done!" goes to the API instead of taking the answer of its folded form.
- **Hosts.** The files are in one R2 bucket, served by the CDN at `cdn.emojisense.com/p/…` (no
  Worker, free per request) and by the API Worker at `api.emojisense.com/p/…` (the same files,
  for older clients). Under one pack version the answers can lag a deploy by up to a day: the
  next nightly build publishes the deployed data's answers.
- No key is ever `index`: its file name would be `index.json` on the API host.

## 7. Versioning

- `formatVersion` changes only for breaking layout changes. Adding optional manifest keys or
  pack-level keys is not breaking. Adding a row position is breaking.
- `packVersion` is semver for the data. A patch has alias changes only. A minor adds emoji or
  locales. A major changes ids.
- The search algorithm of §4, function-word lists included, belongs to the client library, not to
  the pack: a pack of any version works with it. A port matches the reference of the same
  library release; the Swift golden file (`sdks/swift`) checks the lists and the rankings.

## 8. Custom packs (an app's own emoji)

`GET /v1/custom-pack?key=…[&tenant=<externalId>]` (docs/API.md) returns the custom emoji of the
key's app, plus those of one tenant, as a pack of `formatVersion` 1 with the same row layout:

```json
{
  "format": "emojisense-pack",
  "formatVersion": 1,
  "packVersion": "custom-3f9a0c1e",
  "locale": "und",
  "part": "custom",
  "emojiVersion": "",
  "groups": ["custom"],
  "emoji": [
    [":party_parrot:", "C-x7Kq2", 0, 0, 0, "party_parrot", "party parrot", "", "celebrate|dance", "", ""]
  ],
  "images": { "C-x7Kq2": "https://api.emojisense.com/v1/custom/app_1/x7Kq2" }
}
```

| Key or row position | Value |
| ------------------- | ----- |
| `part` | `"custom"` |
| `locale` | `"und"` (BCP 47 "undetermined"): custom emoji belong to no locale |
| `packVersion` | `custom-` + 8 hex characters, a hash of the rows and images. It changes when the set changes. |
| `images` | Image URL per hexcode. Images are immutable (docs/API.md, `GET /v1/custom/:appId/:emojiId`). |
| row[0] emoji | `:shortcode:`. Draw the image of `images[row[1]]` instead of text; use `:shortcode:` as its alt text. |
| row[1] hexcode | `C-<emojiId>`. The `C-` prefix never collides with an Emojibase hexcode. |
| row[2] group | `0` = `groups[0]` = `"custom"` |
| row[3] version | `0`: every device can draw an image |
| row[4] skins | `0`: skin tones do not apply |
| row[5] label | the shortcode without colons; its normalized form is the `name` field |
| row[6] shortcode | the normalized shortcode (`party_parrot` → `party parrot`) |
| row[7] keyword | empty |
| row[8] alias | the emoji's aliases, normalized (§3) |
| row[9], row[10] | empty |

A tenant emoji replaces an app-wide emoji with the same shortcode. Rows are sorted by shortcode.

**Search.** Load a custom pack after the locale packs and index all of them together:

- Primary pack: the first pack that is not custom. Custom rows are appended as their own entries
  (they are not merged into catalog rows) and take part in IDF like any other entry.
- Custom phrases count for every locale: the preferred-locale factor (§4) is always 1 for them.
- A matching custom row is a result with `source: "custom"` and the extra fields `imageUrl`
  (from `images`) and `shortcode`. Catalog results keep their shape.
- The engine's `locales` do not include `und`.

The API merges the same custom matches into `/v1/search` and `/v1/suggest-reactions`, first. A
client that fuses its own results with the API's sees each custom emoji once (fusion is by `id`).
Clients without custom-pack support can ignore packs with `part: "custom"`: their layout is valid
and their rows never match catalog hexcodes.

## 9. Culture files (the culture layer)

Editorial associations that add emoji next to the canonical answer, by culture, region and
moment (docs/ARCHITECTURE.md, "Culture layer"). One small file per locale, built at deploy for
the next 12 months; clients decide by their own day what is active, so it needs no daily rebuild:

```
/v1/culture/<packVersion>/culture.<locale>.json     Cache-Control: public, max-age=3600 (not immutable)
/v1/culture/<packVersion>/index.json                build date, window and per-locale sizes (informational)
```

Entries editors approve in the dashboard are merged into the deployed files and published to R2
without a deploy (docs/CULTURE.md); the format and URLs stay the same, and the `index.json` of
such a build adds `build` (its id) and `live` (the merged entry ids).

```json
{
  "format": "emojisense-culture",
  "formatVersion": 1,
  "packVersion": "0.1.0",
  "locale": "es",
  "from": "2026-10-02",
  "until": "2027-10-03",
  "entries": [
    {
      "id": "goat-football",
      "kind": "lasting",
      "context": "El debate sobre el mejor futbolista de la historia",
      "when": null,
      "regions": ["*"],
      "triggers": ["goat", "el goat", "el mejor de la historia"],
      "emoji": [["🐐", "1F410", 0.7], ["⚽", "26BD", 0.6], ["🇦🇷", "1F1E6-1F1F7", 0.45]]
    },
    {
      "id": "halloween",
      "kind": "seasonal",
      "context": "Halloween, 31 de octubre",
      "when": { "from": "10-15", "to": "10-31", "recurs": "yearly" },
      "regions": ["*"],
      "triggers": ["halloween", "noche de brujas"],
      "emoji": [["🎃", "1F383", 0.9], ["👻", "1F47B", 0.75]],
      "featured": true
    }
  ],
  "relevantNow": []
}
```

A client MUST reject a file whose `format` differs or whose `formatVersion` it does not support.

| Key | Meaning |
| --- | ------- |
| `from`, `until` | Days the build covered: the file holds every lasting entry, plus the seasonal and event entries active on any day of [`from`, `until`]. A build covers 366 days (at least 12 months, also across a leap day), so every yearly entry is in the file. |
| `entries[].kind` | `lasting`, `seasonal` (a yearly window), `event` (one dated window, ≤ 60 days) or `regional` (a word whose main sense differs by region, always active; see step 3). A festival on a lunar calendar is one event entry per year (`diwali-2026`). |
| `entries[].context` | The reason, in this file's locale. Neutral, ≤ 90 characters. |
| `entries[].when` | `null` (always), `{ from: "MM-DD", to: "MM-DD", recurs: "yearly" }` (may wrap the year end, e.g. `12-26` → `01-02`) or `{ from: "YYYY-MM-DD", to: "YYYY-MM-DD" }`. Days are inclusive and compared with the user's **local** calendar day (the search API: `day=`, else the local day of the caller's time zone, else UTC). |
| `entries[].regions` | ISO 3166-1 alpha-2 codes, or `["*"]`. Without a region, only `"*"` entries apply. SDKs use the device's region unless the app says otherwise (see `zones`). |
| `entries[].exceptRegions` | Optional, with `regions: ["*"]`: codes where the entry does not apply when the app names one of them. |
| `entries[].outranks` | `regional` entries only: hexcodes of the canonical top answers the regional sense may move to second place. |
| `entries[].triggers` | Normalized phrases (§3) that people of this locale type. |
| `entries[].emoji` | `[emoji, hexcode, weight]`, strongest first; weight in (0, 1]. Base hexcodes only. |
| `entries[].featured` | May appear on an optional "relevant now" shelf (seasonal and event entries only). |
| `relevantNow` | Always `[]` in 12-month files (see below). In older files: ids of the featured entries active on `from`, in shelf order, for clients that do not evaluate windows. |
| `zones` | Optional (files since 2026-10-03): IANA time zone → ISO 3166-1 alpha-2 region, for the regions that the file's entries name (`regions`, `exceptRegions`), from the tz database's zone.tab plus the names browsers report (`Asia/Calcutta` next to `Asia/Kolkata`). A client whose language has no region ("ja") takes the region of its time zone here. A zone of any other region is left out: it would change no result. Older clients ignore the key. |

**Applying it (reference: `packages/core/src/culture.ts`).**

1. Normalize the query (§3). An entry applies when its window is active today and its regions
   match. A trigger matches when it equals the query (quality 1), or, while the user is typing
   (no trailing space), when the query is a prefix of the trigger with ≥ 3 characters and at least
   half its length (quality `0.6 + 0.4 × len(query) / len(trigger)`).
2. Score each emoji `weight × quality`; keep the best score per hexcode; take the best 5.
   Drop emoji the loaded packs do not have.
3. Insert them right after the **canonical top result** (after fusion with semantic results),
   skipping the top result's own emoji; an emoji that is already lower in the list moves up.
   Never put a culture emoji above the canonical top result, except when the canonical list is
   empty, or for a **regional sense**: when the app names a region in a `regional` entry's scope,
   the normalized query equals one of its triggers (not a prefix) and the canonical top result is
   one of its `outranks`, its strongest emoji goes first and the canonical top result second
   (several qualify: the strongest wins). Cut the list to the requested limit.
4. Mark them `source: "culture"` with `context` and `cultureId`. An option to turn the layer off
   (`culture: false`) MUST exist for reproducible ranking.

`regional`, `exceptRegions` and `outranks` came after the first files, under the same
`formatVersion: 1`. A client that does not know them treats a regional entry as a lasting one and
ignores `exceptRegions`: it adds the emoji after the top result (also in an excluded region), never
above it. That is safe under the add-never-replace rule.

The **relevant now** shelf lists the featured seasonal and event entries active today (in file
order, which puts events first), taking one emoji from each entry in turn.

The source format (`packages/data/culture/entries/<id>.json`, one file per association with a
status, context and triggers per locale, and provenance) is described by
`packages/data/culture/schema.json`.

**12-month files (2026-10-02), same `formatVersion: 1`.** Files used to cover 14 days and needed a
daily rebuild. Now a build covers 366 days from the day before the deploy (UTC, so a device west
of UTC that is still on that day finds it), and the client checks every entry's `when` against its
own day at query time, as step 1 always required. The keys and their types did not change, so
old clients keep loading the files:

| Client | Behaviour with a 12-month file |
| ------ | ------------------------------ |
| Checks windows (every emojisense SDK so far, the search API) | Correct on every day of the 12 months, with no new download. |
| Reads `relevantNow` instead of checking windows | Gets `[]` and shows no shelf, never an out-of-date one. |
| Ignores `when` (breaks step 1) | Already wrong with 14-day files; now shows seasonal entries all year. Fix the client. |

The files change only at a deploy, so new or edited entries still need a sync and a deploy. A
file whose `until` has passed still works for lasting and yearly entries but misses later events.

## 10. Fusion (alias + semantic)

A client that shows alias and semantic results together (a search session, the Search API in
`mode=hybrid`, the MCP server) merges them with `fuse(alias, semantic, limit, calibration,
{ popularity })` (`packages/core/src/fusion.ts`, `rerank.ts`; Swift `Fusion.fuse`, Kotlin
`Fusion.fuse`). A port SHOULD give the same order; the golden file checks it on recorded lists.

**Candidates whatever the limit.** The features read the lists (ranks, the lowest semantic
score), so both lists MUST hold `RANK_DEPTH` = 24 candidates (or `limit`, when larger) before
fusion; the fused list is cut to `limit`. A client showing 12 results ranks like the API.

**Calibration.** `semanticConfidence` (0–1): sort the semantic scores, descending; `best` = the
first (0 for an empty list); `level = clamp((best − floor) / (ceiling − floor))`. When the
calibration has `gapFloor` and `gapCeiling` and the list has more than one score: `gap = best −`
the mean of the next scores (at most 4), and the confidence is `max(level, clamp((gap − gapFloor)
/ (gapCeiling − gapFloor)))`; else `level`. The production model's calibration
(`DEFAULT_SEMANTIC_CALIBRATION`, EmbeddingGemma @768) is floor 0.39, ceiling 0.56, gapFloor 0.02,
gapCeiling 0.1. The Search API sends the calibration of its model with each search answer
(`calibration`); a client fuses and judges that answer with it, else with its default.

1. **Pinned.** Alias results with a score ≥ 0.9 come first, in alias order. Without one, number
   slang is pinned: when the alias output's `query` is ASCII digits only (`^[0-9]+( [0-9]+)*$`),
   its confidence is ≥ 0.6 and its top result's `match` is the whole query in field `name`,
   `shortcode`, `keyword` or `alias`, that result comes first (zh "666" → 👍, "88" → 👋: the
   embedding model reads the digits, 6️⃣ and 8️⃣).
2. **Candidates.** Every other result of the alias list (its order) and then of the semantic list,
   each id once. A result keeps the alias object when both lists hold it.
3. **Score.** `Σ wᵢ·xᵢ`, summed left to right, over these features of the candidate:

   | i | Feature | Weight |
   | -: | ------- | -----: |
   | 0 | 1 when the alias list holds it, else 0 | −0.3173 |
   | 1 | alias score `a` (0 without) | 1.715 |
   | 2 | 1 / alias rank (1-based; 0 without) | 1.57 |
   | 3 | `a` / alias confidence (0 without) | 0.4408 |
   | 4 | semantic score `s`; without one, the semantic list's lowest score − 0.02 (0 for an empty list) | 12.39 |
   | 5 | best semantic score (0 or more) − `s` | −8.606 |
   | 6 | popularity, 0–1 (§2) | 3.18 |
   | 7 | `a` × alias confidence | 2.129 |
   | 8 | `s` × semantic confidence (`semanticConfidence`, the calibration of `fuse`) | 1.067 |

   Sort by score, descending; equal scores keep candidate order.
4. **Flag guard.** A country flag that the alias list does not hold and whose semantic score is
   below the calibration ceiling moves after the other candidates (`demoteUnsupportedFlags`).
5. Pinned results, then the candidates, cut to `limit`.

The weights are learned for EmbeddingGemma @768 with the semantic score of §5, on the in-house suite
and the dev sets, never on the held-out set (`pnpm --filter @emojisense/eval rerank:train`).
Another model needs its own weights. `{ rerank: false }` selects the previous fusion:
confidence-weighted reciprocal rank fusion (`fuseResults`, 0.4 + confidence weights, an alias
floor of confidence − 0.1 when the alias confidence is ≥ 0.6, the same flag guard).

## 11. Prebuilt alias index (`alias-index.<locale>.bin`, "ESIDX1")

The phrase index that `createEngine` builds from one list of packs (§4), stored so a new process
loads it instead (`buildEngineIndex` / `readEngineIndex` in `emojisense/engine-index`). Search
results are identical: the file holds what the build computes, and the engine derives the rest
(phrase lengths and weights, IDF, token masks) with the same code.

- Layout, little-endian, every section padded to 4 bytes: a u32 header length, a JSON header,
  then `postingStart` (i32 × vocab + 1), `postings` (i32), the start of each phrase's text
  (u32 × phrases + 1), `phraseEmoji` (u16, or i32 above 65,535 emoji), `phraseLocaleMask` (u8 for
  up to 8 packs, else u32), `phraseField` (u8, index into the §2 field list), the phrase texts
  (UTF-8, back to back) and the sorted vocabulary (UTF-8, one token per line).
- The header names the format version, the field list, a normalization probe and, per pack in
  order: locale, part, pack version, rows, the number of characters in its text cells and its
  weights. A reader that finds any difference ignores the file and builds the index.
- The API Worker bundles the index of `[pack.en.json, pack.en.ext.json]` and publishes
  `alias-index.<locale>.bin` for every other pack locale next to the packs, built from
  `[pack.en.json, pack.<locale>.json, pack.<locale>.ext.json]` (`scripts/sync-pack.ts`).
