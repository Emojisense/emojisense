package com.emojisense

/** The verdict of [Confidence.assessConfidence]. */
public data class QueryConfidence(
    /** 0–1: how well the best tier understood the query. */
    val confidence: Double,
    /**
     * No tier understood the query: the dictionary does not cover its words and the semantic list
     * is flat or low. Show the results as guesses; the server asks its concept tier.
     */
    val unsure: Boolean,
)

/**
 * The unsure verdict and the concept merge, like `packages/core/src/confidence.ts`. Thresholds:
 * DECISIONS.md, "Unsure queries and the concept tier".
 */
public object Confidence {
    /** At or above this [AliasSearchOutput.coverage] the alias dictionary explains the whole query. */
    public const val WHOLE_COVERAGE: Double = 0.85

    /**
     * Below this semantic strength the semantic list is flat or low: the model matched the query to
     * nothing in particular ("kendrick lamar" → 🦁 🤦 🧙‍♂️ at cosines 0.38–0.40).
     */
    public const val SEMANTIC_SURE: Double = 0.6

    /** The alias tier is unsure below this top score (as in [Fusion.shouldUseSemantic]). */
    private const val ALIAS_SURE = 0.6

    /** Results 2–5 whose mean the top cosine must clear to stand out. */
    private const val SPREAD_RANKS = 5

    /** A top cosine this far above the next ones counts as a full calibration step (`ceiling − floor`). */
    private const val SPREAD_FULL = 0.06

    /**
     * How strong a semantic list is, 0–1, from its final scores: the best cosine on the calibrated
     * scale, scaled down when the top does not stand out from results 2–5. This is the one place
     * that reads semantic scores for the unsure verdict, so a reranker can feed its own list here.
     * Concept results ([ResultSource.CONCEPT]) are not semantic evidence and are skipped.
     */
    @JvmStatic
    @JvmOverloads
    public fun semanticStrength(
        semantic: List<SearchResult>,
        calibration: SemanticCalibration = SemanticCalibration.DEFAULT,
    ): Double {
        val scores = semantic.filter { it.source != ResultSource.CONCEPT }.map { it.score }
        val top = scores.firstOrNull() ?: 0.0
        val level = minOf(1.0, maxOf(0.0, (top - calibration.floor) / (calibration.ceiling - calibration.floor)))
        val next = scores.drop(1).take(SPREAD_RANKS - 1)
        if (next.isEmpty()) return level
        var sum = 0.0
        for (score in next) sum += score
        val mean = sum / next.size
        val spread = minOf(1.0, maxOf(0.0, (top - mean) / SPREAD_FULL))
        // A flat top (nothing stands out) halves the strength; a clear one keeps it.
        return level * (0.5 + 0.5 * spread)
    }

    /**
     * The dictionary explains the whole query with confidence: one phrase matches all its words
     * (`coverage` ≥ 0.85, not one word of it or a part of a word) and the top result scores ≥ 0.6.
     * A whole match in a weak field ("drake" → 🦆 by a keyword, 0.58) is not enough on its own.
     */
    @JvmStatic
    public fun aliasCovers(alias: AliasSearchOutput<SearchResult>): Boolean =
        alias.coverage >= WHOLE_COVERAGE && alias.confidence >= ALIAS_SURE

    /**
     * Is a query unsure? Yes when the dictionary does not cover it ([aliasCovers]) and the semantic
     * list is flat or low ([semanticStrength] < [SEMANTIC_SURE]). Without a semantic list (null: not
     * asked, offline, over the limit), when the dictionary does not cover it. An empty query is
     * never unsure.
     */
    @JvmStatic
    @JvmOverloads
    public fun assessConfidence(
        alias: AliasSearchOutput<SearchResult>?,
        semantic: List<SearchResult>?,
        calibration: SemanticCalibration = SemanticCalibration.DEFAULT,
    ): QueryConfidence {
        if (alias != null && alias.tokens.isEmpty()) return QueryConfidence(0.0, false)
        val aliasPart = if (alias != null) alias.confidence * minOf(1.0, alias.coverage / WHOLE_COVERAGE) else 0.0
        val covered = alias != null && aliasCovers(alias)
        if (semantic == null) return QueryConfidence(roundScore(aliasPart), alias != null && !covered)
        val strength = semanticStrength(semantic, calibration)
        return QueryConfidence(roundScore(maxOf(aliasPart, strength)), !covered && strength < SEMANTIC_SURE)
    }

    /**
     * Concept results ([ResultSource.CONCEPT]) go after the confident alias hits (the dictionary
     * covers the query and the hit scores ≥ 0.6) and before every other result. Duplicates keep
     * their first place.
     */
    @JvmStatic
    @JvmOverloads
    public fun mergeConcept(
        results: List<SearchResult>,
        concept: List<SearchResult>,
        alias: AliasSearchOutput<SearchResult>?,
        limit: Int = 24,
    ): List<SearchResult> {
        val count = maxOf(0, limit)
        if (concept.isEmpty()) return results.take(count)
        val confident = if (alias != null && aliasCovers(alias)) {
            alias.results.filter { it.score >= ALIAS_SURE }.mapTo(HashSet()) { it.id }
        } else {
            emptySet()
        }
        val head = results.filter { it.id in confident }
        val seen = HashSet<String>()
        return (head + concept + results).filter { seen.add(it.id) }.take(count)
    }
}
