# Emojisense for Kotlin (Android and the JVM)

Semantic emoji search for Android apps and JVM servers. This library is a port of `packages/core`.
It gives the same results as the TypeScript engine and the Swift SDK.

| Part | Type | What it does |
| ---- | ---- | ------------ |
| Tier 0 | `AliasEngine` | Offline alias search over the packs (PACK_FORMAT.md §4). Runs on every keystroke. |
| Normalization | `Normalizer` | PACK_FORMAT.md §3 for queries and labels, and `embeddingText` for the semantic tier. |
| Packs | `Pack`, `PackLoader`, `Manifest` | Decodes core, ext and custom packs. Verifies `sha256` against the manifest. |
| Culture layer | `CultureLayer`, `Culture` | `applyCulture`, regional senses, triggers in a message (`matchCultureInText`), `relevantNow`, the device's region (PACK_FORMAT.md §9). |
| Layer 2 | `ShardProvider` | Precomputed semantic results from static shards (§6): content-named files (`files`) and a base layer (`base`). Answers between keystrokes. |
| Layer 3 | `SemanticClient` | `GET /v1/search?mode=semantic` with an LRU cache. Over the plan limit it still gets the edge's cached answers. |
| Fusion | `Fusion` | Confidence-weighted reciprocal rank fusion with the alias floor and the flag guard. |
| Unsure queries | `Confidence` | `assessConfidence` and `semanticStrength`: is the query unsure. |
| Session | `SearchSession` | Alias results on every keystroke, then semantic results (at once from a loaded shard, else debounced), then culture. Coroutines. |
| Emoji sets | `EmojiSet`, `Hexcode` | `.svg` URLs of the hosted sets. No UI. |

Requirements: Java 8 bytecode; JDK 21 to build. Dependencies: `kotlinx-coroutines-core` and
`kotlinx-serialization-json` (JSON trees only, no reflection). The library uses only plain JVM APIs
(no `java.awt`, no `java.time`), so the same jar runs on Android. It is not yet tested on a device.

## Install

The artifact is not published yet. The coordinates will be:

```kotlin
// build.gradle.kts
dependencies {
    implementation("com.emojisense:emojisense:0.1.0")
}
```

For local development, publish to Maven Local (`./gradlew publishToMavenLocal`) and add
`mavenLocal()` to the repositories of the app, or use a composite build
(`includeBuild("../emojisense/sdks/kotlin")` in `settings.gradle.kts`).

## Quick start: Android

```kotlin
class SearchViewModel : ViewModel() {
    private val api = "https://api.emojisense.com"
    private val loader = PackLoader("$api/v1/pack/0.1.0")
    private var session: SearchSession? = null
    val results = MutableStateFlow<List<SearchResult>>(emptyList())

    init {
        viewModelScope.launch {
            // 1. Core packs first (English is always first), then the extension parts when idle.
            val manifest = loader.loadManifest()
            val core = loader.loadPacks(listOf("en", "tr"), manifest = manifest)
            // 2. The culture file next to the packs (".../v1/culture/0.1.0"). Without it, search works as before.
            val culture = CultureLayer.cultureUrlFor(loader.baseUrl)?.let { url ->
                runCatching { CultureLayer.loadCulture(url, "tr") }.getOrNull()
            }
            var engine = withContext(Dispatchers.Default) { AliasEngine(core, culture = culture) }
            startSession(engine)
            val ext = loader.loadPacks(listOf("en", "tr"), PackPart.EXT, manifest)
            engine = withContext(Dispatchers.Default) { AliasEngine(core, ext, culture = culture) }
            startSession(engine)
        }
    }

    private fun startSession(engine: AliasEngine) {
        session?.cancel()
        session = SearchSession(
            engine = engine,
            scope = viewModelScope,
            semantic = ProviderChain(
                ShardProvider("https://cdn.emojisense.com/p/0.1.0"),
                SemanticClient(SemanticClient.Configuration(api, key = "pk_live_…", packVersion = engine.packVersion)),
            ),
            locale = "tr",
            // No region: the device's region. "" for none, "auto" for the region the API finds.
            onChange = { state -> results.value = state.results },
        )
    }

    /** Call on every keystroke. */
    fun onQueryChanged(query: String) = session?.update(query)
}
```

Notes:

- Build the index off the main thread (`Dispatchers.Default`). en + tr core and extension parts take
  about 0.4 s of CPU time on a laptop JVM. Searching is fast enough for the main thread.
- `AliasEngine` is thread-safe. Concurrent searches share one scratch buffer and run one at a time.
- `UrlConnectionTransport` (the default) runs on `Dispatchers.IO`. Pass your own `HttpTransport`
  to use OkHttp or Ktor, to add headers, or to stub the network in tests.
- `SemanticClient` returns `null` for an over-limit answer and throws
  `EmojisenseException.HttpStatus` for HTTP errors. `ShardProvider` returns `null` for network
  errors and for queries whose embedding text differs from the normalized query, so the next
  provider gets the query.
- `ShardProvider` reads the shards of `SemanticSearchOptions.locale`. English (or no locale) uses
  `<base>/index.json`. Another locale uses its folder, for example `<base>/tr/index.json`. An index
  names the file of each key (`files`, relative to the index) and can name a base layer (`base`).
  The provider asks the live layer first, then the base layer. If a locale has no shards (404), the
  provider stops asking for that locale and the API answers. After a network error, it asks again
  after `retryMillis` (default 10 s).
- Shards answer between keystrokes. `SearchSession` calls `prefetch` when it is created (the shard
  indexes) and on each keystroke that needs semantic results (the query's shard). On the next
  keystroke, `peek` reads a loaded shard from memory: the session shows the fused results at once,
  with no debounce and no request (`semanticMillis` is 0). `SemanticClient.peek` reads the answers
  of earlier requests in the same way. The downloads run in the `scope` of `ShardProvider` (default:
  `Dispatchers.Default`).
- The CDN (`https://cdn.emojisense.com/p/<packVersion>`) serves the shards with no Worker. The API
  host (`https://api.emojisense.com/p/<packVersion>`) serves the same files for older clients.
- The culture layer is on by default. Load the culture file of the pack version next to the packs
  (`CultureLayer.cultureUrlFor(packUrl)`: `.../v1/pack/0.1.0` → `.../v1/culture/0.1.0`) and give it to
  `AliasEngine`. `AliasEngine.search` and `SearchSession` then apply it. Each pack locale has a
  culture file. If the load fails, the layer stays off and search works as before. Pass
  `culture = null` to `SearchSession` (or `culture = false` in `AliasSearchOptions`) for the
  canonical ranking only.
- The region of the culture layer (`region` in `SearchSession` and `AliasSearchOptions`):

  | Value | Region |
  | ----- | ------ |
  | `null` (default) or `"device"` | The device's region: the country of `Locale.getDefault()` ("en-JP" → JP), else the region of the device's time zone in the culture file's `zones` ("ja" + Asia/Tokyo → JP) |
  | `""` | None: only the entries for every region |
  | `"BR"` | That region |
  | `"auto"` (`SearchSession` only) | The region that the API finds (see below) |

  `CultureLayer.resolveRegion(region, culture)` applies this rule. The functions of `CultureLayer`
  (`applyCulture`, `matchCulture`) take the region as given: null means none. The SDK reads the
  device's region on the device and never sends it. On a server, pass the user's region or `""`:
  the device's region there is the server's.
- `region = "auto"` in `SearchSession` lets the API find the region. The session sends
  `region=auto` with its semantic requests and uses the region of the first API answer that has
  one (`SemanticResponse.region`). Until then, only the culture entries for every region apply. An
  explicit region code (for example `"BR"`) stays on the device: the SDK never sends it.
- `SemanticClient` sends `culture=0`. The session applies the culture layer on the device, after
  fusion, so the API must not apply it too.
- For reaction suggestions on a message, use `CultureLayer.applyCulture` with
  `ApplyCultureOptions(text = true)`. It finds triggers as whole words anywhere in the message
  ("thanks so much!" holds "thanks"), and anywhere at all for scripts without spaces (Han, kana,
  Thai). A message gets no regional lead.
- Draw custom emoji (`result.source == ResultSource.CUSTOM`) from `result.imageUrl`.
- `SessionState.unsure` is true when no tier understood the query: the dictionary does not cover
  it (`AliasSearchOutput.coverage` below 0.85) and the semantic list is flat or low. Show the
  results as guesses.

## Quick start: server (JVM)

```kotlin
fun main() = runBlocking {
    val loader = PackLoader("https://api.emojisense.com/v1/pack/0.1.0")
    val core = loader.loadPacks(listOf("en", "es"))
    val ext = loader.loadPacks(listOf("en", "es"), PackPart.EXT)
    val engine = AliasEngine(core, ext)

    val alias = engine.canonicalSearch("feliz cumpleaños", AliasSearchOptions(locale = "es"))
    println(alias.results.map { "${it.emoji} ${it.score} ${it.match}" })

    if (Fusion.shouldUseSemantic(alias)) {
        val client = SemanticClient(SemanticClient.Configuration("https://api.emojisense.com", key = "pk_live_…"))
        client.search("feliz cumpleaños", SemanticSearchOptions(locale = "es"))?.let { response ->
            println(Fusion.fuse(alias, response.results).map { it.emoji })
        }
    }
}
```

Packs are immutable files. A server can read them from disk with `Pack.fromJson(bytes)`.

## Tests and conformance

```sh
pnpm install && pnpm data:build      # at the repository root: builds the packs (optional, see below)
cd sdks/kotlin && ./gradlew test      # JDK 17 or newer to run Gradle; the build uses a JDK 21 toolchain
```

`./gradlew test` needs no pnpm. Gradle downloads a JDK 21 when the machine has none. With JDK 21
from Homebrew: `JAVA_HOME=$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home ./gradlew test`.

The conformance tests compare the Kotlin port with the TypeScript reference engine. They read the
golden files of the Swift SDK (`sdks/swift/Tests/EmojisenseTests/Resources/golden.json`, or
`EMOJISENSE_GOLDEN`, and `culture-golden.json` in the same directory) and the packs in
`packages/data/dist/packs/<version>` (or `EMOJISENSE_PACK_DIR`). Without built packs the search
tests are skipped. If the packs differ from the ones in `golden.json` (sha256), the tests fail and
tell you to regenerate it. CI regenerates the golden files for each commit and then runs these tests.

| Check | Cases | Result |
| ----- | ----: | -----: |
| Normalization: fixed cases (spec examples, many scripts, emoji, NFKC, case, plus rule, length cap) | 87 | 100% |
| Normalization: every code point of planes 0–3 and 14, hashed per block of 1,024 | 320 blocks | 100% |
| Embedding text: fixed cases | 87 | 100% |
| NFC, NFD, NFKC, NFKD and lowercase of random sequences (Node 24 fixture) | 800 × 5 | 100% |
| Search, core + ext packs: same top-5 ids | 217 queries | 100% |
| Search, core + ext packs: same query, top-10 ids and scores, confidence, matched phrase | 217 queries | 100% |
| Search, core packs only: same top-5 ids / same top-10 ids and scores | 217 queries | 100% / 100% |
| Sentences with function words, en + zh, ru, id, es, fr, pt, ar, hi or bn (core + ext): same top-5 ids / same top-10 ids and scores | 369 queries | 100% / 100% |
| Entities (names, titles, brands, memes, holidays), en or en + es, fr, ru, zh, hi, ar, bn, pt, id or tr (core + ext), every other one: same top-5 ids / same top-10 ids and scores | 132 queries | 100% / 100% |
| Guard queries with all 22 packs (prefix completions into other locales' words, short typos, unknown names): same top-5 ids / same top-10 ids and scores | 28 queries | 100% / 100% |
| Coverage (`AliasSearchOutput.coverage`) of every search case above | 963 queries | 100% |
| Keystrokes (every prefix of 44 queries, 63 sentences and 10 guard queries): same top-5 ids and scores | 1,452 | 100% |
| Fusion (`Fusion.fuse`) on recorded lists, with and without the reranker (55 queries and 2 number-slang queries): same top-10 ids | 57 × 2 | 100% |
| Unsure verdict (`Confidence.assessConfidence`), generated inputs: same confidence and `unsure` | 44 cases | 100% |
| Semantic strength (`Confidence.semanticStrength`): within 1e-12 (all bit-identical). The other 5 cases record no semantic list | 39 cases | 100% |
| Function-word lists (`FunctionWords.kt`, generated by `sdks/swift/scripts/make-function-words.ts`) equal the reference | 11 locales | 100% |
| Culture layer on the English culture file (`culture-golden.json`), en core + ext: searches and messages (`text`) in and out of each entry's regions and windows, prefixes: same ids, sources, culture ids and scores | 186 cases | 100% |

Measured with JDK 21 (macOS, arm64), Node 24.5.0, pack 0.1.0. The unit tests port the TypeScript and
Swift tests: engine, partial matches, custom packs, fusion, confidence, culture, semantic client, shards,
session (with the unsure verdict), packs.

## Unicode data

The normalizer does not use `java.text.Normalizer` or `java.lang.Character`. Their Unicode version
depends on the JVM or Android release (JDK 21: Unicode 15.0; Android: the release's ICU), but the
reference is Node 24 (Unicode 16.0). `UnicodeTables.kt` holds the data of the reference runtime:
the character classes of the normalization steps, Cased and Case_Ignorable, the lowercase mappings,
the full decompositions, the order of the canonical combining classes and the primary composites.
So results are the same on every JVM and Android release.

Regenerate the tables and the fixture after a Node (Unicode) upgrade of the reference:

```sh
pnpm exec tsx sdks/kotlin/scripts/make-unicode-tables.ts     # with Node 24
```

The script rebuilds every normalization form from the tables and compares it with Node for every
code point and 60,000 random sequences before it writes anything.

| Area | TypeScript reference | Kotlin |
| ---- | -------------------- | ------ |
| Unicode data | ICU of Node 24 (Unicode 16.0) | Generated tables (Unicode 16.0) |
| Lowercase | ICU, with Final_Sigma | Tables plus Final_Sigma as ICU applies it |
| Strings and lengths | UTF-16 code units | UTF-16 code units (`String`); the length cap can keep half a surrogate pair, as in JavaScript |
| Sort order | UTF-16 code units | `String.compareTo` (UTF-16 code units) |
| Match quality | `Float32Array` | `FloatArray` |
| `Math.log` (IDF) | fdlibm; on arm64 with fused multiply-add | fdlibm port with explicit `Math.fma` (exact `BigDecimal` fallback on runtimes without it): the bits of arm64 Node |

Remaining difference: Node on x86-64 computes `Math.log` without fused multiply-add, so its IDF can
differ in the last bit. With the 0.1.0 packs this changes no ranking (see the Swift README).

## Publishing (not done yet)

`./gradlew publishToMavenLocal` builds the jar, the sources jar and the POM
(`com.emojisense:emojisense:0.1.0`, MIT). Maven Central also needs a verified namespace for
`com.emojisense` on the Sonatype Central Portal, a GPG signing key, a javadoc jar (for example with
Dokka), the `scm` block of the POM (the public repository URL), and the owner's credentials in the
release environment.
