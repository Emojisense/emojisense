# @emojisense/tiptap

`:` emoji autocomplete for [Tiptap](https://tiptap.dev) 3, ranked by Emojisense. Type
`:jurassic` and 🦖 comes first. Type `:fire:` and it becomes 🔥.

- Built on the official `@tiptap/suggestion` utility.
- The alias engine answers each keystroke on device, in well under a frame. Optional semantic
  results arrive debounced and are fused into the open menu.
- A framework-free default menu (ARIA listbox) is included. You can replace it with your own.

## Install

```bash
pnpm add @emojisense/tiptap emojisense @tiptap/core @tiptap/pm @tiptap/suggestion @floating-ui/dom
```

`@floating-ui/dom` is a peer dependency of `@tiptap/suggestion` (≥ 3.28), which positions the menu.

## Setup

```ts
import { EmojiAutocomplete } from "@emojisense/tiptap";
import "@emojisense/tiptap/styles.css"; // optional default look
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createEngine, createSemanticClient, loadPacks } from "emojisense";

const engine = createEngine(await loadPacks({ baseUrl: "https://<api>/v1/pack/0.1.0" }));

new Editor({
  element: document.querySelector("#editor")!,
  extensions: [
    StarterKit,
    EmojiAutocomplete.configure({
      engine,
      semantic: createSemanticClient({ endpoint: "https://<api>" }), // optional
      skinTone: "medium", // optional
    }),
  ],
});
```

### With React and `@emojisense/react`

The packs load after the editor is created, so pass getters. The extension reads them on each
keystroke and also picks up the idle-loaded extension packs.

```tsx
const sense = useEmojisense({ packBaseUrl: "https://<api>/v1/pack/0.1.0", endpoint: "https://<api>" });
const senseRef = useRef(sense);
senseRef.current = sense;

const editor = useEditor({
  extensions: [
    StarterKit,
    EmojiAutocomplete.configure({
      engine: () => senseRef.current.engine,
      semantic: () => senseRef.current.semantic,
    }),
  ],
});
```

## Options

| Option | Default | Notes |
| ------ | ------- | ----- |
| `engine` | — | `AliasEngine`, or a getter. The menu stays closed while it is `undefined`. |
| `semantic` | — | `SemanticProvider` (for example `createSemanticClient`, or `chainProviders(shards, api)`), or a getter |
| `locale` | first pack | Preferred locale for ranking and labels |
| `limit` | `8` | Menu size |
| `debounceMs` | `200` | Delay before a semantic request |
| `skinTone` | `"none"` | `SkinTone`, or a getter that follows a user preference |
| `char` | `":"` | Trigger character. The menu opens after a space, a `(` or a line start. |
| `minQueryLength` | `1` | Characters after the trigger before the menu opens |
| `shortcodes` | `true` | Replace a typed `:name:` when `name` is an exact shortcode or emoji name |
| `render` | `createEmojiMenu()` | Menu renderer, same contract as the suggestion utility's `render` |

## Behaviour

| Input | Result |
| ----- | ------ |
| `:` + 1 or more characters | Menu opens with the alias results of this keystroke |
| ↑ / ↓ | Move the active option (wraps) |
| Enter / Tab | Insert the active emoji, as text, in place of `:query` |
| Escape | Close the menu and keep the typed text. It stays closed until the next word. |
| no results | The menu closes. Enter and the other keys go to the editor. |
| `:trex:`, `:+1:`, `:sweat_smile:` | Replaced by the emoji while you type |

Semantic results (when `semantic` is set and the alias engine is unsure) arrive after
`debounceMs` and are fused in. Confident alias hits keep their place, so the list does not jump.

## Accessibility

The default menu is a `role="listbox"` named "Emoji suggestions", with `role="option"` rows. Focus
stays in the editor, which gets `aria-controls`, `aria-autocomplete="list"` and
`aria-activedescendant` while the menu is open. Pointer presses on the menu do not take focus from
the editor.

## Custom menu

`render` follows the `@tiptap/suggestion` contract. `props.items` are `EmojiSuggestion`s
(`{ emoji, id, label, source }`, skin tone applied). Call `props.command(item)` to insert one.
Late semantic results arrive as another `onUpdate` with the same `query`.

```ts
EmojiAutocomplete.configure({
  engine,
  render: () => ({
    onStart: (props) => myMenu.open(props.items, props.command, props.mount),
    onUpdate: (props) => myMenu.update(props.items),
    onExit: () => myMenu.close(),
    onKeyDown: ({ event }) => myMenu.handleKey(event),
  }),
});
```

To restyle the default menu, pass `createEmojiMenu({ className, ariaLabel })` or override the CSS
custom properties in `styles.css`.
