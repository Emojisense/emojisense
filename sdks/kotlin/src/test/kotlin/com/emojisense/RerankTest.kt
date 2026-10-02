package com.emojisense

import kotlin.test.Test
import kotlin.test.assertEquals

/** Ports packages/core/test/rerank.test.ts. */
class RerankTest {
    private fun aliasHit(id: String, score: Double) = AliasResult(id, id, score, ResultSource.ALIAS, id, "q", Field.ALIAS)

    private fun semanticHit(id: String, score: Double) = EmojiResult(id, id, score, ResultSource.SEMANTIC)

    private fun output(results: List<AliasResult>) =
        AliasSearchOutput<SearchResult>("q", listOf("q"), results, results.firstOrNull()?.score ?: 0.0)

    private fun input(alias: List<AliasResult>, semantic: List<SearchResult>, popularity: ((String) -> Double)? = null) =
        Rerank.Input(output(alias), semantic, 0.5, popularity)

    @Test
    fun `describes a candidate by both lists, its popularity and the confidences`() {
        val features = Rerank.features(
            input(
                listOf(aliasHit("A", 0.8), aliasHit("B", 0.4)),
                listOf(semanticHit("S", 0.6), semanticHit("B", 0.5)),
            ) { if (it == "B") 0.7 else 0.0 },
            "B",
        )
        val expected = listOf(1.0, 0.4, 0.5, 0.5, 0.5, 0.1, 0.7, 0.32, 0.25)
        assertEquals(Rerank.WEIGHTS.size, features.size)
        features.zip(expected).forEach { (value, want) -> assertEquals(want, value, 1e-9) }
    }

    @Test
    fun `scores a candidate missing from the semantic list below its lowest result`() {
        val features = Rerank.features(input(listOf(aliasHit("A", 0.6)), listOf(semanticHit("S", 0.6), semanticHit("T", 0.5))), "A")
        assertEquals(0.48, features[4], 1e-9)
        assertEquals(0.12, features[5], 1e-9)
        assertEquals(0.0, Rerank.features(input(listOf(aliasHit("A", 0.6)), emptyList()), "A")[4])
    }

    @Test
    fun `keeps alias results of 0_9 and more on top in alias order`() {
        val out = Rerank.rerank(input(listOf(aliasHit("A", 0.95), aliasHit("B", 0.92)), listOf(semanticHit("S", 0.9))), 3)
        assertEquals(listOf("A", "B", "S"), out.map { it.id })
    }

    @Test
    fun `puts a candidate both lists hold above one that only one list holds`() {
        val out = Rerank.rerank(
            input(listOf(aliasHit("A", 0.5), aliasHit("B", 0.5)), listOf(semanticHit("B", 0.55), semanticHit("C", 0.5))),
            3,
        )
        assertEquals(listOf("B", "A", "C"), out.map { it.id })
    }

    @Test
    fun `lets popularity decide between otherwise equal candidates`() {
        val alias = listOf(aliasHit("A", 0.5), aliasHit("B", 0.5))
        assertEquals(listOf("A", "B"), Rerank.rerank(input(alias, emptyList()), 2).map { it.id })
        val popular = Rerank.rerank(input(alias, emptyList()) { if (it == "B") 1.0 else 0.0 }, 2)
        assertEquals(listOf("B", "A"), popular.map { it.id })
    }

    @Test
    fun `fuse moves unsupported flags last`() {
        val flag = EmojiResult("🇧🇹", "1F1E7-1F1F9", 0.47, ResultSource.SEMANTIC)
        val out = Fusion.fuse(output(listOf(aliasHit("😄", 0.26))), listOf(flag, semanticHit("🐰", 0.43)), 4)
        assertEquals("1F1E7-1F1F9", out.last().id)
    }
}
