---
"emojisense": minor
"@emojisense/tiptap": patch
"@emojisense/lexical": patch
---

New entry `emojisense/autocomplete`: the editor-independent `:` autocomplete logic (`findTrigger`, `createSuggestionSource` with `resolve`, `findShortcode`, `allowContext`). The Tiptap and Lexical adapters now use it instead of their own copies; their behaviour does not change.
