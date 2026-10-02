# @emojisense/react

React hooks for Emojisense, a Frimousse adapter, and a shadcn registry item.

## Hooks

```tsx
import { useEmojiSearch, useEmojisense } from "@emojisense/react";

const sense = useEmojisense({
  packBaseUrl: "https://api.emojisense.com/v1/pack/0.1.0",
  shardsUrl: "https://api.emojisense.com/p/0.1.0", // layer 2: free static files, asked first
  endpoint: "https://api.emojisense.com", // layer 3: metered API, asked on a shard miss
  publishableKey: "pk_live_…",
});
const { results, status, layer } = useEmojiSearch(query, sense);
```

| Option | Effect |
| ------ | ------ |
| `packBaseUrl` | Pack version directory. The core pack renders first. The extension pack loads when the browser is idle (`extended: false` turns it off). |
| `locale` | `"tr"` loads the Turkish pack next to English. |
| `shardsUrl` | Precomputed results. Omit it when no shards are deployed. |
| `endpoint`, `publishableKey` | Semantic API. Omit `shardsUrl` and `endpoint` for fully offline search. |
| `emojiSet` | How the pickers draw emoji. `"native"` (default) uses the system font. `"twemoji"`, `"noto"` and `"fluent"` draw `<img src="{endpoint}/v1/sets/{set}/{hexcode}.svg" alt="{emoji}" loading="lazy">` and need `endpoint`. When a set has no image for an emoji (e.g. Fluent has no country flags), the native emoji takes its place. Credit the set in your app (see NOTICE). |

For your own components, `<EmojiGlyph emoji={emoji} emojiSet={sense.emojiSet} endpoint={sense.endpoint} />`
draws one emoji the same way (a 1em image, or the text).

`useEmojiSearch` returns alias results synchronously on every keystroke. Semantic results arrive
after a debounce and are fused in without moving confident alias hits.

| Field | Meaning |
| ----- | ------- |
| `status` | `idle`, `alias`, `loading`, `fused` or `error` |
| `layer` | Which layer produced `results`: `device`, `shard` or `api`. `undefined` while idle or loading. Count it when `status` settles to build per-layer counters. |
| `aliasMs`, `semanticMs`, `semanticCached` | Timings for latency displays |

## Frimousse adapter

```tsx
import { EmojisensePicker } from "@emojisense/react/frimousse";

<EmojisensePicker emojisense={sense} onEmojiSelect={({ emoji }) => insert(emoji)} />;
```

Frimousse keeps its browse view. Typed queries show the Emojisense ranking as an ARIA listbox
with the same `onEmojiSelect` contract and skin tone. The picker can mount before the packs
arrive. It shows Frimousse's loading state and remounts when they are ready.

## shadcn/ui

The registry item `emoji-picker` is the Frimousse picker with Emojisense search, styled with
Tailwind v4 theme tokens (`bg-popover`, `bg-accent`, `text-muted-foreground`) and the `cn`
helper from `@/lib/utils`.

```bash
npx shadcn@latest add https://<host>/r/emoji-picker.json
```

The command copies `components/ui/emoji-picker.tsx` and installs `@emojisense/react`,
`emojisense` and `frimousse`.

```tsx
import { useEmojisense } from "@emojisense/react";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ReactionButton({ onPick }: { onPick: (emoji: string) => void }) {
  const sense = useEmojisense({ packBaseUrl, shardsUrl, endpoint });
  return (
    <Popover>
      <PopoverTrigger>😀</PopoverTrigger>
      <PopoverContent className="w-fit p-0">
        <EmojiPicker className="h-[21rem]" emojisense={sense} onEmojiSelect={({ emoji }) => onPick(emoji)}>
          <EmojiPickerSearch />
          <EmojiPickerContent />
          <EmojiPickerFooter />
        </EmojiPicker>
      </PopoverContent>
    </Popover>
  );
}
```

| Part | Role |
| ---- | ---- |
| `EmojiPicker` | Frimousse root. Props: `emojisense`, `onEmojiSelect`, `columns` (9), `limit` (36), and the Frimousse root props. |
| `EmojiPickerSearch` | Combobox input. Arrow keys move through the results, Enter selects. |
| `EmojiPickerContent` | Browse list for an empty query, ranked listbox for a typed query. `empty` sets the no-results text. |
| `EmojiPickerFooter` | Active emoji preview and the skin tone selector |

### Build and host the registry

```bash
pnpm --filter @emojisense/react build            # also writes dist/r/
pnpm --filter @emojisense/react registry:build   # only the registry
```

The build reads `registry/registry.json`, inlines each file, and writes `dist/r/registry.json`
and `dist/r/emoji-picker.json` in the format of `shadcn build`. Serve `dist/r` at `/r/` on any
static host. The source lives in `registry/emoji-picker.tsx`. `registry/lib/utils.ts` is a
stand-in for the app's `cn` and is not shipped.
