---
"emojisense": minor
"@emojisense/react": minor
"@emojisense/web-component": minor
---

Hosted emoji set images now send the publishable key, which the API requires (a plan with hosted sets, Solo and up): `emojiImageUrl` takes a `key` option, the React pickers and `EmojiGlyph` pass `publishableKey`, and the web component passes its `key`. Set images use `referrerpolicy="strict-origin-when-cross-origin"` so the API can check the key's allowed origins.
