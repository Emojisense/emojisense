# @emojisense/tinymce

`:` emoji autocomplete for [TinyMCE](https://www.tiny.cloud) 7 and 8, ranked by Emojisense. Type
`:pizza` and 🍕 comes first. Type `:ship it` and 🚀 comes first.

- Built on TinyMCE's own autocompleter API, so the menu looks and works like the rest of the
  editor.
- The alias engine answers each keystroke on device. When it is unsure and the Emojisense API is
  configured, the menu waits briefly for results by meaning.
- With the emoticons plugin loaded, it takes over that plugin's `:` menu. The emoticons dialog
  and toolbar button stay.

## Install

```bash
pnpm add @emojisense/tinymce emojisense tinymce
```

## Setup

```ts
import "tinymce";
import "tinymce/models/dom";
import "tinymce/themes/silver";
import "tinymce/icons/default";
import { registerEmojisense } from "@emojisense/tinymce";
import tinymce from "tinymce";

registerEmojisense(tinymce);

await tinymce.init({
  selector: "#editor",
  license_key: "gpl",
  plugins: "emojisense",
  emojisense_pack_url: "https://api.emojisense.com/v1/pack/0.1.0",
  emojisense_endpoint: "https://api.emojisense.com", // optional: search by meaning
  emojisense_publishable_key: "pk_live_…", // optional
});
```

### TinyMCE from a CDN or a script tag

Load the prebuilt plugin with `external_plugins`. It registers itself on the global `tinymce`.

```html
<script src="https://cdn.jsdelivr.net/npm/tinymce@8/tinymce.min.js"></script>
<script>
  tinymce.init({
    selector: "#editor",
    license_key: "gpl",
    external_plugins: {
      emojisense: "https://cdn.jsdelivr.net/npm/@emojisense/tinymce/dist/plugin.min.js",
    },
    emojisense_pack_url: "https://api.emojisense.com/v1/pack/0.1.0",
  });
</script>
```

In production, pin exact versions in both URLs and add `integrity` attributes. With a bundler,
`import "@emojisense/tinymce/plugin"` does the same as the script.

## Options

| Option | Default | Notes |
| ------ | ------- | ----- |
| `emojisense_pack_url` | — | Base URL of a pack version. Set it or `emojisense_engine`. The packs load when the editor first gets the focus, and an open `:` menu shows its results when they arrive. Editors with the same packs on one page share one download. |
| `emojisense_engine` | — | A ready `AliasEngine` instead of `emojisense_pack_url` |
| `emojisense_locale` | the editor's `language` | `"tr_TR"` becomes `"tr"`. English always loads too. |
| `emojisense_culture_url` | — | Culture files, e.g. `https://api.emojisense.com/v1/culture/0.1.0` |
| `emojisense_endpoint` | — | The Emojisense API. Without it, search stays on the device. |
| `emojisense_publishable_key` | — | A `pk_…` key. Never put a secret key in a browser. |
| `emojisense_semantic` | — | A `SemanticProvider` instead of `emojisense_endpoint` |
| `emojisense_skin_tone` | — | `light`, `medium-light`, `medium`, `medium-dark` or `dark` |
| `emojisense_limit` | `8` | Menu size |
| `emojisense_replace_emoticons` | `true` | Take over the emoticons plugin's `:` menu. With `false`, both menus merge into one list. |

## Behaviour

| Input | Result |
| ----- | ------ |
| `:` + 2 characters | The menu opens. `:)` and `:D` stay text. |
| `12:30`, `https://`, `a:b` | No menu: the colon must start a word. |
| `:ship it` | Spaces are allowed while the menu is open, up to 4 words. |
| ↑ ↓ | Move through the menu |
| Enter | Insert the emoji |
| Escape | Close the menu and keep the text |

TinyMCE looks up the query 50 ms after the last keystroke, and keeps a space in the query only
while the menu is open. If someone types `:ship it` faster than that, the menu opens only for
queries without spaces.

## Without the plugin system

`createAutocompleter({ source, insert })` returns the autocompleter spec, for code that registers
its own: `editor.ui.registry.addAutocompleter("emoji", spec)`. `source` returns a
`SuggestionSource` from `emojisense/autocomplete`.

WordPress's classic editor uses TinyMCE 4, which has no autocompleter API. The
[Emojisense WordPress plugin](https://emojisense.com/docs/integrations/wordpress/) covers it.

## License

MIT. TinyMCE itself is GPL-2.0-or-later or commercial; this package does not include it. Docs:
[emojisense.com/docs](https://emojisense.com/docs/).
