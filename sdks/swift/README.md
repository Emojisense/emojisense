# Emojisense for Swift

Semantic emoji search for iOS and macOS. This package is a port of `packages/core`. It gives the
same results as the TypeScript engine.

| Part | Type | What it does |
| ---- | ---- | ------------ |
| Tier 0 | `AliasEngine` | Offline alias search over the packs (PACK_FORMAT.md §4). Runs on every keystroke. |
| Normalization | `Normalizer` | PACK_FORMAT.md §3, for queries and labels. |
| Packs | `Pack`, `PackLoader`, `Manifest` | Decodes `pack.<locale>.json` and `pack.<locale>.ext.json`. Verifies `sha256`. |
| Layer 2 | `ShardProvider` | Precomputed semantic results from static shards on the CDN (§6): a live layer, then a base layer. A loaded shard answers `peek` between keystrokes. |
| Layer 3 | `SemanticClient` | `GET /v1/search?mode=semantic&culture=0`, with an LRU cache that answers `peek`. Over the limit it still gets the edge's cached answers. |
| Fusion | `Fusion` | Pinned reciprocal rank fusion, as in `core/src/fusion.ts`. |
| Session | `SearchSession` | The search loop, as `createSearchSession` in `core/src/session.ts`: alias results on every keystroke, semantic results fused in after a debounce (or at once from memory), culture applied last. |
| Culture | `Culture`, `CultureLayer`, `CultureResult` | Decodes `culture.<locale>.json` (PACK_FORMAT.md §9). Adds editorial emoji after the canonical top result, by region and calendar day, as `core/src/culture.ts`. |
| Confidence | `Confidence` | The unsure verdict (`assess`), as in `core/src/confidence.ts`. |
| Emoji sets | `EmojiSet`, `Hexcode` | The `emojiSet` option of the pickers: `.native` or a hosted set. `imageURL(for:endpoint:key:)` gives `/v1/sets/<set>/<hexcode>.svg?key=…` (a key whose plan includes hosted sets). No UI. |

Requirements: iOS 16+ or macOS 13+, Swift 6. No third-party dependencies.

## Install

Swift Package Manager needs `Package.swift` at the root of a repository. The package is published
from `sdks/swift` (the URL below is a placeholder):

```swift
dependencies: [
  .package(url: "https://github.com/emojisense/emojisense-swift.git", from: "0.1.0"),
],
targets: [
  .target(name: "App", dependencies: [.product(name: "Emojisense", package: "emojisense-swift")]),
]
```

For local development, use a path dependency: `.package(path: "../emojisense/sdks/swift")`.

To release, the owner runs `scripts/release-swift.sh <version>` at the repository root. It copies the
history of `sdks/swift` into the mirror repository and tags it (`0.1.0`, no `v`). SwiftPM resolves
`from:` against these tags. `.spi.yml` tells the Swift Package Index to build the DocC
documentation. See [RELEASING.md](../../RELEASING.md).

## Usage

```swift
import Emojisense

// 1. Load the core packs (English is always first). You can also bundle the files and use
//    `try Pack(jsonData: data)`.
let packURL = URL(string: "https://api.emojisense.com/v1/pack/0.1.0")!
let loader = PackLoader(baseURL: packURL)
let manifest = try await loader.loadManifest()
let core = try await loader.loadPacks(locales: ["en", "tr"], manifest: manifest)

// 2. Load the culture file next to the packs (`.../v1/culture/0.1.0`). Without it, search has
//    no culture layer and works as before, so a failed load is not an error.
let culture = try? await CultureLayer.loadCulture(
  baseURL: CultureLayer.cultureURL(forPackURL: packURL)!, locale: "tr")
var engine = try AliasEngine(core: core, culture: culture)

// 3. When the device is idle, load the extension parts and rebuild the index. Make a new
//    session for the new engine.
let extensions = try await loader.loadPacks(locales: ["en", "tr"], part: .ext, manifest: manifest)
engine = try AliasEngine(core: core, extensions: extensions, culture: culture)

// 4. Semantic layers: static shards first (free files on the CDN), then the API.
let semantic = ProviderChain([
  ShardProvider(baseURL: URL(string: "https://cdn.emojisense.com/p/0.1.0")!),
  SemanticClient(
    configuration: .init(
      endpoint: URL(string: "https://api.emojisense.com")!, key: "pk_live_…",
      packVersion: engine.packVersion)),
])

// 5. The session loads the shard indexes at once. Call `update` on every keystroke. `show` is
//    your UI.
let session = SearchSession(engine: engine, semantic: semantic, locale: "tr", limit: 12) {
  state in
  Task { @MainActor in
    // `state.unsure`: no tier understood the query. Show the results as guesses.
    show(state.results, unsure: state.unsure)
  }
}
session.update("greatest of all time")
```

`SearchSession` does what the reference session does:

1. It searches the alias engine at once and calls `onChange` before `update` returns.
2. When the alias engine is unsure (`Fusion.shouldUseSemantic`), it asks the semantic layers. An
   answer in memory (`peek`: a loaded shard, or an answer `SemanticClient` already has) comes at
   once, with no debounce and no request. Otherwise the session calls `prefetch`, waits for the
   debounce (200 ms) and calls `search`.
3. It fuses the alias and semantic results (`Fusion.fuse`, `Confidence.assess`). Fusion always
   sees `Fusion.rankDepth` candidates, and the session cuts the list to `limit`.
4. It applies the culture layer last, so the canonical top result stays first.

A newer `update` cancels the older request, and the session drops an answer for an older query.
`onChange` runs in `update` for the alias results and for answers in memory, and on a background
task for requested answers. The calls never overlap and come in order. Hop to the main actor the
same way in every call, as above. Keep `onChange` short, and never wait in it for the thread that
calls `update` (no `DispatchQueue.main.sync`). Call `cancel()` when the search UI goes away.

To build your own loop, use `engine.canonicalSearch` (alias results only), `Fusion.fuse`, and then
`CultureLayer.applyCulture` on the fused list.

Notes:

- In your own loop, call `peek` first on each keystroke. A loaded shard, or an answer that
  `SemanticClient` already has, needs no debounce and no request. Otherwise call `prefetch`, then
  debounce `search` (for example 200 ms). Cancel the task when the query changes. `peek` never
  returns an `overLimit` answer.
- `AliasEngine` is thread-safe. Concurrent searches use one shared scratch buffer, one at a time.
- `SemanticClient` returns `nil` while it is paused after an `overLimit` answer. It throws
  `EmojisenseError.httpStatus` for HTTP errors. `ShardProvider` returns `nil` for network errors,
  so the next provider gets the query.
- `ShardProvider` reads the shards of `SemanticSearchOptions.locale`. English (or no locale) uses
  `<base>/index.json`. Another locale uses its folder, for example `<base>/tr/index.json`. The
  index names the file of each key (`files`) and the index of the base layer (`base`), as URLs
  relative to the index. The provider asks the live layer, then the base layer. An index without
  `files` (older builds) means `<key>.json` next to the index.
- Use the CDN, `https://cdn.emojisense.com/p/0.1.0`: the shards are free static files there. The API
  host serves the same files at `https://api.emojisense.com/p/0.1.0`.
- If a file does not exist (404) or is not valid, `ShardProvider` remembers that and does not ask
  again: a locale without shards goes to the API. After a network error, it asks again once
  `retryDelay` (10 s) has passed.
- Inject an `HTTPTransport` to add headers, logging or a stub for tests.
- `AliasSearchOutput.coverage` is the largest share of the query that one phrase matches with
  whole tokens. Below `Confidence.wholeCoverage` (0.85) the dictionary does not explain the query.

## Culture

The culture layer adds editorial emoji next to the canonical answer: "greatest of all time" keeps
🐐 first and also shows ⚽ 🇦🇷 🇵🇹. It is a port of `packages/core/src/culture.ts`
(PACK_FORMAT.md §9).

- **On by default.** An engine with a culture file (`AliasEngine(…, culture:)` or
  `engine.withCulture(file)`) applies it in `search` and in every `SearchSession`. Load the file
  next to the packs: `CultureLayer.cultureURL(forPackURL:)` turns `.../v1/pack/0.1.0` into
  `.../v1/culture/0.1.0`, and `CultureLayer.loadCulture(baseURL:locale:)` fetches
  `culture.<locale>.json`. Load the file of the pack locale, or the English file when the
  locale has no packs. `withCulture` shares the index; it does not rebuild it.
- **Off.** `AliasSearchOptions(culture: false)`, `engine.canonicalSearch`, or
  `SearchSession(engine:…, culture: nil, …)`. Use it for reproducible ranking.
- **Where results go.** Culture results come right after the canonical top result, never above
  it. One exception: a regional sense (`CultureKind.regional`) of the whole query in the app's
  region leads when the canonical top result is the other region's reading ("football" in
  Germany: ⚽ first, 🏈 second). In `AliasSearchOutput.results` a culture result has
  `source == .culture`, `field == .culture`, a `context` (the reason, in the file's locale) and a
  `cultureId`. In `SessionState.results` it is a `SearchResult` with the same `source`,
  `context` and `cultureId`.
- **Region.** `region: nil` (or `"device"`) is the device's region: `Locale.current.region`,
  else the region of `TimeZone.current` in the file's `zones` map. `""` is no region: only the
  entries for every region apply. A code (`"BR"`) is used as given. In a session, `"auto"` sends
  `region=auto` to the API and uses the region of the first answer that has one. A region code
  never leaves the device. `CultureLayer.resolveRegion(_:culture:)` applies these rules.
- **Day.** Windows are checked against the local calendar day (Gregorian calendar, device time
  zone) on every search, so one file covers 12 months. `AliasSearchOptions(now:)`,
  `AliasSearchOptions(day: "2026-10-31")` and `SearchSession(…, now:)` set the day. A `day` that
  is not `YYYY-MM-DD` is a programming error (precondition failure); check one first with
  `CultureLayer.scopeDay(day:)`, which throws.
- **The API.** `SemanticClient` sends `culture=0` on every request: the session applies culture
  on the device after fusion, so the API must not apply it too.
- **Messages.** `CultureLayer.matchCultureInText` and `applyCulture(…, text: true)` find
  triggers inside a message (reaction suggestions): whole words, or anywhere for scripts written
  without spaces. A message gets no regional lead.
- **Shelf.** `CultureLayer.relevantNow(_:)` lists featured seasonal and event emoji that are
  active today.

### Changes to the public API

The culture layer added these. Existing code compiles unchanged, except an exhaustive `switch`
over `ResultSource`, `Field` or `EmojisenseError`, which needs the new cases.

| Type | Change |
| ---- | ------ |
| `AliasEngine` | `culture`, `init(…, culture:)`, `withCulture(_:)`, `canonicalSearch(_:options:)`. `search` adds culture results when the engine has a culture file. |
| `AliasSearchOptions` | `culture` (default `true`), `region` (default: the device's region), `now`, `day`. |
| `AliasResult` | `source` (`.alias` or `.culture`), `context`, `cultureId`. `searchResult` keeps them. |
| `SearchResult` | `context`, `cultureId` (culture results only). |
| `ResultSource` | New case `culture`. |
| `Field` | New case `culture`: marks a culture result. It is not a pack field. |
| `SemanticSearchOptions` | `region` (only `"auto"` is sent). |
| `SemanticResponse` | `region` (the region the API found for `region=auto`). |
| `SemanticClient` | Sends `culture=0`, and `region=auto` for the region `"auto"`. |
| `EmojisenseError` | New cases `invalidData(_:)` and `invalidLocale(_:)`. |

## Tests and conformance

```sh
pnpm install && pnpm --filter emojisense build && pnpm data:build   # at the repository root
cd sdks/swift && swift build && swift test
```

The conformance tests compare the Swift port with the TypeScript reference engine.
`Tests/EmojisenseTests/Resources/golden.json` holds the reference output.
`Tests/EmojisenseTests/Resources/culture-golden.json` holds the culture layer's reference output
(Kotlin reads the same file). The tests read the packs from `packages/data/dist/packs/<version>`,
or from `EMOJISENSE_PACK_DIR`. The packs are not copied into the SDK, because they are 2 MB. If the packs are missing, the search tests are skipped. If the
packs differ from the ones in `golden.json` (sha256), the tests fail and tell you to regenerate.

| Check | Cases | Result |
| ----- | ----: | -----: |
| Normalization: fixed cases (spec examples; Latin, Greek, Cyrillic, Arabic, Hebrew, Indic, CJK and Thai; emoji; NFKC; case; plus rule; length cap) | 87 | 100% |
| Normalization: every code point of planes 0–3 and 14, hashed per block of 1,024 | 320 blocks | 100% |
| Search, core + ext packs: same top-5 ids (required ≥ 98%) | 217 queries | 100% |
| Search, core + ext packs: same query, top-10 ids and scores, confidence, matched phrase | 217 queries | 100% |
| Search, core packs only: same top-5 ids / same top-10 ids and scores | 217 queries | 100% / 100% |
| Sentences with function words, en + zh, ru, id, es, fr, pt, ar, hi or bn (core + ext): same top-5 ids / same top-10 ids and scores | 369 queries | 100% / 100% |
| Entities (names, titles, brands, memes, holidays), en alone or en + es, fr, ru, zh, hi, ar, bn, pt, id or tr (core + ext), every other one: same top-5 ids / same top-10 ids and scores | 132 queries | 100% / 100% |
| Partial-match guard queries, all 22 packs of 11 locales in one engine: same top-5 ids / same top-10 ids and scores | 28 queries | 100% / 100% |
| Coverage (`AliasSearchOutput.coverage`) of every search query above: same value (required 100%) | 963 queries | 100% |
| Keystrokes (every prefix of 44 queries, 63 sentences and 10 guard queries): same top-5 ids and scores | 1,452 | 100% |
| Fusion (`Fusion.fuse`) on recorded lists, with and without the reranker (55 queries and 2 number-slang queries): same top-10 ids | 57 × 2 | 100% |
| Confidence cases (`Confidence.assess`, `semanticStrength`): same confidence and unsure (required 100%); strength within 1e-12 (39 cases with a semantic list; largest difference 0) | 44 cases | 100% |
| Function-word lists (`FunctionWords.swift`) equal the reference | 11 locales | 100% |
| Culture layer (`culture-golden.json`: one English culture file, every entry's first trigger in and out of its region and window, as a prefix, with a trailing space and in a message, plus fixed queries): `engine.search` and `applyCulture(text: true)` give the same ids, sources, culture ids and scores | 186 cases | 100% |

Measured on macOS 26 (arm64), Swift 6.4, Node 24.5.0, pack 0.1.0.

Regenerate the reference data after a change to `packages/core`, the packs or the queries:

```sh
pnpm exec tsx sdks/swift/scripts/make-function-words.ts    # after a list changes (Swift and Kotlin)
pnpm exec tsx sdks/swift/scripts/make-golden.ts            # writes golden.json and culture-golden.json
pnpm exec tsx sdks/swift/scripts/make-unicode-tables.ts    # after a Node (Unicode) upgrade
```

`make-golden.ts --root <checkout>` takes the core, the packs and the queries from another checkout.

## Platform differences and how the port removes them

| Area | TypeScript reference | Swift | What the port does |
| ---- | -------------------- | ----- | ------------------ |
| `Extended_Pictographic` | Regex property | No public API | Ships a table generated from Node (`UnicodeReference.swift`). |
| Unicode version | Node 24.5: Unicode 16.0 | macOS 26 runtime: Unicode 17.0 | Code points newer than 16.0 become separators, as unassigned code points do in the reference. |
| NFKC, NFD, NFC | ICU | ICU through `StringTransform` | CoreFoundation's own NFD misses the Unicode 16 Todhri decompositions, so it is only the fallback. |
| Lowercase | ICU, with Final_Sigma | `lowercaseMapping` per scalar | Implements Final_Sigma as ICU does. |
| String equality | Exact UTF-16 code units | Canonical equivalence | Tokens and phrases are keyed and sorted by UTF-16 code units. |
| Match quality | `Float32Array` | `Float` | Same float32 rounding. |
| `Math.log` (IDF) | fdlibm; on arm64 with fused multiply-add | Darwin `log` differs in the last bit for ~3% of inputs | `ReferenceMath.log` ports fdlibm with explicit FMA: bit-identical to Node on arm64. |
| Length cap | Can cut a surrogate pair and keep half | A `String` cannot hold half a pair | Drops the whole pair. Only a letter outside the BMP at position 64 is affected. |
| Rounding of scores, `coverage`, `confidence` | `Math.round(x * 1000) / 1000` (ties up) | `(x * 1000).rounded() / 1000` (ties away from zero) | Same result: the values are never negative. |

Remaining differences:

- On an OS older than the reference Unicode version (for example iOS 16, Unicode 14), letters
  added later are unknown to the OS. The reference keeps them; Swift turns them into separators.
- Node on x86-64, Safari and Firefox compute `Math.log` without FMA. Their IDF values can differ
  from arm64 Node in the last bit. With the 0.1.0 packs this changes no ranking: the eval set also
  gives 100% with Darwin's `log`.

## Performance

Release build, Apple silicon, en + tr core and extension packs:

| Measure | Value |
| ------- | ----: |
| Index build (packs already decoded) | 0.27 s |
| Search per keystroke, p50 / p95 / max (6,237 prefixes) | 0.04 / 0.28 / 1.7 ms |
