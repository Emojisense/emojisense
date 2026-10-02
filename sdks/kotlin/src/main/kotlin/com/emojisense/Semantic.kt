package com.emojisense

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/** Where a semantic answer came from (docs/ARCHITECTURE.md, layers). */
public enum class SemanticLayer(public val key: String) {
    DEVICE("device"),
    SHARD("shard"),
    API("api"),
}

/** A semantic answer: `GET /v1/search?mode=semantic`, a shard, or (later) an on-device model. */
public data class SemanticResponse(
    val results: List<SearchResult>,
    val packVersion: String,
    val model: String? = null,
    val cached: Boolean = false,
    /** Server: Workers AI was unavailable, results are alias-only. */
    val degraded: Boolean = false,
    /** Server: the key is over its monthly limit; no semantic results until the next period. */
    val overLimit: Boolean = false,
    /** Set by the provider that answered. */
    val layer: SemanticLayer? = null,
    /**
     * API, after a request with `region=auto`: the region that the API found for the request, e.g.
     * "DE". Null when it found none, and always null from shards.
     */
    val region: String? = null,
    /** Server: 0–1, how well its tiers understood the query. */
    val confidence: Double? = null,
    /** Server: no tier understood the query ([Confidence.assessConfidence] with its own dictionary). */
    val unsure: Boolean? = null,
) {
    public companion object {
        /** Decodes an API answer (`/v1/search`). Unknown keys are ignored. */
        @JvmStatic
        public fun fromJson(json: String): SemanticResponse {
            val root = parseJsonObject(json, "search response")
            return SemanticResponse(
                results = root.array("results").map(::decodeResult),
                packVersion = root.optionalString("packVersion") ?: "",
                model = root.optionalString("model"),
                cached = root.optionalBoolean("cached") == true,
                degraded = root.optionalBoolean("degraded") == true,
                overLimit = root.optionalBoolean("overLimit") == true,
                layer = SemanticLayer.entries.firstOrNull { it.key == root.optionalString("layer") },
                region = root.optionalString("region"),
                confidence = root.optionalDouble("confidence"),
                unsure = root.optionalBoolean("unsure"),
            )
        }

        private fun decodeResult(element: JsonElement): SearchResult {
            val result = element as? JsonObject ?: throw EmojisenseException.InvalidData("a search result must be an object")
            return EmojiResult(
                emoji = result.string("emoji"),
                id = result.string("id"),
                score = result.optionalDouble("score") ?: 0.0,
                source = ResultSource.fromKey(result.optionalString("source") ?: "") ?: ResultSource.SEMANTIC,
                imageUrl = result.optionalString("imageUrl"),
                shortcode = result.optionalString("shortcode"),
            )
        }
    }
}

/** Options of [SemanticProvider.search]. */
public data class SemanticSearchOptions @JvmOverloads constructor(
    /** Null: the provider's default ("en" for the API). [ShardProvider] reads the shards of this locale. */
    val locale: String? = null,
    val limit: Int = 24,
    /**
     * "auto": the API finds the region of the request and returns it in [SemanticResponse.region].
     * Only the value "auto" is sent to the API. An explicit region code (e.g. "BR") stays on the device.
     */
    val region: String? = null,
)

/** The region value that asks the API to find the region of the request. */
internal const val AUTO_REGION = "auto"

/**
 * A source of semantic results: precomputed shards, the HTTP API, or (later) an on-device model.
 * Null means "no answer here": the next provider is tried, and with none left the caller keeps
 * its alias results. Cancel the calling coroutine to abandon a search.
 */
public fun interface SemanticProvider {
    public suspend fun search(query: String, options: SemanticSearchOptions): SemanticResponse?
}

/** [SemanticProvider.search] with the default options. */
public suspend fun SemanticProvider.search(query: String): SemanticResponse? = search(query, SemanticSearchOptions())

/** Tries providers in order (cheapest first, e.g. shards then API); the first answer wins. */
public class ProviderChain(public val providers: List<SemanticProvider>) : SemanticProvider {
    public constructor(vararg providers: SemanticProvider) : this(providers.toList())

    override suspend fun search(query: String, options: SemanticSearchOptions): SemanticResponse? {
        for (provider in providers) {
            currentCoroutineContext().ensureActive()
            provider.search(query, options)?.let { return it }
        }
        return null
    }
}

internal fun JsonArray.decodeShardEntry(): List<SearchResult> = mapNotNull { element ->
    val item = element as? JsonArray ?: return@mapNotNull null
    val emoji = item.getOrNull(0).stringOrNull() ?: return@mapNotNull null
    val id = item.getOrNull(1).stringOrNull() ?: return@mapNotNull null
    val score = (item.getOrNull(2) as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null
    EmojiResult(emoji, id, score, ResultSource.SEMANTIC)
}
