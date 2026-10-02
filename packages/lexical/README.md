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

```tsx
import { EmojiAutocompletePlugin } from "@emojisense/lexical";
import "@emojisense/lexical/styles.css"; // optional default look
import { useEmojisense } from "@emojisense/react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";

function Editor() {
  const sense = useEmojisense({ packBaseUrl: "https://<api>/v1/pack/0.1.0", endpoint: "https://<api>" });
  return (
    <LexicalComposer initialConfig={{ namespace: "chat", onError: console.error }}>
      <RichTextPlugin contentEditable={<ContentEditable />} ErrorBoundary={LexicalErrorBoundary} />
      <EmojiAutocompletePlugin engine={sense.engine} semantic={sense.semantic} skinTone="medium" />
    </LexicalComposer>
  );
}
```

Without React hooks for the data: `engine={createEngine(await loadPacks({ baseUrl }))}` from
`emojisense`. While `engine` is `undefined` (packs still loading) the plugin stays inactive.

## Props

| Prop | Default | Notes |
| ---- | ------- | ----- |
| `engine` | — | `AliasEngine` or `undefined` |
| `semantic` | — | `SemanticProvider` (for example `createSemanticClient`, or `chainProviders(shards, api)`) |
| `locale` | first pack | Preferred locale for ranking and labels |
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

While the menu is open, it gets Enter, Tab, ↑ / ↓ and Escape first: its handlers use
`COMMAND_PRIORITY_CRITICAL`. Lexical's typeahead default (`COMMAND_PRIORITY_LOW`) lets other
plugins take these keys first, for example `TablePlugin` (Tab moves to the next cell) and code
blocks (Tab indents). While the menu is closed, all keys go to the editor. To use a different
priority, pass `commandPriority`.

## Accessibility

Lexical's typeahead puts a `role="listbox"` element at the caret and sets `aria-controls` and
`aria-activedescendant` on the editor. The default menu renders `role="option"` rows with the ids
Lexical expects, inside a group named by `ariaLabel`. Pointer presses on the menu do not take
focus from the editor.

## Custom menu

```tsx
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

`registerShortcodeTransform(editor, resolve)` is exported too, for `:name:` completion without
the menu.
