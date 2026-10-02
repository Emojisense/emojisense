# Enrichment style guide

Every base emoji gets one `EnrichmentRecord` (see `src/types.ts`). It holds an English (`en`)
and a Turkish (`tr`) block. The aliases are the **primary search path** (Tier 0). They are
what makes "jurassic park" find 🦖 on a laptop with no network. Quality matters more than
quantity.

## Record shape

```json
{
  "hexcode": "1F996",
  "emoji": "🦖",
  "en": {
    "desc": "one line: how people actually use it, literal and figurative",
    "synonym": [], "slang": [], "pop_culture": [], "dev": [], "typo": [], "intent": [],
    "low": []
  },
  "tr": { "desc": "...", "synonym": [], "slang": [], "pop_culture": [], "dev": [], "typo": [], "intent": [], "low": [] }
}
```

All seven arrays must exist. Use `[]` when a category does not apply.

## Size

| Block | Unique aliases | Note |
| ----- | -------------- | ---- |
| `en`  | 30–100         | 35–60 for most. 70–100 only for very popular emoji (😂 👍 🔥 🚀 ❤️ 🎉 🙏 💀 ✅ 👀). About 30 for near-duplicate variants such as gendered or rare symbols. |
| `tr`  | 12–60          | 15–35 for most. |
| flags | en 20–100, tr 8–60 | Small territories have little to say. Do not pad them with noise. |

## Categories

| Key | What goes in | Examples |
| --- | ------------ | -------- |
| `synonym` | Other names for the thing. Plurals people type. Close relatives. Joined spellings people type (`trex`, `thumbsup`). | 🦖 `dinosaur`, `dino`, `tyrannosaurus rex`, `trex` |
| `slang` | Internet / chat slang, abbreviations, informal meanings. | 💀 `im dead`, `ded`, `lmao`; 🐐 `goat`; 🧢 `cap`, `no cap` |
| `pop_culture` | Movies, TV, games, books, songs, memes, holidays, sports, landmarks, internet culture. **No names of real people.** Fictional characters are fine. | 🦖 `jurassic park`, `jurassic world`; 💍 `lord of the rings`; ⚡ `harry potter` |
| `dev` | Software / startup / workplace culture, only where it is natural. Empty for most emoji. | ✅ `lgtm`, `approved`, `tests pass`; 🚀 `ship it`, `deploy`; 🐛 `bug`; 🔥 `hotfix`, `on fire` |
| `typo` | Real misspellings and phonetic spellings people type. Not case, accent or hyphen variants (the search normalizer already handles those). | 🎃 `hallowen`, `haloween`, `hallowelen`; 🦖 `dinasour`, `tyranosaurus` |
| `intent` | Short phrases (2–5 words) a person types when they *want to say something* and this emoji says it. Feelings, reactions, situations, idioms. | 😴 `so tired`, `im exhausted`, `need a nap`; 🍀 `break a leg`, `good luck`; 🎉 `congrats on the launch` |
| `low` | Subset of the aliases above that you are **not sure about**: tangential, ambiguous, regional, or likely to collide with many other emoji. Every item must also appear in a category. | |

## Rules

1. Lowercase everything. For Turkish, use Turkish lowercase (`İ` → `i`, `I` → `ı`).
2. No emoji characters in aliases. No leading or trailing punctuation. Max 48 characters, normally 1–4 words.
3. Do not repeat the CLDR `label` or `tags` that are given in the input. They are indexed already. Use the slots for new ways people search.
4. Think "what would a person type into an emoji search box to find this?" Include the reaction meaning (👀 `watching`, `tea`, `drama`), not only the literal object.
5. Prefer aliases that point at this emoji specifically. A generic word that fits 30 emoji (`happy`, `nice`, `object`) adds noise. Put such a word in `low`, or omit it.
6. Keep it PG-13. No slurs, no hate symbols, no explicit sexual terms. Mild widely known innuendo (🍑 `peach butt`, 🍆 `innuendo`) is allowed and goes in `low`.
7. No real person names (athletes, celebrities, politicians). Franchises, fictional characters, events, and places are fine.
8. Variants (skin tone) are not separate records. Gendered variants (👨‍💻 / 👩‍💻 / 🧑‍💻) are separate records. Give them the shared role aliases plus gender words (`woman developer`, `female engineer`).
9. `desc`: one line, at most 160 characters. Say how people use it in chat, not what the picture shows. English: `Celebrating a release, a launch, or fast progress; "ship it".` Turkish: write natural Turkish, not a translation of the English line.

## Turkish (`tr`)

- Use correct Turkish spelling with diacritics (ç ğ ı ö ş ü). Do **not** add ASCII-folded copies (`dogum gunu`): the normalizer folds diacritics. Do add real misspellings in `typo`.
- Cover everyday Turkish chat: `kolay gelsin`, `geçmiş olsun`, `iyi ki doğdun`, `maşallah`, `nazar değmesin`, `eline sağlık`, `afiyet olsun`, `hayırlı olsun`, `başın sağ olsun`, `aynen`, `harbiden`, `efsane`, `gülmekten öldüm`.
- `pop_culture` in Turkish context: Turkish holidays (bayram, kandil, 23 nisan, 29 ekim), football club colours and nicknames, Turkish TV and film characters, Turkish food and tea culture. Global franchises only when Turks use the Turkish title (`yüzüklerin efendisi`).
- `dev` in Turkish is usually English jargon. Leave it empty unless there is a real Turkish term (`canlıya al`, `hata ayıklama`).

## Flags

- Country name variants and short forms, demonym and language, capital and 1–3 iconic landmarks or foods, national team nickname, `go <country>`, the ISO code as typed (`tr`, `turkiye`).
- Turkish block: Turkish country name (`Almanya`), demonym (`Alman`), language, capital in Turkish spelling.
- Non-country flags (🏁 🏳️‍🌈 🏴‍☠️ 🇪🇺 🇺🇳): treat like normal symbols.

## Worked example (shortened)

```json
{
  "hexcode": "2705",
  "emoji": "✅",
  "en": {
    "desc": "Done, approved, or verified; ticking off tasks and signalling that something passed.",
    "synonym": ["check", "checkmark", "tick", "done", "complete", "completed", "approved", "verified", "confirmed", "correct", "success", "passed", "finished", "accepted", "valid", "green check"],
    "slang": ["yep", "yup", "bet", "say less", "w"],
    "pop_culture": ["checklist", "to do list", "inbox zero"],
    "dev": ["lgtm", "looks good to me", "approved pr", "tests pass", "ci green", "build passing", "merged", "shipped", "ready to merge", "resolved", "acked", "ack"],
    "typo": ["chek", "cheked", "checkmrk", "aproved", "complet", "verifed"],
    "intent": ["all done", "task complete", "mission accomplished", "good to go", "sounds good", "works for me", "that is correct", "got it"],
    "low": ["w", "bet", "inbox zero", "resolved"]
  },
  "tr": {
    "desc": "Tamamlandı, onaylandı veya doğru; yapılacaklar listesinde işi kapatmak için.",
    "synonym": ["tamam", "tamamlandı", "onaylandı", "onay", "doğru", "bitti", "yapıldı", "kabul", "geçerli", "başarılı", "tik", "yeşil tik"],
    "slang": ["oldu bu iş", "tamamdır", "aynen"],
    "pop_culture": ["yapılacaklar listesi"],
    "dev": ["onaylandı pr", "testler geçti", "birleştirildi"],
    "typo": ["tamamdir", "onaylandi", "tamamlndı"],
    "intent": ["iş bitti", "hallettim", "her şey hazır", "anlaşıldı", "uygundur"],
    "low": ["aynen"]
  }
}
```
