# @emojisense/emoji-mart

Emojisense ranking for [emoji-mart](https://github.com/missive/emoji-mart) 5.

emoji-mart 5 has **no search hook**. Its `Picker` takes no search function, and its search is a
substring match over names and keywords. This package offers two integrations:

| | `attachEmojisense` (recommended) | `overrideSearchIndex` (experimental) |
| - | -------------------------------- | ------------------------------------ |
| How | Hide emoji-mart's search (`searchPosition: "none"`). Your input drives a ranked result list next to the picker. | Replace `SearchIndex.search`, which emoji-mart's own search box calls. |
| Layers | Device + shards + API (semantic results fused in) | Device only (the alias dictionary) |
| Look of the results | Your list (native emoji, or `<em-emoji>` for image sets) | emoji-mart's own grid |
| Relies on | Public API only | An internal detail of emoji-mart 5.6 |

Both return the `onEmojiSelect` payload of emoji-mart (`id`, `name`, `native`, `unified`,
`keywords`, `shortcodes`, `skin`, …).

## Setup

```ts
import data from "@emoji-mart/data";
import { Picker, Store } from "emoji-mart";
import { createEngine, createLayeredSemantic, loadPacks } from "emojisense";

const base = "https://api.emojisense.com";
const packs = await loadPacks({ baseUrl: `${base}/v1/pack/0.1.0` });
const engine = createEngine(packs);
const semantic = createLayeredSemantic({ shardsUrl: `${base}/p/0.1.0`, endpoint: base, key: "pk_live_…" });
```

## `attachEmojisense`

```ts
import { attachEmojisense } from "@emojisense/emoji-mart";

const onEmojiSelect = (emoji) => insert(emoji.native);
const picker = new Picker({ data, onEmojiSelect, searchPosition: "none" });
document.querySelector("#picker").append(picker);

attachEmojisense({
  picker,
  input: document.querySelector("#emoji-search"), // your <input>
  results: document.querySelector("#emoji-results"), // an empty element next to the picker
  data,
  engine,
  semantic,
  onEmojiSelect,
  skin: () => Store.get("skin") ?? 1, // the skin chosen in emoji-mart's picker
});
```

- An empty query shows emoji-mart's picker. A typed query hides it and shows the ranking.
- The input becomes an ARIA combobox and the results element an ARIA listbox. Arrow keys move,
  Enter selects, Escape clears the query.
- Style the list with `[data-emojisense-results]` (a CSS grid, `columns` per row),
  `[role="option"][data-active]` and `[data-emojisense-results][data-empty]` (no results).
- `renderEmoji: (emoji, selection) => node` changes what a result shows. Return
  `<em-emoji id="…" set="twitter">` to match an image set.
- `dispose()` removes the listeners and shows the picker again.

`createEmojiMartSearch({ data, engine, semantic, onResults })` is the same search without a UI,
for a list rendered by React, Vue or anything else. `onResults` receives emoji-mart emoji objects,
best first: alias results at once, fused results after the debounce.

## `overrideSearchIndex` (experimental)

```ts
import { SearchIndex } from "emoji-mart";
import { overrideSearchIndex } from "@emojisense/emoji-mart";

const restore = overrideSearchIndex(SearchIndex, { data, engine });
// emoji-mart's own search box now ranks with the Emojisense dictionary. restore() undoes it.
```

emoji-mart's picker calls `SearchIndex.search(value)` through the exported object on every input
(verified in 5.6.0), so replacing that method changes the results the picker shows. This is not a
documented API and can break in a future emoji-mart release. The picker renders one answer per
keystroke, so semantic results, which arrive later, cannot be fused in.

## Limits

- **Emoji coverage.** `@emoji-mart/data` 1.2.1 stops at Emoji 15.0. 1,870 of the 1,914 Emojisense
  emoji map to an emoji-mart id. Results for the other 44 (Emoji 15.1, 16 and 17) are dropped.
- **Hidden emoji stay hidden.** After emoji-mart's `init` has run, results are limited to the emoji
  its picker lists (supported by the OS, not in `exceptEmojis`). Before `init`, nothing is filtered.
- **Frequently used.** Selections from the Emojisense list do not update emoji-mart's
  "Frequently used" row. Call emoji-mart's `FrequentlyUsed.add(emoji)` in your `onEmojiSelect` if
  you want them there.
- **One picker per page for the override.** `SearchIndex` is a module-level singleton, so the
  override applies to every emoji-mart picker on the page.
- **Data must be passed.** Always give emoji-mart its `data`. Without it, emoji-mart fetches the
  data from a public CDN.
