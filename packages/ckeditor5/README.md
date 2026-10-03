# @emojisense/ckeditor5

`:` emoji autocomplete for [CKEditor 5](https://ckeditor.com/ckeditor-5/) (47 and later), ranked
by Emojisense. Type `:pizza` and 🍕 comes first. Type `:ship it` and 🚀 comes first.

- Built on the official Mention plugin. The chosen emoji is inserted as plain text, not as a
  mention.
- The alias engine answers each keystroke on device. When it is unsure and the Emojisense API is
  configured, the list waits briefly for results by meaning.
- The list items use CKEditor's own button classes, so editor themes style them.

## Install

```bash
pnpm add @emojisense/ckeditor5 emojisense ckeditor5
```

## Setup

```ts
import { EmojisenseMention } from "@emojisense/ckeditor5";
import { ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import "ckeditor5/ckeditor5.css";

await ClassicEditor.create({
  attachTo: document.querySelector<HTMLElement>("#editor")!,
  licenseKey: "GPL",
  plugins: [Essentials, Paragraph, EmojisenseMention],
  emojisense: {
    packUrl: "https://api.emojisense.com/v1/pack/0.1.0",
    endpoint: "https://api.emojisense.com", // optional: search by meaning
    publishableKey: "pk_live_…", // optional
  },
});
```

CKEditor 47 takes the element as the first argument: `ClassicEditor.create(element, config)`.

### With the official emoji feature

The Mention plugin allows one feed per marker. Load `EmojiPicker` for the emoji dialog, and leave
out `Emoji` and `EmojiMention`, which bring their own `:` feed. If both feeds are loaded, the first
one keeps `:` and the console shows `emojisense-marker-conflict`.

## Options (`config.emojisense`)

| Option | Default | Notes |
| ------ | ------- | ----- |
| `packUrl` | — | Base URL of a pack version. Set it or `engine`. The packs load when the editor first gets the focus, and a `:` typed before they arrive gets its list as soon as they do. Editors with the same packs on one page share one download. |
| `engine` | — | A ready `AliasEngine` instead of `packUrl` |
| `locale` | the content language | `"pt-br"` becomes `"pt"`. English always loads too. |
| `cultureUrl` | next to `packUrl` | Culture files, e.g. `https://api.emojisense.com/v1/culture/0.1.0`. Emoji for the place and the time join after the top result. `false`: off |
| `region` | the device's | Region for regional culture entries: the device's (its language, else its time zone), `""` for none, or an ISO code such as `"JP"` |
| `endpoint` | — | The Emojisense API. Without it, search stays on the device. |
| `publishableKey` | — | A `pk_…` key. Never put a secret key in a browser. |
| `semantic` | — | A `SemanticProvider` instead of `endpoint` |
| `skinTone` | — | `light`, `medium-light`, `medium`, `medium-dark` or `dark` |
| `limit` | `8` | List size |

## Behaviour

| Input | Result |
| ----- | ------ |
| `:` + 2 characters | The list opens. `:)` and `:D` stay text. |
| `12:30`, `https://` | No list: the colon must follow a space, a bracket or the line start. |
| `:ship it` | Spaces are allowed, up to 4 words. |
| ↑ ↓, Enter, Tab, Escape | The Mention plugin's keys |

## License

MIT. CKEditor 5 itself is GPL-2.0-or-later or commercial; this package does not include it. Docs:
[emojisense.com/docs](https://emojisense.com/docs/).
