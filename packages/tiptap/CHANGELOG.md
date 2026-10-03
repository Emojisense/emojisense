# @emojisense/tiptap

## 0.1.0

### Minor Changes

- 1e8b6ea: First public release: the `EmojiAutocomplete` extension, a `:` emoji autocomplete for Tiptap 3 ranked by Emojisense.

### Patch Changes

- a1e4b7f: New entry `emojisense/autocomplete`: the editor-independent `:` autocomplete logic (`findTrigger`, `createSuggestionSource` with `resolve`, `findShortcode`, `allowContext`). The Tiptap and Lexical adapters now use it instead of their own copies; their behaviour does not change.
- Updated dependencies [a1e4b7f]
- Updated dependencies [1e8b6ea]
- Updated dependencies [8d0bf3f]
- Updated dependencies [9b1a547]
  - emojisense@0.1.0
