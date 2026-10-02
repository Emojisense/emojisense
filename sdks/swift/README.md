# Emojisense for Swift

Semantic emoji search for iOS and macOS. This package is a port of `packages/core`. It gives the
same results as the TypeScript engine.

| Part | Type | What it does |
| ---- | ---- | ------------ |
| Tier 0 | `AliasEngine` | Offline alias search over the packs (PACK_FORMAT.md §4). Runs on every keystroke. |
| Normalization | `Normalizer` | PACK_FORMAT.md §3, for queries and labels. |
| Packs | `Pack`, `PackLoader`, `Manifest` | Decodes `pack.<locale>.json` and `pack.<locale>.ext.json`. Verifies `sha256`. |
| Layer 2 | `ShardProvider` | Precomputed semantic results from static shards (§6). |
| Layer 3 | `SemanticClient` | `GET /v1/search?mode=semantic`, with an LRU cache. Over the limit it still gets the edge's cached answers. |
| Fusion | `Fusion` | Pinned reciprocal rank fusion, as in `core/src/fusion.ts`. |
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
let loader = PackLoader(baseURL: URL(string: "https://api.emojisense.com/v1/pack/0.1.0")!)
let manifest = try await loader.loadManifest()
let core = try await loader.loadPacks(locales: ["en", "tr"], manifest: manifest)
var engine = try AliasEngine(core: core)

// 2. Search on every keystroke. This is synchronous and fast (see Performance).
let alias = engine.search("jurassic pa", options: AliasSearchOptions(locale: "en"))
var results = alias.results.map(\.searchResult)

// 3. When the device is idle, load the extension parts and rebuild the index.
let extensions = try await loader.loadPacks(locales: ["en", "tr"], part: .ext, manifest: manifest)
engine = try AliasEngine(core: core, extensions: extensions)

// 4. Semantic layers: static shards first, then the API.
let semantic = ProviderChain([
  ShardProvider(baseURL: URL(string: "https://api.emojisense.com/p/0.1.0")!),
  SemanticClient(
    configuration: .init(
      endpoint: URL(string: "https://api.emojisense.com")!, key: "pk_live_…",
      packVersion: engine.packVersion)),
])
if Fusion.shouldUseSemantic(alias),
  let response = try await semantic.search("jurassic pa", options: .init(locale: "en"))
{
  results = Fusion.fuse(alias: alias, semantic: response.results)
}
```

Notes:

- Debounce the semantic call (for example 200 ms). Cancel the task when the query changes.
- `AliasEngine` is thread-safe. Concurrent searches use one shared scratch buffer, one at a time.
- `SemanticClient` returns `nil` while it is paused after an `overLimit` answer. It throws
  `EmojisenseError.httpStatus` for HTTP errors. `ShardProvider` returns `nil` for network errors,
  so the next provider gets the query.
- Inject an `HTTPTransport` to add headers, logging or a stub for tests.

## Tests and conformance

```sh
pnpm install && pnpm --filter emojisense build && pnpm data:build   # at the repository root
cd sdks/swift && swift build && swift test
```

The conformance tests compare the Swift port with the TypeScript reference engine.
`Tests/EmojisenseTests/Resources/golden.json` holds the reference output. The tests read the packs
from `packages/data/dist/packs/<version>`, or from `EMOJISENSE_PACK_DIR`. The packs are not copied
into the SDK, because they are 2 MB. If the packs are missing, the search tests are skipped. If the
packs differ from the ones in `golden.json` (sha256), the tests fail and tell you to regenerate.

| Check | Cases | Result |
| ----- | ----: | -----: |
| Normalization: fixed cases (spec examples; Latin, Greek, Cyrillic, Arabic, Hebrew, Indic, CJK and Thai; emoji; NFKC; case; plus rule; length cap) | 87 | 100% |
| Normalization: every code point of planes 0–3 and 14, hashed per block of 1,024 | 320 blocks | 100% |
| Search, core + ext packs: same top-5 ids (required ≥ 98%) | 217 queries | 100% |
| Search, core + ext packs: same query, top-10 ids and scores, confidence, matched phrase | 217 queries | 100% |
| Search, core packs only: same top-5 ids / same top-10 ids and scores | 217 queries | 100% / 100% |
| Sentences with function words, en + zh, ru, id, es, fr, pt, ar, hi or bn (core + ext): same top-5 ids / same top-10 ids and scores | 369 queries | 100% / 100% |
| Keystrokes (every prefix of 44 queries and 81 sentences): same top-5 ids and scores | 1,572 | 100% |
| Function-word lists (`FunctionWords.swift`) equal the reference | 11 locales | 100% |

Measured on macOS 26 (arm64), Swift 6.4, Node 24.5.0, pack 0.1.0.

Regenerate the reference data after a change to `packages/core`, the packs or the queries:

```sh
pnpm exec tsx sdks/swift/scripts/make-function-words.ts    # after a function-word list changes
pnpm exec tsx sdks/swift/scripts/make-golden.ts            # writes golden.json
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
