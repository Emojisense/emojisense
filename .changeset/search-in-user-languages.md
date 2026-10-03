---
"emojisense": minor
---

Search in the user's languages only. `engine.search`, `createSearchSession` and `createSuggestionSource` take `locales`: only phrases of those loaded packs match (English, the preferred `locale` and custom packs always do), so a user of English and Turkish never gets a match from a Portuguese alias. `createEngineLoader` takes `locales` to load several languages at once, and a language without a pack is left out. New helpers: `userLocales()` (the browser's languages that have a pack, always with English), `packLocaleOf(tag)` and `PACK_LOCALES`.
