---
"@emojisense/tiptap": minor
---

New `locales` option: the `:` menu matches only phrases of the user's languages (`userLocales()` from `emojisense`). Pass the same list to `createEngineLoader` so only their packs load. Without it, nothing changes.
