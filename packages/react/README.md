# @emojisense/react

React hooks for Emojisense, a Frimousse adapter, and a shadcn registry item.

## Install

```bash
npm install @emojisense/react
npm install frimousse   # only for the Frimousse adapter
```

React 18 or 19. The search engine (`emojisense`) comes as a dependency.

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
| `cultureUrl` | Culture files, e.g. `https://api.emojisense.com/v1/culture/0.1.0`. Editorial emoji for the culture and the moment join the results after the top result, never above it (`source: "culture"`, with `context` and `cultureId`). A failed load is ignored. |
| `region` | ISO 3166-1 code such as `"BR"`. Regional culture entries apply only with a matching region. Default: the region of the browser's language (`navigator.language` `"pt-BR"` → `"BR"`; none without a region subtag). It is read on the device and never sent. `""` turns regional entries off. |
| `emojiSet` | How the pickers draw emoji. `"native"` (default) uses the system font. `"twemoji"`, `"noto"` and `"fluent"` draw `<img src="{endpoint}/v1/sets/{set}/{hexcode}.svg?key={publishableKey}" alt="{emoji}" loading="lazy">` and need `endpoint` and a `publishableKey` whose plan includes hosted sets (Solo and up). When a set has no image for an emoji (e.g. Fluent has no country flags), the native emoji takes its place. Credit the set in your app (see NOTICE). |

`useEmojiSearch(query, sense, { culture: false })` keeps the canonical ranking (for tests and
benchmarks). `useRelevantNow(sense, { limit })` returns `{ emoji, hexcode, context, cultureId }`
for a "relevant now" shelf: featured seasonal and event emoji active today.

For your own components, `<EmojiGlyph emoji={emoji} emojiSet={sense.emojiSet} endpoint={sense.endpoint} publishableKey={sense.publishableKey} />`
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

`showRelevantNow` (off by default) adds a "Relevant now" row above the browse list when
`cultureUrl` is set (`relevantNowLabel` renames it; style it with `[data-emojisense-relevant-now]`).
Culture results and shelf emoji name their reason in `title` and `aria-description`.

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

## License

MIT. Docs: [emojisense.com/docs](https://emojisense.com/docs/).
