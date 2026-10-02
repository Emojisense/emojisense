# Emojisense for Chrome

An emoji picker for any text field. Put the caret in a field, press **Ctrl+Shift+Space**
(**⌘⇧Space** on macOS), type what you mean ("ship it", "jurassic park", "kolay gelsin"), press
Enter. Search runs on the device with the English and Turkish packs inside the extension.

```
 shortcut / toolbar click                 service worker                       page
 ───────────────────────▶  activeTab ──▶  inject content.js (all frames) ──▶  probe: where is the caret?
                                          toggle in that frame           ──▶  picker (shadow DOM, top layer)
                                                                                 │ port: query / picked
                           alias index (en + tr packs, built once)  ◀───────────┘
                           optional: semantic API (off by default)
                                                                                 ▼
                                                                         insert at the caret, or copy
```

## Load it

```bash
pnpm install
pnpm --filter emojisense build && pnpm data:build     # core + data packs (packages/data/dist)
pnpm --filter @emojisense/chrome-extension build      # → apps/chrome-extension/dist
```

1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** → choose `apps/chrome-extension/dist`.
3. The settings page opens once. Rebind the shortcut at `chrome://extensions/shortcuts`.

`pnpm --filter @emojisense/chrome-extension dev` rebuilds the scripts on change; reload the
extension on `chrome://extensions` afterwards. Static files (HTML, CSS, manifest) need a new build.

## Use it

| Key | Action |
| --- | ------ |
| Shortcut | Open the picker next to the caret; press again to close |
| Arrow keys | Move through the results |
| Enter | Insert the emoji (or copy it, where inserting is impossible) |
| Shift+Enter | Copy instead of insert |
| Escape, Tab | Close; focus and caret go back to the field |

An empty search box shows recently used emoji. The toolbar button does the same as the shortcut.

## Look and feel

The picker, the toast and the settings page use the website's design tokens
(`src/shared/tokens.css`, copied from `apps/web/src/styles/global.css`): a calm, near-monochrome
UI where the emoji are the only strong color.

| Topic | How |
| ----- | --- |
| Light and dark | The picker and the toast take the scheme of the page around the field (`src/content/theme.ts`): the first mostly opaque background above the field, else the page's `color-scheme`, else the system setting |
| Fonts | Hanken Grotesk, Bricolage Grotesque and DM Mono, copied at build time from pinned `@fontsource` packages into `dist/fonts`; nothing is downloaded |
| Fonts in the picker | The service worker sends the font bytes; the picker registers them with the FontFace API under its own family names (`Emojisense Hanken Grotesk`). No `web_accessible_resources`, so sites cannot detect the extension; page CSP `font-src` does not apply; page text never changes font. The first open waits at most 150 ms, then the system font shows |
| Keyboard and screen readers | ARIA combobox + listbox; `aria-expanded` only while options show; the search box describes its keys (`aria-describedby`); a polite live region announces the result count; the active tile has a ring with 3:1 contrast |
| Motion | Short entry and selection motion; none with `prefers-reduced-motion: reduce` |
| Focus | The picker takes focus only when you open it, and gives it back to the field on insert, Escape and Tab. The toast never takes focus |

## Where it inserts

| Target | How |
| ------ | --- |
| `<input>` (text, search, url, tel, email), `<textarea>` | `beforeinput` → native `insertText` (undo works) → `setRangeText` + `input` event |
| `contenteditable` (mail composers, comment boxes, ProseMirror, Lexical, Slate…) | `beforeinput` with target ranges (model-first editors insert it) → native `insertText` → Range edit + `input` event |
| Fields inside open shadow roots and same-origin frames | Same as above, in the frame that has the caret |
| Google Docs, Slides, canvas apps, password fields, pages with no focused field | Copy + a sticker card: "Copied — press ⌘V to paste". See [GOOGLE_DOCS_SPIKE.md](GOOGLE_DOCS_SPIKE.md) |
| `chrome://` pages, the Chrome Web Store | Chrome does not allow extensions; the toolbar icon shows "!" |

## Permissions and privacy

| Permission | Why |
| ---------- | --- |
| `activeTab` | Access to the current tab only after the shortcut or a toolbar click. No host permissions, no script on every page |
| `scripting` | Inject the picker into that tab |
| `storage` | Settings and recently used emoji, on this device only |
| `clipboardWrite` | Copy the emoji where inserting is impossible |

- No remote code; the extension pages use `script-src 'self'`.
- Search is offline by default. **Search by meaning** (options page) sends the normalized query
  text to the API address you enter, with a publishable key (`pk_…`). Secret keys are refused.
  Add the extension origin shown on the options page to the key's allowed origins. The address
  and key can be filled in and tested while the switch is off; nothing is sent until it is on.
- Page scripts cannot read the picker: it lives in a closed shadow root in the extension's
  isolated world, and its keystrokes do not reach page shortcut handlers.

## Develop and test

```bash
pnpm --filter @emojisense/chrome-extension test        # Vitest + happy-dom
pnpm --filter @emojisense/chrome-extension typecheck
npx biome check apps/chrome-extension
```

| Test file | Covers |
| --------- | ------ |
| `test/insert.test.ts` | Insertion strategies, caret restore, frameworks that cancel `beforeinput` |
| `test/overlay.test.ts` | ARIA combobox/listbox, keyboard, pointer, isolation from page handlers, loading and theme states |
| `test/controller.test.ts` | Open → search → insert → focus return; copy mode; Google Docs; reconnect; page theme; font wait |
| `test/theme.test.ts` | Light or dark from the page around the field |
| `test/fonts.test.ts` | Font messages, the worker's font source, FontFace registration in the page |
| `test/search.test.ts` | Service worker search: recents, skin tone, semantic API only when configured |
| `test/background.test.ts` | Frame choice, injection fallback, recents, message validation, manifest permissions |
| `test/content.test.ts` | Target capture, clipboard, Docs paste experiment, placement |
| `test/options.test.ts` | Options page validation, saving, labels, shortcut keycaps |

| Path | Role |
| ---- | ---- |
| `src/background/` | Service worker: commands, injection, search over a port, picker fonts |
| `src/content/` | Content script: target capture, insertion, picker, toast, page theme, fonts |
| `src/options/` | Options page (and its `@font-face` rules) |
| `src/shared/` | Settings, messages, strings (en, tr), frame choice, design tokens, font list |
| `scripts/build.ts` | esbuild bundles, manifest, packs, fonts, licenses, icons |

### Checked in a real browser

Headless Chrome for Testing, 2026-10-02, with the built `dist/` (the test copy had a host
permission instead of a shortcut press, because a script cannot press the shortcut):

| Path | Result |
| ---- | ------ |
| Textarea, "ship it" → 🚀 | Inserted at the caret, one trusted `input` event, focus and caret back in the field |
| contenteditable, "jurassic park" → 🦖 | Inserted at the saved caret |
| Password field | Not touched; copied; toast shown |
| Escape | Focus and caret back; no key reached the page's own handlers |
| Service worker search | First answer ≈ 180 ms (packs + index, once per worker life), then 0–3 ms per query |
| Restyled picker (same day, Chrome for Testing 151) | Fonts registered and loaded on a page with `font-src 'self'`; dark panel on a dark page with a light system; insert, focus return and copy-mode toast still work; search by meaning against the local API shows the "by meaning" tag |

## Known gaps

| Gap | Effect |
| --- | ------ |
| Cross-origin iframes (embedded comment widgets) | `activeTab` covers the tab's origin only; the picker opens in the top frame and copies |
| Closed shadow roots, canvas apps | Copy mode |
| Page key listeners on `window` (capture) registered before the picker | They still see keys typed in the picker; all later listeners do not |
| Google Docs direct insertion | Unverified without an account; off by default ([spike](GOOGLE_DOCS_SPIKE.md)) |
| Symbols in keycaps (⌘ ⇧ ↵ ←) | Not in the bundled font subsets; the system font draws them |
| Options page | English only (the picker is English and Turkish) |
| No on/off switch per site | Not needed so far: the extension runs on a site only after the shortcut or a toolbar click there (`activeTab`), and Chrome takes the shortcut before the page does |

Emoji data: Emojibase (MIT) and Unicode CLDR (Unicode License v3). Fonts: Hanken Grotesk,
Bricolage Grotesque and DM Mono (SIL Open Font License 1.1). The build copies the license texts
into `dist/licenses`.
