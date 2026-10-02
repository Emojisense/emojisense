package com.emojisense

/**
 * The learned fusion of the alias and semantic lists (PACK_FORMAT.md §10), like
 * `packages/core/src/rerank.ts`: a linear score over nine features per candidate.
 */
public object Rerank {
    /**
     * One weight per [features] value. The same as `RERANK_WEIGHTS` in packages/core, trained for
     * bge-m3 @1024 with the popularity prior in the semantic scores.
     */
    @JvmField
    public val WEIGHTS: List<Double> = listOf(0.04023, 1.781, 1.697, 0.8871, 13.72, -19.46, 2.342, 2.146, 3.891)

    public data class Input @JvmOverloads constructor(
        val alias: AliasSearchOutput<SearchResult>,
        val semantic: List<SearchResult>,
        /** How sure the semantic tier is, 0–1 ([Fusion.semanticConfidence]). */
        val semanticConfidence: Double,
        /** 0–1 ([AliasEngine.popularity]); 0 for every emoji when null. */
        val popularity: ((String) -> Double)? = null,
    )

    /**
     * Alias present (0/1), alias score, 1 / alias rank, alias score / alias confidence, semantic
     * score (a candidate missing from the semantic list scores 0.02 below its lowest), best semantic
     * score − semantic score, popularity, alias score × alias confidence, semantic score × semantic
     * confidence.
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
            input.popularity?.invoke(id) ?: 0.0,
            aliasScore * alias.confidence,
            score * input.semanticConfidence,
        )
    }

    /**
     * Alias results ≥ 0.9 stay on top in alias order, then every other candidate of both lists by
     * its learned score; equal scores keep alias-then-semantic order.
     */
    @JvmStatic
    @JvmOverloads
    public fun rerank(input: Input, limit: Int, weights: List<Double> = WEIGHTS): List<SearchResult> {
        val pinned = input.alias.results.filter { it.score >= 0.9 }
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
