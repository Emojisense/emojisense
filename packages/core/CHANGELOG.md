# emojisense

## 0.1.0

### Minor Changes

- a1e4b7f: New entry `emojisense/autocomplete`: the editor-independent `:` autocomplete logic (`findTrigger`, `createSuggestionSource` with `resolve`, `findShortcode`, `allowContext`). The Tiptap and Lexical adapters now use it instead of their own copies; their behaviour does not change.
- 1e8b6ea: First public release: the on-device alias engine, pack loader, search sessions, semantic layers (shards and API), fusion, culture layer, skin tones and hosted emoji sets.
- 8d0bf3f: Hosted emoji set images now send the publishable key, which the API requires (a plan with hosted sets, Solo and up): `emojiImageUrl` takes a `key` option, the React pickers and `EmojiGlyph` pass `publishableKey`, and the web component passes its `key`. Set images use `referrerpolicy="strict-origin-when-cross-origin"` so the API can check the key's allowed origins.
- 9b1a547: New entry `@emojisense/web-component/textarea`: `attachEmojiAutocomplete(field, { source })`, a `:` emoji autocomplete for plain textareas and text inputs, with an optional `textarea.css`. `SuggestionSource` in `emojisense/autocomplete` gains `settled()`: the final suggestions of the last search.
