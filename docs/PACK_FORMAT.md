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
  pack.tr.json / pack.tr.ext.json     Turkish core / extension (load when the UI locale is tr)
  vectors.<model>.<dims>.bin          Tier 1 emoji vectors, one file per model × dims
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
    "vectors.embeddinggemma.256.bin": {
      "sha256": "…", "bytes": 0, "gzipBytes": 0,
      "model": "@cf/google/embeddinggemma-300m", "dims": 256,
      "queryTemplate": "task: search result | query: {q}"
    }
  }
}
```

- Clients SHOULD verify `sha256` (lowercase hex of the raw file bytes) before they cache a file.
- `coreAliases` is informational: how many aliases per emoji each locale's core part keeps (§2).
- `queryTemplate` is the exact string to embed for a query. `{q}` is replaced by the
  normalized query (§3). Only needed by clients that embed queries themselves.

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
matching still completes them while the user types.

Examples: `"İYİ Kİ DOĞDUN"` → `"iyi ki dogdun"`, `"¡Feliz cumpleaños!"` → `"feliz cumpleanos"`,
`"Ёлка"` → `"елка"`, `"مَرْحَبًا"` → `"مرحبا"`, `"नमस्ते"` → `"नमस्ते"` (unchanged), `"i'm exhausted"` → `"im exhausted"`,
`":rocket:"` → `"rocket"`, `"+1"` → `"+1"`, `"🚀 launch 👍🏽"` → `"launch"`.

Tokens are the result split on single spaces.

## 4. Tier 0 search (reference algorithm)

The reference implementation is `packages/core/src/engine.ts`. A port SHOULD match it, so that
the shared eval set gives the same numbers on every platform.

**Index.** For every row of every loaded pack, collect phrases per field. Build a sorted
vocabulary of all tokens, postings token → phrases, and for each token
`idf = ln(1 + E / df)`, where `E` is the emoji count and `df` is the number of distinct emoji
that have the token in any phrase.

**Query.** Normalize and tokenize the query, keeping at most 8 tokens. For each query token, find
candidate vocabulary tokens with a match quality:

| Match | Quality |
| ----- | ------: |
| exact | 1.0 |
| prefix (only the last token, only while typing, i.e. the raw query does not end with whitespace) | 0.6 + 0.35 × len(query token) / len(vocab token) |
| final repeated letter removed (`upp` → `up`), only if there is no exact match | 0.85 |
| optimal-string-alignment distance 1 (token length 4–7) or ≤ 2 (length ≥ 8), only if there is no exact match | 0.8 (d = 1), 0.65 (d = 2) |

The weight of query token *i* is the idf of its best candidate, or the largest idf in the index
when there is no candidate. For the stopwords listed in `engine.ts`, the weight is capped at 0.3.

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
the cap. Sort by score (descending), then by row order. `confidence` = the top score.

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
| 32 | modelLength | model id, UTF-8 (e.g. `@cf/google/embeddinggemma-300m`) |
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

## 6. Shards (layer 2: precomputed results)

Frequent queries that the on-device dictionary cannot answer get their semantic results
precomputed nightly and published as static files:

```
/p/<packVersion>/index.json      {"format":"emojisense-shards","formatVersion":1,"packVersion":"0.1.0",
                                  "model":"embeddinggemma@256","keys":["a","ab","b", … ,"th","the ", …]}
/p/<packVersion>/<key>.json      {"key":"co","entries":{"congrats on the launch":[["🚀","1F680",0.81], …]}}
```

- `keys` are sorted. A query uses the **longest key that is a prefix of the normalized query**.
  Hot prefixes get longer keys (adaptive split), so each shard stays ≤ ~30 KB gz. File names
  are `encodeURIComponent(key)`.
- `entries` maps a normalized query (§3) to semantic results `[emoji, hexcode, score]`, best
  first. These are the same results the API returns with `mode=semantic` for that model.
- A client downloads `index.json` once and each shard at most once per session, then answers
  locally. A query that is not in its shard goes to the API.
- Shards are valid only for the `model` they name. A new model or pack version publishes a new
  directory.

## 7. Versioning

- `formatVersion` changes only for breaking layout changes. Adding optional manifest keys or
  pack-level keys is not breaking. Adding a row position is breaking.
- `packVersion` is semver for the data. A patch has alias changes only. A minor adds emoji or
  locales. A major changes ids.

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
