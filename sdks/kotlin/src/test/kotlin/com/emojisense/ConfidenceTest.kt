package com.emojisense

import kotlin.math.roundToLong
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Ports packages/core/test/confidence.test.ts. */
class ConfidenceTest {
    private fun result(id: String, score: Double, source: ResultSource) = EmojiResult(id, id, score, source)

    private fun alias(confidence: Double, coverage: Double, ids: List<String> = listOf("A"), tokens: List<String> = listOf("q")) =
        AliasSearchOutput(
            query = "q",
            tokens = tokens,
            results = ids.mapIndexed { i, id ->
                AliasResult(id, id, confidence - i * 0.01, ResultSource.ALIAS, label = id, match = "q", field = Field.ALIAS)
            },
            confidence = confidence,
            coverage = coverage,
        )

    /** A semantic list: [top], then four results [gap] below it. */
    private fun semantic(top: Double, gap: Double) =
        listOf(result("S1", top, ResultSource.SEMANTIC)) + listOf("S2", "S3", "S4", "S5").map { result(it, top - gap, ResultSource.SEMANTIC) }

    // ── semanticStrength ──────────────────────────────────────────────────────────────────────

    @Test
    fun `strength is 0 below the calibration floor and 1 for a clear top at the ceiling`() {
        assertEquals(0.0, Confidence.semanticStrength(semantic(0.4, 0.01)))
        assertEquals(1.0, Confidence.semanticStrength(semantic(0.6, 0.1)))
    }

    @Test
    fun `strength halves for a flat top`() {
        val clear = Confidence.semanticStrength(semantic(0.53, 0.06))
        val flat = Confidence.semanticStrength(semantic(0.53, 0.0))
        assertEquals(clear / 2, flat, 5e-6)
    }

    @Test
    fun `strength skips concept results and handles a list of one`() {
        assertEquals(0.0, Confidence.semanticStrength(listOf(result("C", 0.99, ResultSource.CONCEPT)) + semantic(0.4, 0.0)))
        assertEquals(1.0, Confidence.semanticStrength(listOf(result("S", 0.58, ResultSource.SEMANTIC))))
        assertEquals(0.0, Confidence.semanticStrength(emptyList()))
    }

    // ── assessConfidence ──────────────────────────────────────────────────────────────────────

    @Test
    fun `is sure when the dictionary covers the query with a confident top result`() {
        assertTrue(Confidence.aliasCovers(alias(0.9, 1.0)))
        assertEquals(QueryConfidence(0.9, false), Confidence.assessConfidence(alias(0.9, 1.0), semantic(0.4, 0.0)))
    }

    @Test
    fun `is unsure without coverage and with a flat or low semantic list`() {
        // "kendrick lamar": one word matched, cosines 0.38–0.40.
        assertTrue(Confidence.assessConfidence(alias(0.3, 0.45), semantic(0.4, 0.01)).unsure)
        assertTrue(Confidence.assessConfidence(alias(0.0, 0.0, emptyList()), semantic(0.4, 0.01)).unsure)
    }

    @Test
    fun `is sure when the semantic list is strong, whatever the dictionary says`() {
        assertEquals(QueryConfidence(1.0, false), Confidence.assessConfidence(alias(0.3, 0.45), semantic(0.6, 0.08)))
        assertFalse(Confidence.assessConfidence(null, semantic(0.6, 0.08)).unsure)
    }

    @Test
    fun `does not count a whole match with a weak top result as coverage`() {
        // "drake" → 🦆 by a weak field: the dictionary has the word, not the meaning.
        assertFalse(Confidence.aliasCovers(alias(0.58, 1.0)))
        assertTrue(Confidence.assessConfidence(alias(0.58, 1.0), semantic(0.47, 0.01)).unsure)
    }

    @Test
    fun `judges by the dictionary alone without a semantic list`() {
        assertFalse(Confidence.assessConfidence(alias(0.9, 1.0), null).unsure)
        assertEquals(
            QueryConfidence((0.7 * (0.5 / Confidence.WHOLE_COVERAGE) * 1000).roundToLong() / 1000.0, true),
            Confidence.assessConfidence(alias(0.7, 0.5), null),
        )
    }

    @Test
    fun `never calls an empty query unsure`() {
        assertEquals(QueryConfidence(0.0, false), Confidence.assessConfidence(alias(0.0, 0.0, emptyList(), tokens = emptyList()), emptyList()))
    }

    @Test
    fun `uses one threshold for the semantic list`() {
        assertTrue(Confidence.SEMANTIC_SURE > 0)
        val justBelow = semantic(0.44 + 0.14 * (Confidence.SEMANTIC_SURE - 0.01), 0.06)
        assertTrue(Confidence.assessConfidence(alias(0.0, 0.0, emptyList()), justBelow).unsure)
    }

    // ── mergeConcept ──────────────────────────────────────────────────────────────────────────

    private val fused = listOf(
        result("A", 0.9, ResultSource.ALIAS),
        result("S", 0.5, ResultSource.SEMANTIC),
        result("C2", 0.4, ResultSource.SEMANTIC),
    )
    private val concept = listOf(result("C1", 0.8, ResultSource.CONCEPT), result("C2", 0.7, ResultSource.CONCEPT))

    @Test
    fun `puts concept results first when no alias hit is confident`() {
        assertEquals(listOf("C1", "C2", "A", "S"), Confidence.mergeConcept(fused, concept, alias(0.3, 0.4)).map { it.id })
    }

    @Test
    fun `keeps confident alias hits of a covered query above the concept results`() {
        assertEquals(listOf("A", "C1", "C2", "S"), Confidence.mergeConcept(fused, concept, alias(0.9, 1.0)).map { it.id })
    }

    @Test
    fun `keeps the first place of a duplicate, respects the limit and returns the input without concepts`() {
        assertEquals(listOf("C1", "C2"), Confidence.mergeConcept(fused, concept, null, 2).map { it.id })
        assertEquals(fused, Confidence.mergeConcept(fused, emptyList(), null))
        assertEquals(ResultSource.CONCEPT, Confidence.mergeConcept(fused, concept, null).first { it.id == "C2" }.source)
    }
}
