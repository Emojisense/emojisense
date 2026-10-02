package com.emojisense

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

public enum class SessionStatus {
    /** The query is empty after normalization. */
    IDLE,

    /** Alias results only: the semantic tier was not needed, or it had no answer. */
    ALIAS,

    /** Alias results now; a semantic request is waiting or running. */
    LOADING,

    /** Alias and semantic results, fused. */
    FUSED,

    /** The semantic request failed; [SessionState.results] holds the alias results. */
    ERROR,
}

public data class SessionState(
    val query: String,
    /** What to show: the ranking, plus culture results after its top result when a culture file is set. */
    val results: List<SearchResult>,
    /** The canonical alias output (no culture results). */
    val alias: AliasSearchOutput<AliasResult>,
    val status: SessionStatus,
    /** Time spent in the alias engine for this query, in milliseconds. */
    val aliasMillis: Double,
    /** Round-trip time of the semantic request, when one finished. */
    val semanticMillis: Double? = null,
    val semanticCached: Boolean? = null,
    /** Which layer gave the semantic results. */
    val layer: SemanticLayer? = null,
    val error: Throwable? = null,
    /**
     * No tier understood the query ([Confidence.assessConfidence]): the dictionary does not cover it
     * and the semantic list is flat or low. While [SessionStatus.LOADING], the dictionary's verdict
     * alone. Show the results as guesses.
     */
    val unsure: Boolean = false,
    /** 0–1: how well the best tier understood the query. */
    val confidence: Double = 0.0,
)

/**
 * Search controller, like `createSearchSession` in packages/core: alias results on every
 * keystroke, then debounced, cancellable semantic results fused in. A newer query cancels the
 * older request, so stale answers never arrive. [onChange] runs synchronously for the alias
 * results and in [scope] (e.g. `lifecycleScope` on Android) for the semantic ones.
 *
 * The culture layer is applied last, after fusion, so the canonical top result stays first.
 */
public class SearchSession @JvmOverloads constructor(
    private val engine: AliasEngine,
    private val scope: CoroutineScope,
    /** Null for alias-only (fully offline) search. Use [ProviderChain] (shards, then API) for layers. */
    private val semantic: SemanticProvider? = null,
    private val locale: String? = null,
    private val limit: Int = 24,
    /** Delay before a semantic request, after the last keystroke. */
    private val debounceMillis: Long = 200,
    /** Culture file of the culture layer. Default: the engine's. Null turns the layer off. */
    private val culture: Culture? = engine.culture,
    /**
     * ISO 3166-1 alpha-2 region for regional culture entries, e.g. "BR". This code stays on the
     * device. "auto": the session sends `region=auto` to the API and uses the region of the first
     * answer that has one. Until then, only the entries for every region apply.
     */
    private val region: String? = null,
    private val shouldUseSemantic: (AliasSearchOutput<SearchResult>) -> Boolean = Fusion::shouldUseSemantic,
    /** Epoch milliseconds. Culture windows follow the local day of each update, also in a long-lived session. */
    private val clock: () -> Long = System::currentTimeMillis,
    private val onChange: (SessionState) -> Unit,
) {
    private var job: Job? = null
    private val autoRegion = region.equals(AUTO_REGION, ignoreCase = true)

    /** With region "auto": the region of the first API answer that has one. */
    @Volatile
    private var learnedRegion: String? = null

    /** Call on every keystroke. The alias results are delivered before it returns. */
    public fun update(query: String) {
        cancel()
        val started = System.nanoTime()
        val alias = engine.canonicalSearch(query, AliasSearchOptions(limit = limit, locale = locale))
        val aliasMillis = (System.nanoTime() - started) / 1_000_000.0
        val wantsSemantic = semantic != null && shouldUseSemantic(alias)
        val status = when {
            alias.tokens.isEmpty() -> SessionStatus.IDLE
            wantsSemantic -> SessionStatus.LOADING
            else -> SessionStatus.ALIAS
        }
        val aliasOnly = Confidence.assessConfidence(alias, null)
        fun aliasState(status: SessionStatus, error: Throwable? = null) = SessionState(
            query = query,
            results = present(query, alias.results),
            alias = alias,
            status = status,
            aliasMillis = aliasMillis,
            error = error,
            unsure = aliasOnly.unsure,
            confidence = aliasOnly.confidence,
        )
        onChange(aliasState(status))
        if (!wantsSemantic) return

        job = scope.launch {
            delay(debounceMillis)
            val requested = System.nanoTime()
            val response = try {
                semantic.search(query, SemanticSearchOptions(locale = locale, limit = limit, region = if (autoRegion) AUTO_REGION else null))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                onChange(aliasState(SessionStatus.ERROR, error))
                return@launch
            }
            if (response == null) {
                // No layer had an answer (or the key is over its limit): the alias results stand.
                onChange(aliasState(SessionStatus.ALIAS))
                return@launch
            }
            if (autoRegion && learnedRegion == null) learnedRegion = response.region
            val verdict = Confidence.assessConfidence(alias, response.results)
            onChange(
                SessionState(
                    query = query,
                    results = present(query, Fusion.fuse(alias, response.results, limit, ranking = Fusion.Ranking(engine::popularity))),
                    alias = alias,
                    status = SessionStatus.FUSED,
                    aliasMillis = aliasMillis,
                    semanticMillis = (System.nanoTime() - requested) / 1_000_000.0,
                    semanticCached = response.cached,
                    layer = response.layer,
                    unsure = verdict.unsure,
                    confidence = verdict.confidence,
                ),
            )
        }
    }

    /** Cancels the pending semantic request. Call when the search UI goes away. */
    public fun cancel() {
        job?.cancel()
        job = null
    }

    private fun present(query: String, results: List<SearchResult>): List<SearchResult> {
        val culture = culture ?: return results
        return CultureLayer.applyCulture(
            results,
            culture,
            query,
            ApplyCultureOptions(region = if (autoRegion) learnedRegion else region, now = clock(), limit = limit, locale = locale, engine = engine),
        )
    }
}
