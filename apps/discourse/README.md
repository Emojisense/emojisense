# Emojisense for Discourse

A Discourse theme component: emoji by meaning in the composer (Markdown and rich text), in chat and
in the emoji picker. Type `:ship it` and 🚀 comes first. Type `:mind blown` and 🤯 comes first.

```
 composer ":" autocomplete ─┐
 chat ":" autocomplete ─────┼─▶ Emojisense ranking (packs in the theme's assets, in the browser)
 emoji picker search ───────┘      │  ranked emoji → Discourse names ("🚀" → rocket, "👍" + tone 4 → +1:t4)
                                   └─▶ then Discourse's own matches fill the list
 favorites (":"), skin tones (":wave:t3"), smileys (":)") stay Discourse's
```

- **Offline by default.** The packs (11 languages) ship as theme assets and load from the site
  when the composer opens or the chat input gets the focus, so the first `:` answers at once.
  No search text leaves the browser.
- **Site custom emoji** join the results by their names (`:party parrot` → `:party_parrot:`).
- **Search by meaning** (optional): with a publishable key, unsure searches also ask the
  Emojisense API.

## Install

Admin → Appearance → Themes and components → Install → From a git repository:
`https://github.com/emojisense/discourse-emojisense`. Add the component to the site's themes.
It works on self-hosted sites and on Discourse-hosted plans that allow theme components.

## Settings

| Setting | Default | Notes |
| ------- | ------- | ----- |
| `search_locale` | `auto` | `auto`: the interface language of each user (English when Emojisense has no data for it). A fixed value: that language. The languages of each user's browser and English are searched too. Only those packs load and match: a user of English and Turkish never gets a match from a Portuguese alias. |
| `culture` | on | Cultural and seasonal emoji after the best match |
| `api_enabled` | off | Ask the Emojisense API when the dictionary is unsure |
| `publishable_key` | — | `pk_live_…` with the site's address in its allowed origins. Theme settings are public: never a secret key. |
| `api_url` | `https://api.emojisense.com` | |

## How it hooks in

Discourse has no emoji search API for themes, so the component wraps three methods with
`api.modifyClass`: `component:d-editor` `_applyEmojiAutocomplete`, `component:chat-composer`
`applyAutocomplete` (options with `key: ":"` only) and `component:emoji-picker/content`
`debouncedDidInputFilter`. They are internal: a Discourse update can change them. When the packs
have not loaded, or something fails, Discourse's own search answers.

Tested on Discourse 2026.10.0 (rich text and Markdown composer, chat, emoji picker, QUnit at
`/theme-qunit`), with `scripts/e2e.mjs` against a local development site in Docker.

## Develop

```bash
pnpm --filter @emojisense/discourse build      # → dist/theme (needs `pnpm data:build`)
pnpm --filter @emojisense/discourse test       # the TypeScript logic (Vitest)
DISCOURSE_URL=http://127.0.0.1:3000 DISCOURSE_USERNAME=… DISCOURSE_PASSWORD=… \
  pnpm --filter @emojisense/discourse e2e      # a site with the component, headless Chromium
```

For a local site: run Discourse's development image (`discourse/discourse_dev:release`, arm64 and
amd64) with a Discourse checkout mounted at `/src`, then `bundle install`, `pnpm install`,
`bin/rake db:create db:migrate` and `bin/dev` in the container. Upload `dist/theme` as a `.tar.gz`
(Admin → Themes → Install → From your device, or `POST /admin/themes/import.json` with `bundle`)
and add the component to the default theme.

`src/` is plain TypeScript (trigger, emoji → Discourse names, custom emoji, the search), bundled
into `javascripts/discourse/lib/emojisense.js`. `theme/` holds the theme files, including the
initializer and a QUnit test that runs at `/theme-qunit` on a site with the component.

## License

MIT. The data packs: Emojibase (MIT), Unicode CLDR (Unicode License v3), Emoji-SP (CC BY 4.0); the
license texts are in `licenses/`.
