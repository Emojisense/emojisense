package com.emojisense

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import java.net.URI
import java.net.URISyntaxException

/**
 * `<base>/index.json` (or `<base>/<locale>/index.json`): which prefix keys exist (adaptive: hot
 * prefixes get longer keys).
 */
public data class ShardIndex @JvmOverloads constructor(
    val packVersion: String,
    /** e.g. "embeddinggemma@256". The results are valid only for this model. */
    val model: String,
    /** Sorted shard keys. A query uses the longest key that is a prefix of it. */
    val keys: List<String>,
    /**
     * Key → URL of its file, relative to this index. The files are named by their content, so they
     * never change. Empty (older builds): `<key>.json` next to the index.
     */
    val files: Map<String, String> = emptyMap(),
    /**
     * URL of the base layer's index for the same locale, relative to this index: synthetic queries
     * built with the pack, asked after this layer (PACK_FORMAT.md §6).
     */
    val base: String? = null,
)

/**
 * Layer 2 (PACK_FORMAT.md §6): precomputed semantic results served as static files. One download
 * per prefix, then every further keystroke with that prefix is answered locally ([peek], no
 * debounce). Unknown queries return null so the next provider (the API) is asked. Network errors
 * also return null.
 *
 * Each locale has a live layer (`index.json`, real queries, rebuilt nightly) and, when its index
 * names one, a base layer (synthetic queries, built with the pack). Both hold the API's answers for
 * that locale, so the order only decides which file is read first. English (or no locale) uses
 * `<base>/index.json`; another locale, for example "tr", uses `<base>/tr/index.json`. An index names
 * the file of each key (`files`); without `files` (older builds), a key's file is `<key>.json` next
 * to the index.
 *
 * Shards are keyed by the normalized query, which folds accents and punctuation. A query whose
 * embedding text differs from its normalized form ("café!", "Doğum günü") is not the text the
 * shard was embedded from, so it gets no answer here and goes to the API.
 *
 * A missing file (HTTP 404 or another HTTP error) stays remembered: a locale without shards is asked
 * once, and the API answers. A network error is forgotten after [retryMillis], so a later keystroke
 * asks again, but an unreachable host is not asked on every keystroke.
 */
public class ShardProvider @JvmOverloads constructor(
    /** e.g. `https://cdn.emojisense.com/p/0.1.0`. */
    baseUrl: String,
    private val transport: HttpTransport = UrlConnectionTransport(),
    /**
     * Runs the downloads, so a file keeps loading when the search that asked for it is cancelled
     * (the next keystroke can [peek] at it). The default runs on [Dispatchers.Default].
     */
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    /** After a network error, ask for that file again after this long. */
    private val retryMillis: Long = 10_000,
    /** Epoch milliseconds; replace it in tests. */
    private val clock: () -> Long = System::currentTimeMillis,
) : SemanticProvider {
    private val base = UrlEncoding.trimTrailingSlashes(baseUrl)
    private val lock = Any()

    /** Keyed by URL. A null value: not a shard index. */
    private val indexes = HashMap<String, Loading<ShardIndex>>()

    /** Keyed by URL: normalized query → results. */
    private val shards = HashMap<String, Loading<Map<String, List<SearchResult>>>>()

    /** A file being loaded. [value] is set once it arrived, so [peek] can read it without waiting. */
    private class Loading<T : Any> {
        val done = CompletableDeferred<T?>()

        @Volatile
        var value: T? = null

        /** Clock time after which the file is asked for again. Never for a file that arrived or an HTTP error. */
        @Volatile
        var retryAt: Long = Long.MAX_VALUE
    }

    /** An index and its URL, which its `files` and `base` are relative to. */
    private class Layer(val url: String, val index: ShardIndex)

    /** Uses the shards of [SemanticSearchOptions.locale]: the live layer, then the base layer. */
    override suspend fun search(query: String, options: SemanticSearchOptions): SemanticResponse? {
        val text = shardText(query) ?: return null
        val layers = loadLayers(options.locale)
        // Both shards load at once: a miss in the live layer does not wait for a second round trip.
        val files = layers.map { layer -> fileOf(layer, text)?.let { load(it, shards, ::decodeShard) } }
        for ((layer, file) in layers.zip(files)) {
            file?.done?.await()?.get(text)?.let { return answer(layer.index, it, options.limit) }
        }
        return null
    }

    public suspend fun search(query: String): SemanticResponse? = search(query, SemanticSearchOptions())

    /** The answer of a shard that is already loaded. No I/O. */
    override fun peek(query: String, options: SemanticSearchOptions): SemanticResponse? {
        val text = shardText(query) ?: return null
        for (layer in loadedLayers(options.locale)) {
            val url = fileOf(layer, text) ?: continue
            val entry = synchronized(lock) { shards[url] }?.value?.get(text) ?: continue
            return answer(layer.index, entry, options.limit)
        }
        return null
    }

    /** Loads the indexes of [locale] and, for a query, its shards, in [scope]. */
    override fun prefetch(query: String, locale: String?) {
        val text = if (query.isEmpty()) null else shardText(query)
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            val layers = loadLayers(locale)
            if (text == null) return@launch
            for (layer in layers) fileOf(layer, text)?.let { load(it, shards, ::decodeShard) }
        }
    }

    /** Both indexes of the locale, loaded if needed. Empty when the locale has no shard index. */
    private suspend fun loadLayers(locale: String?): List<Layer> {
        val url = liveUrl(locale)
        val live = load(url, indexes, ::decodeIndex).done.await() ?: return emptyList()
        val baseUrl = live.base?.let { resolve(url, it) }
        val base = baseUrl?.let { load(it, indexes, ::decodeIndex).done.await() }
        return layersOf(url, live, baseUrl, base)
    }

    /** The indexes already in memory, for [peek]. */
    private fun loadedLayers(locale: String?): List<Layer> {
        val url = liveUrl(locale)
        val live = synchronized(lock) { indexes[url] }?.value ?: return emptyList()
        val baseUrl = live.base?.let { resolve(url, it) }
        val base = baseUrl?.let { synchronized(lock) { indexes[it] }?.value }
        return layersOf(url, live, baseUrl, base)
    }

    private fun layersOf(url: String, live: ShardIndex, baseUrl: String?, base: ShardIndex?): List<Layer> =
        if (baseUrl != null && base != null) listOf(Layer(url, live), Layer(baseUrl, base)) else listOf(Layer(url, live))

    private fun liveUrl(locale: String?): String = "$base/${folder(shardLocale(locale))}index.json"

    /** URL of the query's shard in a layer. Null when no key matches. */
    private fun fileOf(layer: Layer, text: String): String? {
        val key = shardKey(text, layer.index.keys) ?: return null
        return resolve(layer.url, layer.index.files[key] ?: "${UrlEncoding.uriComponent(key)}.json")
    }

    /**
     * Returns the load of [url], and starts it when there is none. It runs in [scope], so the caller
     * can stop to wait without stopping the download.
     */
    private fun <T : Any> load(url: String, memo: HashMap<String, Loading<T>>, decode: (JsonObject) -> T?): Loading<T> {
        val loading = synchronized(lock) {
            memo[url]?.takeIf { clock() < it.retryAt }?.let { return it }
            Loading<T>().also { memo[url] = it }
        }
        // Undispatched: the request goes out before this returns, in the order the files were asked for.
        val job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            val value = try {
                val response = transport.get(url)
                if (response.isSuccess) (EmojisenseJson.parseToJsonElement(response.body.decodeToString()) as? JsonObject)?.let(decode) else null
            } catch (error: Exception) {
                // A transport's own timeout is a CancellationException too: only this load's cancellation stops it.
                ensureActive()
                loading.retryAt = clock() + retryMillis
                null
            }
            loading.value = value
            loading.done.complete(value)
        }
        // A load cancelled with its scope is asked for again by the next caller.
        job.invokeOnCompletion { cause ->
            if (cause != null && !loading.done.isCompleted) {
                loading.retryAt = Long.MIN_VALUE
                loading.done.complete(null)
            }
        }
        return loading
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

        /** The language subtag in lowercase, like the API's `locale` ("pt-BR" gives "pt"). Null and "" give "en". */
        internal fun shardLocale(locale: String?): String =
            locale?.lowercase()?.split('-', '_')?.first()?.takeIf { it.isNotEmpty() } ?: "en"

        /** English shards stay at the root, so old clients keep them. Other locales have a folder. */
        private fun folder(locale: String): String = if (locale == "en") "" else "${UrlEncoding.uriComponent(locale)}/"

        /** [path] relative to [from], like `new URL(path, from)`. Null for a path that is not a valid URL. */
        internal fun resolve(from: String, path: String): String? = try {
            URI(from).resolve(path).toString()
        } catch (invalidBase: URISyntaxException) {
            null
        } catch (invalidPath: IllegalArgumentException) {
            null
        }

        /** The text that shards hold for this query, or null when shards cannot answer it. */
        private fun shardText(query: String): String? {
            val normalized = Normalizer.normalize(query)
            return normalized.takeIf { it.isNotEmpty() && Normalizer.embeddingText(query) == it }
        }

        /** Null for a file that is not a shard index (`keys` is not an array), e.g. an error page served as 200. */
        private fun decodeIndex(root: JsonObject): ShardIndex? {
            val keys = root["keys"] as? JsonArray ?: return null
            return ShardIndex(
                packVersion = root.optionalString("packVersion") ?: "",
                model = root.optionalString("model") ?: "",
                keys = keys.mapNotNull { it.stringOrNull() },
                files = root.optionalObject("files")?.mapNotNull { (key, file) -> file.stringOrNull()?.let { key to it } }?.toMap() ?: emptyMap(),
                base = root.optionalString("base"),
            )
        }

        private fun decodeShard(root: JsonObject): Map<String, List<SearchResult>>? =
            root.optionalObject("entries")?.mapNotNull { (query, value) -> (value as? JsonArray)?.let { query to it.decodeShardEntry() } }?.toMap()

        private fun answer(index: ShardIndex, entry: List<SearchResult>, limit: Int) = SemanticResponse(
            results = entry.take(maxOf(0, limit)),
            packVersion = index.packVersion,
            model = index.model,
            cached = true,
            layer = SemanticLayer.SHARD,
        )
    }
}
