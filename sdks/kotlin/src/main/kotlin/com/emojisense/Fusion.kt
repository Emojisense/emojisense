package com.emojisense

/** Options of [Fusion.fuseResults]. */
public data class FuseOptions @JvmOverloads constructor(
    /** Reciprocal-rank-fusion constant. */
    val k: Double = 60.0,
    val limit: Int = 24,
    /** Alias results at or above this score keep their place on top, so results do not jump. */
    val pinScore: Double = 0.9,
    /**
     * Alias results at or above this score (below [pinScore]) come before every other result,
     * ordered among themselves by fused score: semantic evidence breaks their near-ties, but it
     * cannot lift a clearly weaker alias hit or a semantic-only hit above them. Null = off.
     */
    val aliasFloor: Double? = null,
    val aliasWeight: Double = 1.0,
    val semanticWeight: Double = 1.0,
)

/** Cosine range of the semantic model over which its top match goes from "rarely right" to "usually right". */
public data class SemanticCalibration(val floor: Double, val ceiling: Double) {
    public companion object {
        /**
         * bge-m3 @1024, the production model: the same values as `DEFAULT_SEMANTIC_CALIBRATION` in
         * packages/core/src/fusion.ts. Another model or dims needs its own (`pnpm eval` measures them).
         */
        @JvmField
        public val DEFAULT: SemanticCalibration = SemanticCalibration(floor = 0.44, ceiling = 0.58)
    }
}

/** Merges Tier 0 (alias) and Tier 1 (semantic) rankings, like `packages/core/src/fusion.ts`. */
public object Fusion {
    /**
     * Weighted reciprocal rank fusion. Confident alias hits stay pinned in their original order, so
     * the list does not flicker when semantic results arrive. Each result keeps the object (and
     * `source`) of the list where it appeared first.
     */
    @JvmStatic
    @JvmOverloads
    public fun fuseResults(
        alias: List<SearchResult>,
        semantic: List<SearchResult>,
        options: FuseOptions = FuseOptions(),
    ): List<SearchResult> {
        val pinned = alias.filter { it.score >= options.pinScore }
        val pinnedIds = pinned.mapTo(HashSet()) { it.id }
        val fused = LinkedHashMap<String, Pair<SearchResult, DoubleArray>>()
        fun accumulate(list: List<SearchResult>, weight: Double) {
            list.forEachIndexed { rank, result ->
                if (result.id in pinnedIds) return@forEachIndexed
                val contribution = weight / (options.k + rank + 1)
                val current = fused[result.id]
                if (current != null) current.second[0] += contribution else fused[result.id] = result to doubleArrayOf(contribution)
            }
        }
        accumulate(alias, options.aliasWeight)
        accumulate(semantic, options.semanticWeight)

        // Stable: equal scores keep first-seen order, as JavaScript's sort does.
        val rest = fused.values.sortedWith { a, b -> b.second[0].compareTo(a.second[0]) }.map { it.first }
        val limit = maxOf(0, options.limit)
        val floor = options.aliasFloor ?: return (pinned + rest).take(limit)
        val floored = alias.filter { it.score >= floor }.mapTo(HashSet()) { it.id }
        return (pinned + rest.filter { it.id in floored } + rest.filter { it.id !in floored }).take(limit)
    }

    /** How sure the semantic tier is, 0–1, from its best cosine score. */
    @JvmStatic
    @JvmOverloads
    public fun semanticConfidence(
        semantic: List<SearchResult>,
        calibration: SemanticCalibration = SemanticCalibration.DEFAULT,
    ): Double {
        val best = semantic.fold(0.0) { max, result -> maxOf(max, result.score) }
        return minOf(1.0, maxOf(0.0, (best - calibration.floor) / (calibration.ceiling - calibration.floor)))
    }

    /**
     * The semantic list with its unsupported country flags moved after its other results. A flag
     * is supported when the alias results hold the same flag (the query names that country in a
     * loaded locale) or its cosine reaches the calibration ceiling. Short Latin-script queries the
     * model does not know (romanized text, slang) land near the flag documents.
     */
    @JvmStatic
    @JvmOverloads
    public fun demoteUnsupportedFlags(
        semantic: List<SearchResult>,
        alias: List<SearchResult>,
        calibration: SemanticCalibration = SemanticCalibration.DEFAULT,
    ): List<SearchResult> {
        val aliasIds = alias.mapTo(HashSet()) { it.id }
        fun supported(result: SearchResult) =
            !isCountryFlag(result.id) || result.id in aliasIds || result.score >= calibration.ceiling
        if (semantic.all(::supported)) return semantic
        return semantic.filter(::supported) + semantic.filterNot(::supported)
    }

    /**
     * Fusion with weights from how sure each tier is. Alias: 0.4 + confidence. Semantic: 1 when its
     * best match is strong, down to 0.4 when it is weak, so a weak semantic list no longer outranks
     * an alias hit. When the alias tier is sure (confidence ≥ 0.6), its results within 0.1 of the
     * top score stay first; the semantic tier reorders them but cannot push in a clearly weaker
     * one. Semantic country flags the alias tier does not support go last.
     */
    @JvmStatic
    @JvmOverloads
    public fun fuse(
        alias: AliasSearchOutput<SearchResult>,
        semantic: List<SearchResult>,
        limit: Int = 24,
        calibration: SemanticCalibration = SemanticCalibration.DEFAULT,
    ): List<SearchResult> {
        val guarded = demoteUnsupportedFlags(semantic, alias.results, calibration)
        return fuseResults(
            alias.results,
            guarded,
            FuseOptions(
                limit = limit,
                aliasWeight = 0.4 + alias.confidence,
                semanticWeight = 0.4 + 0.6 * semanticConfidence(guarded, calibration),
                aliasFloor = if (alias.confidence >= ALIAS_FLOOR_MIN_CONFIDENCE) alias.confidence - ALIAS_BAND else null,
            ),
        )
    }

    /**
     * Should this query also go to the semantic tier? Yes when the alias engine is unsure, or when
     * the query is a multi-word phrase without a strong alias hit (conceptual queries).
     */
    @JvmStatic
    public fun shouldUseSemantic(alias: AliasSearchOutput<SearchResult>): Boolean {
        if (alias.tokens.isEmpty()) return false
        if (alias.confidence < 0.6) return true
        return alias.tokens.size >= 2 && alias.confidence < 0.9
    }

    /** A country (two regional indicators) or subdivision (black flag + tags) flag, by hexcode. */
    internal fun isCountryFlag(id: String): Boolean {
        val points = id.split('-').map { it.toIntOrNull(16) ?: 0 }
        if (points.size == 2) return points.all { it in REGIONAL_INDICATOR_A..REGIONAL_INDICATOR_Z }
        return points.size > 2 && points[0] == BLACK_FLAG && points[1] in TAG_SPACE..CANCEL_TAG
    }

    /** Alias results this close to a confident top score stay above the rest (`aliasFloor`). */
    private const val ALIAS_BAND = 0.1

    /** Below this alias confidence the alias tier is unsure (as in [shouldUseSemantic]): no floor. */
    private const val ALIAS_FLOOR_MIN_CONFIDENCE = 0.6
    private const val REGIONAL_INDICATOR_A = 0x1F1E6
    private const val REGIONAL_INDICATOR_Z = 0x1F1FF
    private const val BLACK_FLAG = 0x1F3F4
    private const val TAG_SPACE = 0xE0020
    private const val CANCEL_TAG = 0xE007F
}
