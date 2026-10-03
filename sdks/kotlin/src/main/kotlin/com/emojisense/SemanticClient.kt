package com.emojisense

/**
 * The HTTP API as a semantic provider (layer `api`): `GET /v1/search?mode=semantic`.
 *
 * Over its plan limit the API still answers from its shared cache. For other queries it answers
 * `overLimit: true`, and search continues on the alias dictionary and shards. Never a hard failure.
 */
public class SemanticClient @JvmOverloads constructor(
    private val configuration: Configuration,
    private val transport: HttpTransport = UrlConnectionTransport(),
    /** Epoch milliseconds; replace it in tests. */
    private val clock: () -> Long = System::currentTimeMillis,
) : SemanticProvider {
    public data class Configuration @JvmOverloads constructor(
        /** Base URL of the Emojisense API, e.g. `https://api.emojisense.com`. */
        val endpoint: String,
        /** Publishable key (`pk_…`), sent as the `key` query parameter (no CORS preflight on the web). */
        val key: String? = null,
        /** Pin a data pack version so results match the client's alias pack. */
        val packVersion: String? = null,
        /** In-memory LRU of recent responses. */
        val cacheSize: Int = 200,
        /**
         * After an over-limit answer, skip the API for this long. Default 0: keep asking, because the
         * edge still answers queries that are in its shared cache. Over-limit misses are remembered.
         */
        val overLimitCooldownMillis: Long = 0,
    )

    private val lock = Any()
    private val cache = LruCache<String, SemanticResponse>(configuration.cacheSize)
    private var pausedUntil = Long.MIN_VALUE

    /**
     * Null for an empty query and while paused after an over-limit answer. Throws
     * [EmojisenseException.HttpStatus] for HTTP errors.
     */
    override suspend fun search(query: String, options: SemanticSearchOptions): SemanticResponse? {
        val url = requestUrl(query, options) ?: return null
        synchronized(lock) { cache[url] }?.let { hit -> return remembered(hit) }

        val response = transport.get(url)
        if (!response.isSuccess) throw EmojisenseException.HttpStatus(response.status, url)
        val body = SemanticResponse.fromJson(response.body.decodeToString()).copy(layer = SemanticLayer.API)
        synchronized(lock) {
            cache[url] = body
            if (body.overLimit) pausedUntil = clock() + configuration.overLimitCooldownMillis
        }
        return if (body.overLimit) null else body
    }

    public suspend fun search(query: String): SemanticResponse? = search(query, SemanticSearchOptions())

    /** An answer of an earlier [search] with the same request, from memory only. Never an over-limit answer. */
    override fun peek(query: String, options: SemanticSearchOptions): SemanticResponse? {
        val url = requestUrl(query, options) ?: return null
        return synchronized(lock) { cache[url] }?.let(::remembered)
    }

    /** From this client's memory: no request went out, so it is not a fresh model answer. */
    private fun remembered(hit: SemanticResponse): SemanticResponse? = if (hit.overLimit) null else hit.copy(cached = true)

    /**
     * The request URL, which is also the key of the memory. Null: nothing to ask (an empty query, or
     * paused after an over-limit answer). The client fuses with its own alias results, so it asks for
     * semantic results only. It sends `region=auto` only for the value "auto": an explicit region code
     * stays on the device.
     */
    private fun requestUrl(query: String, options: SemanticSearchOptions): String? {
        if (Normalizer.normalize(query).isEmpty() || clock() < synchronized(lock) { pausedUntil }) return null
        val parameters = mutableListOf(
            // The text the API embeds, accents and punctuation kept (`normalize` would fold them).
            "q" to Normalizer.embeddingText(query),
            "locale" to (options.locale ?: "en"),
            "limit" to options.limit.toString(),
            "mode" to "semantic",
        )
        if (options.region.equals(AUTO_REGION, ignoreCase = true)) parameters.add("region" to AUTO_REGION)
        configuration.packVersion?.let { parameters.add("pack" to it) }
        configuration.key?.let { parameters.add("key" to it) }
        return "${UrlEncoding.trimTrailingSlashes(configuration.endpoint)}/v1/search?${UrlEncoding.formEncoded(parameters)}"
    }
}

/** A small least-recently-used cache. Reading an entry makes it the most recent. Not thread-safe. */
internal class LruCache<K, V>(private val capacity: Int) {
    private val values = LinkedHashMap<K, V>(16, 0.75f, true)

    operator fun get(key: K): V? = values[key]

    operator fun set(key: K, value: V) {
        values.remove(key)
        values[key] = value
        while (values.size > maxOf(0, capacity)) values.remove(values.keys.first())
    }

    val size: Int get() = values.size
}
