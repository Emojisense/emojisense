# emojisense

The search brain any emoji picker plugs into. Type what you mean and get the emoji: "ship it" →
🚀, "jurassic park" → 🦖, "greatest of all time" → 🐐, "kolay gelsin" → 💪.

- **On device first.** The alias engine searches the data packs on every keystroke, in well under
  a frame, offline. Alias search alone is about 10 KB gz; every export together is about 16 KB gz.
- **The network only when unsure.** Conceptual queries can go to precomputed shards and then to
  the Emojisense API. Their results are fused in without moving confident alias hits.
- **No dependencies.** Browsers, Node ≥ 20, Deno, Bun, Cloudflare Workers, browser extensions.
- **11 languages:** en, es, zh, hi, ar, fr, bn, pt, ru, id, tr.

[Docs](https://emojisense.com/docs/) · [Playground](https://emojisense.com/playground/) ·
[Pack format](https://emojisense.com/docs/pack-format/) · [Source](https://github.com/emojisense/emojisense)

Pickers built on this package: `@emojisense/react` (hooks + Frimousse), `@emojisense/web-component`
(`<emojisense-picker>`), `@emojisense/emoji-mart`, `@emojisense/lexical`, `@emojisense/tiptap` and
`@emojisense/mcp` (an MCP server for AI assistants).

## Install

```bash
npm install emojisense
```

## Search on the device

```ts
import { createEngine, loadPacks } from "emojisense";

const baseUrl = "https://api.emojisense.com/v1/pack/0.1.0";
const packs = await loadPacks({ baseUrl, locales: ["en", "tr"] });
const engine = createEngine(packs);

const { results, confidence } = engine.search("ship it", { locale: "en" });
// results[0]: { emoji: "🚀", id: "1F680", score: 0.9, source: "alias", label: "rocket", match: "ship it", field: "alias" }
```

`search` is synchronous. `limit` defaults to 24. `prefix` (default `true`) treats the last word as
a prefix while someone types. `locale` prefers phrases from that language. English always loads
first, because it carries the shortcodes.

The core packs (about 180 KB gz for English) are made for the first render. The extension packs
add the long tail of aliases. Load them when the browser is idle and build the engine again:

```ts
import { createEngine, loadPacks } from "emojisense";

const baseUrl = "https://api.emojisense.com/v1/pack/0.1.0";
const core = await loadPacks({ baseUrl, locales: ["en"] });
const ext = await loadPacks({ baseUrl, locales: ["en"], part: "ext" });
const engine = createEngine([...core, ...ext]);
```

The pack files are immutable, so the HTTP cache keeps them. You can also bundle the JSON files with
your app and pass them to `createEngine` after `assertPack(value)`.

## Search sessions: alias results now, semantic results when unsure

`createSearchSession` is the controller behind every Emojisense picker. It gives alias results
synchronously on every keystroke. When the engine is unsure, it asks the semantic layers after a
debounce (200 ms) and fuses their answer in. It drops stale answers.

```ts
import { createEngine, createLayeredSemantic, createSearchSession, loadPacks } from "emojisense";

const engine = createEngine(await loadPacks({ baseUrl: "https://api.emojisense.com/v1/pack/0.1.0" }));
const semantic = createLayeredSemantic({
  endpoint: "https://api.emojisense.com", // the metered API (layer 3)
  key: "pk_live_…", // a publishable key from the dashboard
  packVersion: engine.packVersion,
});

const session = createSearchSession({
  engine,
  semantic, // omit it for fully offline search
  locale: "en",
  onChange: (state) => {
    // state.status: "idle" | "alias" | "loading" | "fused" | "error"
    console.log(state.status, state.results.map((result) => result.emoji).join(" "));
  },
});

session.update("a dinosaur from a movie");
```

| Layer | Function | Cost |
| ----- | -------- | ---- |
| 1. Device | `createEngine` | Free, offline |
| 2. Shards | `createShardProvider({ baseUrl })` | Free static files with precomputed answers |
| 3. API | `createSemanticClient({ endpoint, key })` | Metered, see [pricing](https://emojisense.com/pricing/) |

`createLayeredSemantic({ shardsUrl, endpoint, key })` chains layers 2 and 3, cheapest first.
A shard that is already loaded answers between keystrokes, with no debounce and no request.
Shards are per locale: a search with `locale: "tr"` reads `<shardsUrl>/tr/…`, English reads
`<shardsUrl>/…` as before, and a locale without shards goes to the API.
`chainProviders(...providers)` chains any providers: a provider returns `undefined` when it has no
answer, and the next one gets the query. Over its plan limit, the API still answers from its shared
cache and never fails hard.

**Search reports.** `createStatsReporter({ endpoint, key })` from `emojisense/stats` counts how
searches end (`observe(state)` in the session's `onChange`) and which results are picked
(`pick(query, id)`), and sends one small report per page view from 1 in 10 sessions
(`POST /v1/events`). Off unless you create it.

To fuse by hand: `shouldUseSemantic(aliasOutput)` tells you when to ask, and
`fuse(aliasOutput, semanticResults)` merges the two lists.

**Unsure queries.** `state.unsure` is `true` when no tier understood the query: the dictionary
does not cover its words (a name such as "kendrick lamar") and the semantic list is flat or low
(`assessConfidence`). Show the results as guesses then.

## `:` autocomplete for any editor

`emojisense/autocomplete` holds the editor-independent part of a `:` autocomplete: where the query
starts, what the menu shows, and when semantic results replace it. The Tiptap, Lexical, CKEditor 5
and TinyMCE adapters use it. Use it for your own editor:

```ts
import { createEngine, loadPacks } from "emojisense";
import { createSuggestionSource, findTrigger } from "emojisense/autocomplete";

const engine = createEngine(await loadPacks({ baseUrl: "https://api.emojisense.com/v1/pack/0.1.0" }));
const source = createSuggestionSource({ engine, locale: "en", minQueryLength: 2 });

const match = findTrigger("Ready to :ship it", ""); // { query: "ship it", start: 9 }
if (match) {
  const suggestions = await source.resolve(match.query);
  // [{ emoji: "🚀", id: "1F680", label: "rocket", source: "alias" }, …]
}
```

| Export | Purpose |
| ------ | ------- |
| `findTrigger(before, after)` | The `:query` that ends at the caret. Not in `12:30`, `https://` or `a:b`. Up to 4 words. |
| `createSuggestionSource` | `search(query)`: alias rows now, fused rows later through `onLateResults`. `resolve(query)`: one promise per query, for editors that take one. |
| `findShortcode(engine, code)` | An exact `:name:` match, for completing `:fire:` to 🔥 |
| `allowContext`, `SHORTCODE_BEFORE_CARET` | The context rule and the shortcode pattern on their own |
| `createEngineLoader({ packUrl, locale })` | Core packs on first use, extension packs when the browser is idle. English alone when the locale has no pack. |
| `createApiSemantic({ endpoint, key, packVersion })` | The API host's free shards, then the metered API. `undefined` without an endpoint. |

## More

```ts
import {
  applySkinTone,
  createEngine,
  emojiImageUrl,
  loadCulture,
  loadCustomPack,
  loadPacks,
  relevantNow,
} from "emojisense";

const endpoint = "https://api.emojisense.com";
const packs = await loadPacks({ baseUrl: `${endpoint}/v1/pack/0.1.0`, locales: ["en", "es"] });

// Culture: editorial emoji for the moment and the culture join the results after the top result.
const culture = await loadCulture({ baseUrl: `${endpoint}/v1/culture/0.1.0`, locale: "es" });
const engine = createEngine(packs, { culture });
engine.search("goat", { locale: "es", region: "AR" }); // 🐐 first, then culture results such as ⚽
relevantNow(culture, { region: "MX", limit: 8 }); // a "relevant now" shelf
// region: "auto" in createSearchSession: the API reports the caller's region (region=auto, from
// the request's country), and regional entries apply after the first API answer.

// Skin tones and hosted emoji sets (they need a key whose plan includes them, Solo and up).
applySkinTone("👍", "medium"); // "👍🏽"
emojiImageUrl("🦖", { endpoint, emojiSet: "noto", key: "pk_live_…" });
// "https://api.emojisense.com/v1/sets/noto/1F996.svg?key=<your key, URL-encoded>"

// Your app's custom emoji, searched on the device next to the standard set.
const custom = await loadCustomPack({ endpoint, key: "pk_live_…" });
createEngine([...packs, custom]).search("party parrot");
```

| Export | Purpose |
| ------ | ------- |
| `createEngine`, `loadPacks`, `loadCustomPack`, `assertPack` | The on-device index and its data |
| `createSearchSession` | Keystroke controller with debounce, fusion and stale-answer handling |
| `createLayeredSemantic`, `createShardProvider`, `createSemanticClient`, `chainProviders` | Semantic layers |
| `fuse`, `fuseResults`, `shouldUseSemantic`, `semanticConfidence`, `rerank`, `rerankFeatures`, `RERANK_WEIGHTS` | Fusion of alias and semantic results (the learned reranker by default) |
| `loadCulture`, `applyCulture`, `matchCulture`, `relevantNow`, `regionOf`, `deviceRegion` | The culture layer |
| `applySkinTone`, `SKIN_TONES`, `emojiImageUrl`, `EMOJI_SETS`, `groupLabel` | Rendering helpers |
| `normalize`, `tokenize`, `baseId`, `hexcodeOf` | Text and id helpers |
| `encodeVectors`, `decodeVectors`, `searchVectors`, `searchVectorSets` from `emojisense/vectors` | The emoji vector file format, for semantic search without the API (a separate entry, not in the picker bundle) |
| `createSuggestionSource`, `findTrigger`, `findShortcode` from `emojisense/autocomplete` | The `:` autocomplete logic of the editor adapters (see above) |

The full reference is at [emojisense.com/docs/sdk](https://emojisense.com/docs/sdk/).

## Data and privacy

- The engine sends nothing. Only the semantic layers that you configure use the network.
- The API receives the normalized query text (at most 64 characters). It never logs IP addresses,
  keys or user ids. See [privacy](https://emojisense.com/docs/privacy/).
- The packs contain data from [Emojibase](https://emojibase.dev) (MIT) and
  [Unicode CLDR](https://cldr.unicode.org) (Unicode License v3). When you redistribute the pack
  files (for example in your app bundle), include their license notices from
  [packages/data/licenses](https://github.com/emojisense/emojisense/tree/main/packages/data/licenses).

## License

MIT
