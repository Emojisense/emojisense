package com.emojisense

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/**
 * `<base>/index.json` (or `<base>/<locale>/index.json`): which prefix keys exist (adaptive: hot
 * prefixes get longer keys).
 */
public data class ShardIndex(
    val packVersion: String,
    /** e.g. "embeddinggemma@256". The results are valid only for this model. */
    val model: String,
    /** Sorted shard keys. A query uses the longest key that is a prefix of it. */
    val keys: List<String>,
)

/**
 * Layer 2 (PACK_FORMAT.md §6): precomputed semantic results served as static files. One download
 * per prefix, then every further keystroke with that prefix is answered locally. Unknown queries
 * return null so the next provider (the API) is asked. Network errors also return null.
 *
 * Shards are keyed by the normalized query, which folds accents and punctuation. A query whose
 * embedding text differs from its normalized form ("café!", "Doğum günü") is not the text the
 * shard was embedded from, so it gets no answer here and goes to the API.
 *
 * Each locale has its own shards. English (or no locale) uses `<base>/index.json` and
 * `<base>/<key>.json`. Another locale, for example "tr", uses `<base>/tr/index.json` and
 * `<base>/tr/<key>.json`. These hold the API's answers for that locale. When a locale has no
 * index (HTTP 404 or a network error), the provider returns null for that locale for as long as
 * it exists, and the API answers.
 */
public class ShardProvider @JvmOverloads constructor(
    /** e.g. `https://api.emojisense.com/p/0.1.0`. */
    baseUrl: String,
    private val transport: HttpTransport = UrlConnectionTransport(),
) : SemanticProvider {
    private val base = UrlEncoding.trimTrailingSlashes(baseUrl)
    private val mutex = Mutex()

    /** Keyed by the normalized locale ("en" for null). A null value: the locale has no index. */
    private val indexes = HashMap<String, ShardIndex?>()
    private val shards = HashMap<String, HashMap<String, Map<String, List<SearchResult>>?>>()

    /** Uses the shards of [SemanticSearchOptions.locale]. */
    override suspend fun search(query: String, options: SemanticSearchOptions): SemanticResponse? {
        val normalized = Normalizer.normalize(query)
        if (normalized.isEmpty() || Normalizer.embeddingText(query) != normalized) return null
        val locale = shardLocale(options.locale)
        val loaded = loadIndex(locale) ?: return null
        val key = shardKey(normalized, loaded.keys) ?: return null
        val entry = loadShard(locale, key)?.get(normalized) ?: return null
        return SemanticResponse(
            results = entry.take(maxOf(0, options.limit)),
            packVersion = loaded.packVersion,
            model = loaded.model,
            cached = true,
            layer = SemanticLayer.SHARD,
        )
    }

    public suspend fun search(query: String): SemanticResponse? = search(query, SemanticSearchOptions())

    private suspend fun loadIndex(locale: String): ShardIndex? = mutex.withLock {
        if (!indexes.containsKey(locale)) {
            indexes[locale] = fetchJson("${folder(locale)}index.json")?.let { root ->
                ShardIndex(
                    packVersion = root.optionalString("packVersion") ?: "",
                    model = root.optionalString("model") ?: "",
                    keys = root.optionalArray("keys")?.mapNotNull { it.stringOrNull() } ?: emptyList(),
                )
            }
        }
        indexes[locale]
    }

    private suspend fun loadShard(locale: String, key: String): Map<String, List<SearchResult>>? = mutex.withLock {
        val cache = shards.getOrPut(locale) { HashMap() }
        if (!cache.containsKey(key)) {
            cache[key] = fetchJson("${folder(locale)}${UrlEncoding.uriComponent(key)}.json")?.optionalObject("entries")?.mapNotNull { (query, value) ->
                (value as? JsonArray)?.let { query to it.decodeShardEntry() }
            }?.toMap()
        }
        cache[key]
    }

    private suspend fun fetchJson(path: String): JsonObject? = try {
        val response = transport.get("$base/$path")
        if (response.isSuccess) parseJsonObject(response.body.decodeToString(), path) else null
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Exception) {
        null
    }

    public companion object {
        /** The longest key that is a prefix of the normalized query (compared in UTF-16 code units). */
        @JvmStatic
        public fun shardKey(query: String, keys: List<String>): String? {
            var best: String? = null
            for (key in keys) {
                if (query.startsWith(key) && (best == null || key.length > best.length)) best = key
            }
            return best
        }

        /** The locale in lowercase. Null and "" give "en". */
        internal fun shardLocale(locale: String?): String = locale?.lowercase()?.takeIf { it.isNotEmpty() } ?: "en"

        /** English shards stay at the root, so old clients keep them. Other locales have a folder. */
        private fun folder(locale: String): String = if (locale == "en") "" else "${UrlEncoding.uriComponent(locale)}/"
    }
}
