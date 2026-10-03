---
"@emojisense/mcp": minor
---

The tools search only the input's language and English. A call with `locale: "es"` never matches a Portuguese alias, and a call without `locale` searches English only (before, it searched all 11 bundled languages): pass `locale: "tr"` for a Turkish phrase such as "kolay gelsin". `matchText` and `suggestReactionsOffline` take `locales`, as `engine.search` does.
