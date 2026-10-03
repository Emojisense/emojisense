package com.emojisense

/**
 * The learned fusion of the alias and semantic lists (PACK_FORMAT.md §10), like
 * `packages/core/src/rerank.ts`: a linear score over eight features per candidate.
 */
public object Rerank {
    /**
     * One weight per [features] value. The same as `RERANK_WEIGHTS` in packages/core, trained for
     * EmbeddingGemma @768 with the semantic scores of core semantic-policy.ts. No feature is a
     * usage prior.
     */
    @JvmField
    public val WEIGHTS: List<Double> = listOf(-0.334, 1.59, 1.899, 0.3387, 10.67, -7.255, 1.838, 3.632)

    public data class Input @JvmOverloads constructor(
        val alias: AliasSearchOutput<SearchResult>,
        val semantic: List<SearchResult>,
        /** How sure the semantic tier is, 0–1 ([Fusion.semanticConfidence]). */
        val semanticConfidence: Double,
    )

    /**
     * Alias present (0/1), alias score, 1 / alias rank, alias score / alias confidence, semantic
     * score (a candidate missing from the semantic list scores 0.02 below its lowest), best semantic
     * score − semantic score, alias score × alias confidence, semantic score × semantic confidence.
     */
    @JvmStatic
    public fun features(input: Input, id: String): List<Double> {
        val alias = input.alias
        val rank = alias.results.indexOfFirst { it.id == id }
        val aliasScore = if (rank < 0) 0.0 else alias.results[rank].score
        var best = 0.0
        var lowest = Double.POSITIVE_INFINITY
        for (result in input.semantic) {
            best = maxOf(best, result.score)
            lowest = minOf(lowest, result.score)
        }
        val score = input.semantic.firstOrNull { it.id == id }?.score
            ?: if (input.semantic.isEmpty()) 0.0 else lowest - 0.02
        return listOf(
            if (rank < 0) 0.0 else 1.0,
            aliasScore,
            if (rank < 0) 0.0 else 1.0 / (rank + 1),
            if (rank < 0) 0.0 else aliasScore / alias.confidence,
            score,
            best - score,
            aliasScore * alias.confidence,
            score * input.semanticConfidence,
        )
    }

    /** Fields whose match of the whole query is a curated answer. */
    private val CURATED_FIELDS = setOf(Field.NAME, Field.SHORTCODE, Field.KEYWORD, Field.ALIAS)
    private val DIGITS_ONLY = Regex("^[0-9]+( [0-9]+)*$")

    /**
     * The dictionary's answer to number slang (a query of digits only, e.g. zh "666", "88"): a
     * confident top result whose phrase is the whole query in a curated field. The embedding model
     * reads digits literally (6️⃣, 8️⃣); the dictionary knows the slang (👍, 👋).
     */
    internal fun numberSlangAnswer(alias: AliasSearchOutput<SearchResult>): SearchResult? {
        if (!DIGITS_ONLY.matches(alias.query) || alias.confidence < 0.6) return null
        val top = alias.results.firstOrNull() as? AliasResult ?: return null
        return if (top.match == alias.query && top.field in CURATED_FIELDS) top else null
    }

    /**
     * Alias results ≥ 0.9 stay on top in alias order, and so does the dictionary's answer to number
     * slang ([numberSlangAnswer]); then every other candidate of both lists by its learned score;
     * equal scores keep alias-then-semantic order.
     */
    @JvmStatic
    @JvmOverloads
    public fun rerank(input: Input, limit: Int, weights: List<Double> = WEIGHTS): List<SearchResult> {
        val pinned = input.alias.results.filter { it.score >= 0.9 }.toMutableList<SearchResult>()
        if (pinned.isEmpty()) numberSlangAnswer(input.alias)?.let { pinned.add(it) }
        val seen = pinned.mapTo(HashSet()) { it.id }
        val rest = ArrayList<Pair<SearchResult, Double>>()
        for (result in input.alias.results + input.semantic) {
            if (!seen.add(result.id)) continue
            // Summed left to right, as the reference does, so scores are bit-for-bit equal.
            var score = 0.0
            features(input, result.id).forEachIndexed { index, value -> score += value * (weights.getOrNull(index) ?: 0.0) }
            rest.add(result to score)
        }
        // sortedByDescending is stable: equal scores keep candidate order.
        return (pinned + rest.sortedByDescending { it.second }.map { it.first }).take(maxOf(0, limit))
    }
}
