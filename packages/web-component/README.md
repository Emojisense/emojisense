# @emojisense/web-component

`<emojisense-picker>`: an emoji picker with Emojisense search as a custom element. It works
without a framework and inside Vue, Svelte and Angular. React apps get a better fit from
`@emojisense/react`.

- With an empty query it shows every emoji by category.
- While the user types it shows the ranked results. The on-device dictionary answers every
  keystroke. When it is unsure, precomputed shards and then the API are asked, and their results
  are fused in.
- ARIA combobox + listbox, keyboard navigation, skin tones, light and dark themes, reduced motion.

## Install

```bash
npm install @emojisense/web-component
```

```ts
import "@emojisense/web-component"; // registers <emojisense-picker>
```

Without a bundler, load the self-contained build (`dist/emojisense-picker.js`, about 23 KB gz with
the search engine) from your own server or from a CDN that mirrors npm:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@emojisense/web-component@0.1.0/dist/emojisense-picker.js"></script>
```

Pin an exact version from a CDN, and add an `integrity` hash (Subresource Integrity) in production.

## Use

```html
<emojisense-picker
  pack-url="https://api.emojisense.com/v1/pack/0.1.0"
  shards-url="https://cdn.emojisense.com/p/0.1.0"
  endpoint="https://api.emojisense.com"
  key="pk_live_…"
  locale="en"
  columns="9"
  skin-tone="none"
  emoji-set="native"
></emojisense-picker>

<script type="module">
  document.querySelector("emojisense-picker").addEventListener("emoji-select", (event) => {
    const { emoji, label, id } = event.detail; // "👍🏽", "thumbs up", "1F44D"
  });
</script>
```

| Attribute | Property | Default | Meaning |
| --------- | -------- | ------- | ------- |
| `pack-url` | `packUrl` | — | Pack version directory. The core pack renders first. The extension pack downloads when the browser is idle, and its index is built in a pause in typing. |
| `shards-url` | `shardsUrl` | — | Precomputed results (layer 2). Free static files, asked before the API. |
| `endpoint` | `endpoint` | — | Semantic API (layer 3). Omit `shards-url` and `endpoint` for fully offline search. |
| `stats-url` | `statsUrl` | — | Report how searches end and which results are picked (`POST /v1/events`), e.g. `https://stats.emojisense.com`. Off when omitted. |
| `stats-sample` | — | `0.1` | Share of sessions that report. |
| `key`, `publishable-key` | `publishableKey` | — | Publishable key for the API. Use `publishable-key` in Vue and React, which reserve `key`. |
| `locale` | `locale` | `en` | `tr` loads the Turkish pack next to English. |
| `locales` | `locales` | — | All the user's languages, e.g. `locales="tr en"`. See "The user's languages" below. |
| `columns` | `columns` | `9` | Emoji per row (1–24). |
| `skin-tone` | `skinTone` | `none` | `none`, `light`, `medium-light`, `medium`, `medium-dark`, `dark` |
| `emoji-set` | `emojiSet` | `native` | `native` draws the system font. `twemoji`, `noto` and `fluent` draw `<img src="{endpoint}/v1/sets/{set}/{hexcode}.svg?key={key}" alt="{emoji}" loading="lazy">` and need `endpoint` and a `key` whose plan includes hosted sets (Solo and up). A set may not draw every emoji (Fluent has no country flags); then the native emoji takes its place. Credit the set in your app (see NOTICE). |
| `placeholder` | `placeholder` | `Search emoji…` | Input placeholder and accessible name |
| `culture-url` | `cultureUrl` | next to `pack-url` | Culture files, e.g. `https://api.emojisense.com/v1/culture/0.1.0`. Editorial emoji for the moment and culture join the results after the top result (never above it). Default: the culture directory next to `pack-url` (`…/v1/pack/0.1.0` → `…/v1/culture/0.1.0`). `culture-url="off"` keeps the canonical ranking. A file that cannot load changes nothing. |
| `region` | `region` | browser | ISO 3166-1 code such as `BR`. Regional culture entries apply only with a matching region. Without the attribute, the picker uses the device's region: the region of the browser's language (`navigator.language` `pt-BR` → `BR`), else the region of its time zone (`ja` in `Asia/Tokyo` → `JP`, from the culture file). It is read on the device and never sent. `region=""` turns regional entries off. `region="auto"`: the API reports the region of the request's country (needs `endpoint`); searches use it after the first API answer, and the relevant-now row shows entries for every region only. |
| `show-relevant-now` | `showRelevantNow` | off | Boolean. Adds a "Relevant now" row (seasonal and event emoji) above the browse view. Needs culture (on by default). |
| — | `culture` | — | A culture file to use instead of fetching `culture-url` |
| — | `now` | `Date.now` | The clock that culture windows and the relevant-now row are checked against |
| — | `packs` | — | Pack objects to use instead of fetching `pack-url` (bundled or offline apps) |
| — | `query` | `""` | Read or set the search text |
| — | `status`, `engine` | — | `idle`, `loading`, `ready` or `error`; the alias engine once ready |

**The user's languages:** by default a picker loads and searches `locale` and English. To follow
the user, set all their languages. `userLocales()` reads `navigator.languages` and keeps the
languages that have a pack, most preferred first, always with English: `["tr-TR", "en-US", "de"]`
→ `["tr", "en"]`.

```js
import { userLocales } from "@emojisense/web-component";

const locales = userLocales();
picker.locale = locales[0];
picker.locales = locales; // or the attribute: locales="tr en"
```

Only the packs of these languages load, and search matches only their phrases. A user of English
and Turkish never gets a match from a Portuguese alias. English always counts: it carries the
shortcodes.

**When the packs load:** a picker starts loading when it is added to the page. Add it when your
popover opens to load on open. Pickers with the same `pack-url` and languages (`locale`,
`locales`) share one download and one index, so a picker that opens again is ready at once. To
start a little earlier, preload when the pointer moves onto or focus enters your emoji button
(pass the picker's `locale` and `locales` too):

```js
import { preloadEmojisense } from "@emojisense/web-component";

const warm = () => preloadEmojisense({ packUrl: "https://api.emojisense.com/v1/pack/0.1.0" });
button.addEventListener("pointerenter", warm, { once: true });
button.addEventListener("focus", warm, { once: true });
```

A query typed while the packs load shows "Loading…" and runs as soon as they arrive.

**Event** `emoji-select` (bubbles, composed): `detail = { emoji, label, id }`. `emoji` has the skin
tone applied. `id` is the Emojibase hexcode of the base emoji.

**Keyboard** (focus stays in the input): arrow keys move through the grid by visual rows, Enter
selects, the first Escape clears the query, and the next Escape reaches your page (for example to
close a popover).

## Theme

The default theme is the compact "emoji keyboard" look: keycap tiles, an emoji-yellow selection,
ink outlines and a pill for the query state. It follows `prefers-color-scheme`, or the host's
`color-scheme`. Animations run only with `prefers-reduced-motion: no-preference`.

```css
emojisense-picker {
  --emojisense-accent: #ffd23f; /* selected tile */
  --emojisense-ink: #1e1631; /* text and outlines */
  --emojisense-background: #ffffff;
  --emojisense-surface: #f4f6ff; /* search input */
  --emojisense-muted: #6b6380; /* group labels, messages */
  --emojisense-found: #12c79c; /* pill: results */
  --emojisense-none: #ff5b3a; /* pill: nothing found */
  --emojisense-focus: #3d7bff;
  --emojisense-depth-color: #1e1631; /* keycap depth */
  --emojisense-outline-width: 0.125rem;
  --emojisense-radius: 1.25rem;
  --emojisense-key-radius: 0.75rem;
  --emojisense-cell-size: 2.5rem;
  --emojisense-gap: 0.25rem;
  --emojisense-emoji-size: 1.375rem;
  --emojisense-height: 20rem;
  --emojisense-font-family: "Figtree", system-ui, sans-serif;
}

/* A flat look: no outlines, no depth. */
emojisense-picker::part(root) { border: 0; box-shadow: none; }
emojisense-picker::part(option) { border-color: transparent; box-shadow: none; }
emojisense-picker::part(active) { background: #e8eefc; }
```

Parts: `root`, `search`, `pill`, `viewport`, `listbox`, `group`, `relevant-now` (the "Relevant
now" group), `group-label`, `option`, `image` (the emoji image of a hosted set), `active` (the
active option), `message`, `sticker`. A culture result or a "relevant now" emoji names its reason
in `title` and `aria-description`.

## Frameworks

### Vue 3

<!-- readme-check: skip -->
```ts
// vite.config.ts
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("emojisense-") } } });
```

```vue
<script setup lang="ts">
import "@emojisense/web-component";
import type { EmojiSelectEvent } from "@emojisense/web-component";

const onSelect = (event: EmojiSelectEvent) => insert(event.detail.emoji);
</script>

<template>
  <emojisense-picker :pack-url="packUrl" publishable-key="pk_live_…" @emoji-select="onSelect" />
</template>
```

### Svelte

```svelte
<script lang="ts">
  import "@emojisense/web-component";
  let skinTone = $state("none");
</script>

<emojisense-picker
  pack-url={packUrl}
  skin-tone={skinTone}
  onemoji-select={(event) => insert(event.detail.emoji)}
></emojisense-picker>
```

Svelte 4 uses `on:emoji-select={…}` instead of `onemoji-select`.

### Angular

```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA } from "@angular/core";
import "@emojisense/web-component";
import type { EmojiSelectEvent } from "@emojisense/web-component";

@Component({
  selector: "app-reactions",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<emojisense-picker [attr.pack-url]="packUrl" (emoji-select)="onSelect($event)"></emojisense-picker>`,
})
export class ReactionsComponent {
  packUrl = "https://api.emojisense.com/v1/pack/0.1.0";
  onSelect(event: Event) {
    insert((event as EmojiSelectEvent).detail.emoji);
  }
}
```

### Another tag name

```ts
import { defineEmojisensePicker } from "@emojisense/web-component";
defineEmojisensePicker("my-emoji-picker");
```

`@emojisense/web-component/element` exports the class without registering anything.

## `:` autocomplete for a textarea

`@emojisense/web-component/textarea` adds a `:` menu to a plain `<textarea>` or text `<input>`
(comment forms, chat boxes). Type `:ship it` and 🚀 comes first. It does not register the picker
element.

```ts
import { createEngine, loadPacks } from "emojisense";
import { createSuggestionSource } from "emojisense/autocomplete";
import { attachEmojiAutocomplete } from "@emojisense/web-component/textarea";
import "@emojisense/web-component/textarea.css"; // optional default look

const engine = createEngine(await loadPacks({ baseUrl: "https://api.emojisense.com/v1/pack/0.1.0" }));
const source = createSuggestionSource({ engine, minQueryLength: 2, includeCustom: false });

const autocomplete = attachEmojiAutocomplete(document.querySelector("textarea")!, { source });
// Later: autocomplete.destroy();
```

| Key | Action |
| --- | ------ |
| ↑ ↓ | Move through the menu (it wraps) |
| Enter, Tab | Replace `:query` with the emoji |
| Escape | Close the menu and keep the text. It stays closed for that `:query`. |

The menu opens only when the colon starts a word, so `12:30` and `https://` stay text. Options:
`skinTone`, `maxWords` (default 4), `ariaLabel`, `className`, `container` (default: the body) and
`onInsert`. `source` and `skinTone` can be getters, for packs that load later; call `refresh()` when
they arrive.

## Limits

- The browse view shows every emoji in the pack. It does not hide emoji that the operating system
  cannot draw yet (Emoji 16 and 17 on older systems).
- UI strings are English. `placeholder` sets the input text and its accessible name.

## License

MIT. Docs: [emojisense.com/docs](https://emojisense.com/docs/).
