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
    /** ISO 3166-1 alpha-2 region for regional culture entries, e.g. "BR". */
    private val region: String? = null,
    private val shouldUseSemantic: (AliasSearchOutput<SearchResult>) -> Boolean = Fusion::shouldUseSemantic,
    private val onChange: (SessionState) -> Unit,
) {
    private var job: Job? = null

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
        onChange(SessionState(query, present(query, alias.results), alias, status, aliasMillis))
        if (!wantsSemantic) return

        job = scope.launch {
            delay(debounceMillis)
            val requested = System.nanoTime()
            val response = try {
                semantic.search(query, SemanticSearchOptions(locale = locale, limit = limit))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                onChange(SessionState(query, present(query, alias.results), alias, SessionStatus.ERROR, aliasMillis, error = error))
                return@launch
            }
            if (response == null) {
                // No layer had an answer (or the key is over its limit): the alias results stand.
                onChange(SessionState(query, present(query, alias.results), alias, SessionStatus.ALIAS, aliasMillis))
                return@launch
            }
            onChange(
                SessionState(
                    query = query,
                    results = present(query, Fusion.fuse(alias, response.results, limit)),
                    alias = alias,
                    status = SessionStatus.FUSED,
                    aliasMillis = aliasMillis,
                    semanticMillis = (System.nanoTime() - requested) / 1_000_000.0,
                    semanticCached = response.cached,
                    layer = response.layer,
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
            ApplyCultureOptions(region = region, limit = limit, locale = locale, engine = engine),
        )
    }
}
