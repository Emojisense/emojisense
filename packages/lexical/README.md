# @emojisense/lexical

`:` emoji autocomplete for [Lexical](https://lexical.dev) (React), ranked by Emojisense. Type
`:jurassic` and 🦖 comes first. Type `:fire:` and it becomes 🔥.

- Built on the official `LexicalTypeaheadMenuPlugin` and `useBasicTypeaheadTriggerMatch`.
- The alias engine answers each keystroke on device, in well under a frame. Optional semantic
  results arrive debounced and are fused into the open menu.
- An accessible default menu is included. You can replace it with your own `menuRenderFn`.

## Install

```bash
pnpm add @emojisense/lexical emojisense lexical @lexical/react react react-dom
```

## Setup

With `@emojisense/react`, which loads the packs and builds the engine:

```bash
pnpm add @emojisense/react
```

```tsx
import { EmojiAutocompletePlugin } from "@emojisense/lexical";
import "@emojisense/lexical/styles.css"; // optional default look
import { useEmojisense } from "@emojisense/react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";

function Editor() {
  const sense = useEmojisense({
    packBaseUrl: "https://api.emojisense.com/v1/pack/0.1.0",
    endpoint: "https://api.emojisense.com",
    publishableKey: "pk_live_REPLACE_WITH_YOUR_KEY",
  });
  return (
    <LexicalComposer initialConfig={{ namespace: "chat", onError: console.error }}>
      <RichTextPlugin contentEditable={<ContentEditable />} ErrorBoundary={LexicalErrorBoundary} />
      <EmojiAutocompletePlugin engine={sense.engine} semantic={sense.semantic} skinTone="medium" />
    </LexicalComposer>
  );
}
```

Replace the key with your publishable key for semantic API search. Omit `endpoint` and
`publishableKey` for search on the device only.

Without React hooks for the data: `engine={createEngine(await loadPacks({ baseUrl }))}` from
`emojisense`. While `engine` is `undefined` (packs still loading) the plugin stays inactive.

### The user's languages

`userLocales()` reads `navigator.languages` and keeps the languages that have a pack, most
preferred first, always with English: `["tr-TR", "en-US", "de"]` → `["tr", "en"]`. Give the list
to `useEmojisense` (only their packs load) and to the plugin (the menu matches only their
phrases):

```tsx
import { EmojiAutocompletePlugin } from "@emojisense/lexical";
import { useEmojisense } from "@emojisense/react";
import { userLocales } from "emojisense";

export function EmojiSearchPlugin() {
  const locales = userLocales();
  const sense = useEmojisense({
    packBaseUrl: "https://api.emojisense.com/v1/pack/0.1.0",
    locale: locales[0],
    locales,
  });

  return <EmojiAutocompletePlugin engine={sense.engine} locale={sense.locale} locales={sense.locales} />;
}
```

Render `EmojiSearchPlugin` inside `LexicalComposer` in place of `EmojiAutocompletePlugin`.

A user of English and Turkish then never gets a match from a Portuguese alias. English always
counts: it carries the shortcodes. Without `locales`, the menu matches every pack of the engine.

## Props

| Prop | Default | Notes |
| ---- | ------- | ----- |
| `engine` | — | `AliasEngine` or `undefined` |
| `semantic` | — | `SemanticProvider` (for example `createSemanticClient`, or `chainProviders(shards, api)`) |
| `locale` | first pack | Preferred locale for ranking and labels |
| `locales` | every pack | All the user's languages: the menu matches only their phrases. See [The user's languages](#the-users-languages). |
| `region` | the device's | Region for regional culture entries of the engine's culture file: the device's (its language, else its time zone), `""` for none, or an ISO code such as `"JP"` |
| `limit` | `8` | Menu size |
| `debounceMs` | `200` | Delay before a semantic request |
| `skinTone` | `"none"` | Applied to the shown and inserted emoji |
| `trigger` | `":"` | The menu opens after a space, a `(` or a line start |
| `minQueryLength` | `1` | Characters after the trigger before the menu opens |
| `shortcodes` | `true` | Replace a typed `:name:` when `name` is an exact shortcode or emoji name |
| `ariaLabel` | `"Emoji suggestions"` | Accessible name of the default menu |
| `menuRenderFn` | default menu | Lexical's `MenuRenderFn<EmojiOption>`, called only while there are results |
| `anchorClassName` | — | Class for the element Lexical positions at the caret |
| `commandPriority` | `COMMAND_PRIORITY_CRITICAL` | Priority of the open menu's key handlers. See below. |
| `menuContainer` | `document.body` | `HTMLElement` the menu mounts into. See [Mount the menu in your own frame](#mount-the-menu-in-your-own-frame). |

## Behaviour

| Input | Result |
| ----- | ------ |
| `:` + 1 or more characters | Menu opens with the alias results of this keystroke |
| ↑ / ↓ | Move the active option (wraps) |
| Enter / Tab | Insert the active emoji, as text, in place of `:query` (Shift+Enter is left to the editor) |
| Escape | Close the menu and keep the typed text. It stays closed until the next word. |
| no results | The menu closes. All keys go to the editor. |
| `:trex:`, `:+1:`, `:sweat_smile:` | Replaced by the emoji while you type |

Semantic results (when `semantic` is set and the alias engine is unsure) arrive after
`debounceMs` and are fused in. Confident alias hits keep their place, so the list does not jump.

The menu never scrolls the page. The default menu scrolls only its own list to keep the active
option visible. An insert does not scroll the caret into view (it is tagged
`skip-scroll-into-view`).

While the menu is open, it gets Enter, Tab, ↑ / ↓ and Escape first: its handlers use
`COMMAND_PRIORITY_CRITICAL`. Lexical's typeahead default (`COMMAND_PRIORITY_LOW`) lets other
plugins take these keys first, for example `TablePlugin` (Tab moves to the next cell) and code
blocks (Tab indents). While the menu is closed, all keys go to the editor. To use a different
priority, pass `commandPriority`.

## Mount the menu in your own frame

By default the menu mounts on `<body>`. To keep it inside a frame of your page (a demo window,
a dialog, a scroll panel), pass that element as `menuContainer`. The plugin passes it to the
typeahead as `parent`. Keep the element in state with a callback ref, so the plugin gets it
after the first render. While it is `null`, the menu mounts on `<body>`.

```tsx
import { EmojiAutocompletePlugin } from "@emojisense/lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useState } from "react";

function Editor() {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setFrame} style={{ position: "relative" }}>
      <LexicalComposer initialConfig={{ namespace: "demo", onError: console.error }}>
        <RichTextPlugin contentEditable={<ContentEditable />} ErrorBoundary={LexicalErrorBoundary} />
        <EmojiAutocompletePlugin engine={engine} menuContainer={frame} />
      </LexicalComposer>
    </div>
  );
}
```

Give the frame a non-static `position` (for example `position: relative`) if the frame must clip
the menu or set its stacking order. Lexical 0.51 positions the menu at the caret relative to such
a frame. Check the position if you use an older Lexical version.

## Accessibility

Lexical's typeahead puts a `role="listbox"` element at the caret and sets `aria-controls` and
`aria-activedescendant` on the editor. The default menu renders `role="option"` rows with the ids
Lexical expects, inside a group named by `ariaLabel`. Pointer presses on the menu do not take
focus from the editor.

## Custom menu

```tsx
import { EmojiAutocompletePlugin } from "@emojisense/lexical";
import { createPortal } from "react-dom";

<EmojiAutocompletePlugin
  engine={engine}
  menuRenderFn={(anchor, { options, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
    anchor.current && createPortal(<MyMenu options={options} /* … */ />, anchor.current)
  }
/>
```

Each `EmojiOption` has `suggestion: { emoji, id, label, source }`, with the skin tone applied. Give
option rows the ids `typeahead-item-<index>` so the editor's `aria-activedescendant` resolves.
`EmojiMenu` (the default) is exported for reuse.

If your rows set `ref={option.setRefElement}`, Lexical calls `scrollIntoView` on the active row,
which can also scroll the page. The default menu does not set it and scrolls its own list.

`registerShortcodeTransform(editor, resolve)` is exported too, for `:name:` completion without
the menu.

## License

MIT. Docs: [emojisense.com/docs](https://emojisense.com/docs/).
