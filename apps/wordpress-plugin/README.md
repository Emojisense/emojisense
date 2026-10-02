# Emojisense for WordPress

A WordPress plugin: emoji by meaning in the block editor, the classic editor, post reactions and
the comment form. `readme.txt` is the WordPress.org page; this file is for developers.

```
 block editor                 classic editor           front end (optional)
 ─────────────                ──────────────           ────────────────────
 ":" completer (useItems)     TinyMCE button           reaction bar  ── REST emojisense/v1/reactions/:id
 toolbar "Emoji" → picker      → <emojisense-picker>    comment "Emoji" button → <emojisense-picker>
 sidebar "Reactions" panel
          │                          │                          │
          └──── packs/0.1.0/pack.<locale>[.ext].json from the plugin folder (no network) ───┘
                optional: Emojisense API (meaning search, suggestions, hosted sets), off by default
```

## Build and package

```bash
pnpm install && pnpm data:build                      # once, at the repository root
pnpm --filter @emojisense/wordpress-plugin build     # wp-scripts → build/, data → packs/, licenses/
pnpm --filter @emojisense/wordpress-plugin release   # → release/emojisense/ and release/emojisense-<version>.zip
```

| Path | Role |
| ---- | ---- |
| `emojisense.php`, `includes/` | PHP: settings, assets, editor hooks, reactions REST API, hosted sets, privacy text |
| `uninstall.php` | Deletes the option and the post meta of every site |
| `src/editor/` | Block editor: completer, format (toolbar button), reactions panel (JSX, `@wordpress/*` externals) |
| `src/classic/` | TinyMCE plugin (loaded by TinyMCE through `mce_external_plugins`) |
| `src/front/` | Reaction bar (≈ 3 KB) and comment picker |
| `src/lib/`, `src/shared/` | Framework-free TypeScript: engine loading, completer search, reactions client, popover |
| `languages/emojisense.pot` | Strings of the PHP and the built scripts |
| `assets/wporg/` | Sources of the WordPress.org icon and banner (not in the zip) |
| `scripts/` | `copy-data`, `release`, `e2e`, `wporg-assets` |

The zip holds `emojisense.php`, `uninstall.php`, `readme.txt`, `includes/`, `build/`, `packs/`,
`languages/` and `licenses/` (≈ 4 MB zipped, 14 MB unpacked: the 11 locale packs).

## Design decisions

| Topic | Decision |
| ----- | -------- |
| Search data | The packs ship in the plugin and load from the site, so search needs no API, no key and no network. The core pack loads first; the extension pack (more aliases) when the browser is idle. |
| Completer | `useItems` instead of `options`: the default filter of `@wordpress/components` keeps only options whose keywords contain the typed text, which drops meaning results (`:ship it` → 🚀). `:` opens it only at the start of text or after a space or an opening bracket, not in `12:30` or `https://`; one-character queries (`:)`, `:D`) stay emoticons. |
| API | One switch, off by default. Meaning search, suggestions and hosted sets are separate options under it. The browser gets the API address and key only with meaning search on. |
| Keys | Publishable keys only (`pk_live_`/`pk_test_`); secret keys are refused with advice. Server calls send the site origin, so the key's allowed origins work for both. |
| Reactions | Counts per emoji in post meta (read, change, write: two reactions at the same instant may count once). Nonce from the GET answer, so cached pages keep working. Rate limit: 10 a minute per client (`emojisense_reaction_rate_limit`), keyed by an HMAC of the IP address that lives for one window. The browser remembers its own reactions in `localStorage`. The buttons carry code points (`data-emoji-hex`) because content filters rewrite emoji in attributes. |
| Suggestions | After publishing, in WP-Cron, never during the publish request. Skipped when the author chose reactions. |
| Hosted sets | `wp_staticize_emoji()` with the API as `emoji_url`, on content, excerpts and comments. A missing image falls back to the emoji text. |

## Test

```bash
pnpm --filter @emojisense/wordpress-plugin test         # Vitest + happy-dom (src/lib, src/shared)
pnpm --filter @emojisense/wordpress-plugin typecheck
composer install && vendor/bin/phpcs                    # WordPress Coding Standards + PHP 7.4 compatibility

npx @wordpress/env start                                # Docker; ports 8850-8853
npx @wordpress/env run tests-cli --env-cwd=wp-content/plugins/wordpress-plugin vendor/bin/phpunit
npx @wordpress/env run cli --env-cwd=wp-content/plugins/wordpress-plugin \
  wp i18n make-pot . languages/emojisense.pot --slug=emojisense --domain=emojisense \
  --exclude=node_modules,vendor,src,test,release,packs,scripts,licenses

pnpm --filter @emojisense/wordpress-plugin release
PLAYGROUND_NPX=/path/to/node-24.18+/npx pnpm --filter @emojisense/wordpress-plugin e2e   # Playground, headless Chromium
E2E_PHP=7.4 E2E_SMOKE=1 pnpm --filter @emojisense/wordpress-plugin e2e
node scripts/wporg-assets.mjs                           # icons, banners, screenshots → release/wordpress-org/
```

| Test | Covers |
| ---- | ------ |
| `test/js/completer.test.ts` | `:` contexts, short queries, `:pizza` → 🍕, phrases, locale names, culture after the top result, API fusion only when unsure |
| `test/js/engine.test.ts` | Packs load from the site (core, then extension), once, retry after failure, no culture file; API client gets key and pack version; picker attributes stay offline without the API |
| `test/js/reactions.test.ts` | Reaction lists, code points, number formats, local memory, the bar: counts, toggles, expired nonce, rate limit, API down |
| `test/js/popover.test.ts` | Picker dialog: offline attributes, select, Escape and outside click, dark pages, caret insert |
| `test/php/test-settings.php` | Defaults send nothing; sanitization of keys, address, choices, emoji lists; idempotence; locale mapping |
| `test/php/test-reactions.php` | REST read and write, nonce, hidden posts, rate limit with `Retry-After`, no personal data stored, suggestions (permissions, key, Origin, errors, WP-Cron), markup, meta in the REST API |
| `test/php/test-plugin.php` | Code points, hosted set rendering, TinyMCE button, privacy text, uninstall |
| `scripts/e2e.mjs` | The release zip in WordPress Playground: `:pizza` → 🍕, `:ship it` → 🚀, toolbar picker, sidebar panel, settings save and secret key refusal, reactions on the front end, comment picker, TinyMCE button |

## Publish to WordPress.org (owner)

1. Ask for the slug `emojisense` at https://wordpress.org/plugins/developers/add/ with the zip.
2. Put your WordPress.org user name in `Contributors:` of `readme.txt`.
3. After approval, commit the contents of `release/emojisense/` to SVN `trunk/`, tag `tags/0.1.0`,
   and put `release/wordpress-org/*` (icons, banners, screenshots) in SVN `assets/`.
