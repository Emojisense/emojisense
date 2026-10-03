# @emojisense/react

## 0.1.0

### Minor Changes

- 1e8b6ea: First public release: `useEmojisense`, `useEmojiSearch` and `useRelevantNow` hooks, `EmojiGlyph`, and the Frimousse adapter (`@emojisense/react/frimousse`).
- 8d0bf3f: Hosted emoji set images now send the publishable key, which the API requires (a plan with hosted sets, Solo and up): `emojiImageUrl` takes a `key` option, the React pickers and `EmojiGlyph` pass `publishableKey`, and the web component passes its `key`. Set images use `referrerpolicy="strict-origin-when-cross-origin"` so the API can check the key's allowed origins.

### Patch Changes

- Updated dependencies [a1e4b7f]
- Updated dependencies [1e8b6ea]
- Updated dependencies [8d0bf3f]
- Updated dependencies [9b1a547]
  - emojisense@0.1.0
