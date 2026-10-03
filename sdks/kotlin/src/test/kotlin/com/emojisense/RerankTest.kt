package com.emojisense

import kotlin.test.Test
import kotlin.test.assertEquals

/** Ports packages/core/test/rerank.test.ts. */
class RerankTest {
    private fun aliasHit(id: String, score: Double) = AliasResult(id, id, score, ResultSource.ALIAS, id, "q", Field.ALIAS)

    private fun semanticHit(id: String, score: Double) = EmojiResult(id, id, score, ResultSource.SEMANTIC)

    private fun output(results: List<AliasResult>) =
        AliasSearchOutput<SearchResult>("q", listOf("q"), results, results.firstOrNull()?.score ?: 0.0)

    private fun input(alias: List<AliasResult>, semantic: List<SearchResult>) = Rerank.Input(output(alias), semantic, 0.5)

    @Test
    fun `describes a candidate by both lists and the confidences, never by usage`() {
        val features = Rerank.features(
            input(
                listOf(aliasHit("A", 0.8), aliasHit("B", 0.4)),
                listOf(semanticHit("S", 0.6), semanticHit("B", 0.5)),
            ),
            "B",
        )
        val expected = listOf(1.0, 0.4, 0.5, 0.5, 0.5, 0.1, 0.32, 0.25)
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
    fun `keeps the order of otherwise equal candidates`() {
        val alias = listOf(aliasHit("A", 0.5), aliasHit("B", 0.5))
        assertEquals(listOf("A", "B"), Rerank.rerank(input(alias, emptyList()), 2).map { it.id })
    }

    @Test
    fun `fuse moves unsupported flags last`() {
        val flag = EmojiResult("🇧🇹", "1F1E7-1F1F9", 0.47, ResultSource.SEMANTIC)
        val out = Fusion.fuse(output(listOf(aliasHit("😄", 0.26))), listOf(flag, semanticHit("🐰", 0.43)), 4)
        assertEquals("1F1E7-1F1F9", out.last().id)
    }

    /** zh "666": 👍 by its curated alias "666"; the embedding model reads the digits (6️⃣ first). */
    private fun slang(query: String, field: Field = Field.ALIAS, confidence: Double = 0.82): Rerank.Input {
        val alias = AliasSearchOutput<SearchResult>(
            query,
            listOf(query),
            listOf(
                AliasResult("👍", "👍", 0.82, ResultSource.ALIAS, "", query, field),
                AliasResult("🔥", "🔥", 0.8, ResultSource.ALIAS, "", query, Field.ALIAS),
                AliasResult("6️⃣", "6️⃣", 0.661, ResultSource.ALIAS, "", query + "6", Field.ALIAS),
            ),
            confidence,
        )
        return Rerank.Input(alias, listOf(semanticHit("6️⃣", 0.586), semanticHit("🕕", 0.466), semanticHit("🐍", 0.436)), 1.0)
    }

    @Test
    fun `keeps the dictionary's answer first for number slang`() {
        assertEquals("👍", Rerank.rerank(slang("666"), 3).first().id)
        assertEquals("👍", Rerank.rerank(slang("8 8"), 3).first().id)
    }

    @Test
    fun `leaves other queries, weak fields and unsure dictionaries to the learned score`() {
        assertEquals("6️⃣", Rerank.rerank(slang("sss"), 3).first().id)
        assertEquals("6️⃣", Rerank.rerank(slang("666", Field.LOW), 3).first().id)
        assertEquals("6️⃣", Rerank.rerank(slang("666", confidence = 0.5), 3).first().id)
    }
}
