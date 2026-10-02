package com.emojisense

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Ports packages/core/test/fusion.test.ts (and the Swift FusionTests). */
class FusionTest {
    /** The fusion before the reranker (`rerank = false`), which these `fuse` tests describe. */
    private val rrf = Fusion.Ranking(rerank = false)

    private fun result(emoji: String, score: Double, source: ResultSource) = EmojiResult(emoji, emoji, score, source)

    @Test
    fun `keeps confident alias hits pinned on top in their order`() {
        val alias = listOf(result("🦖", 0.95, ResultSource.ALIAS), result("🦕", 0.92, ResultSource.ALIAS), result("🐊", 0.4, ResultSource.ALIAS))
        val semantic = listOf(
            result("🌋", 0.8, ResultSource.SEMANTIC),
            result("🦕", 0.7, ResultSource.SEMANTIC),
            result("🦖", 0.6, ResultSource.SEMANTIC),
        )
        assertEquals(listOf("🦖", "🦕", "🌋", "🐊"), Fusion.fuseResults(alias, semantic).map { it.emoji })
    }

    @Test
    fun `boosts items both tiers agree on`() {
        val alias = listOf(result("A", 0.5, ResultSource.ALIAS), result("B", 0.4, ResultSource.ALIAS))
        val semantic = listOf(result("B", 0.9, ResultSource.SEMANTIC), result("C", 0.8, ResultSource.SEMANTIC))
        val fused = Fusion.fuseResults(alias, semantic)
        assertEquals("B", fused.first().emoji)
        assertEquals(ResultSource.ALIAS, fused.first().source)
    }

    @Test
    fun `keeps first-seen order for equal scores`() {
        val semantic = (0 until 5).map { result("$it", 0.1, ResultSource.SEMANTIC) }
        val fused = Fusion.fuseResults(emptyList(), semantic, FuseOptions(semanticWeight = 0.0))
        assertEquals(listOf("0", "1", "2", "3", "4"), fused.map { it.emoji })
    }

    @Test
    fun `respects the limit`() {
        val many = (0 until 50).map { result("$it", 0.1, ResultSource.SEMANTIC) }
        assertEquals(10, Fusion.fuseResults(emptyList(), many, FuseOptions(limit = 10)).size)
    }

    @Test
    fun `keeps alias results above the floor ahead, ordered by fused score`() {
        val alias = listOf(result("A", 0.8, ResultSource.ALIAS), result("B", 0.78, ResultSource.ALIAS), result("C", 0.6, ResultSource.ALIAS))
        val semantic = listOf(
            result("C", 0.5, ResultSource.SEMANTIC),
            result("B", 0.49, ResultSource.SEMANTIC),
            result("S", 0.48, ResultSource.SEMANTIC),
        )
        assertEquals(listOf("C", "B", "A", "S"), Fusion.fuseResults(alias, semantic).map { it.emoji })
        assertEquals(listOf("B", "A", "C", "S"), Fusion.fuseResults(alias, semantic, FuseOptions(aliasFloor = 0.7)).map { it.emoji })
    }

    private val brazil = "1F1E7-1F1F7"
    private val bhutan = "1F1E7-1F1F9"
    private val scotland = "1F3F4-E0067-E0062-E0073-E0063-E0074-E007F"
    private val chequered = "1F3C1"

    @Test
    fun `moves flags the alias tier does not hold after the other results`() {
        val semantic = listOf(
            result(bhutan, 0.45, ResultSource.SEMANTIC),
            result("🐰", 0.44, ResultSource.SEMANTIC),
            result(scotland, 0.43, ResultSource.SEMANTIC),
            result(chequered, 0.42, ResultSource.SEMANTIC),
        )
        assertEquals(listOf("🐰", chequered, bhutan, scotland), Fusion.demoteUnsupportedFlags(semantic, emptyList()).map { it.id })
    }

    @Test
    fun `keeps a flag the alias results hold or one at the calibration ceiling`() {
        val semantic = listOf(
            result(brazil, 0.5, ResultSource.SEMANTIC),
            result(bhutan, 0.58, ResultSource.SEMANTIC),
            result("💛", 0.4, ResultSource.SEMANTIC),
        )
        assertEquals(
            listOf(brazil, bhutan, "💛"),
            Fusion.demoteUnsupportedFlags(semantic, listOf(result(brazil, 0.86, ResultSource.ALIAS))).map { it.id },
        )
        assertEquals(listOf(bhutan, "💛", brazil), Fusion.demoteUnsupportedFlags(semantic, emptyList()).map { it.id })
    }

    private fun aliasOutput(confidence: Double, emoji: List<String>): AliasSearchOutput<AliasResult> {
        val results = emoji.mapIndexed { index, value ->
            AliasResult(value, value, confidence - index * 0.01, ResultSource.ALIAS, value, "q", Field.ALIAS)
        }
        return AliasSearchOutput("q", listOf("q"), results, confidence)
    }

    private fun semanticList(best: Double) = listOf("S1", "S2", "S3", "S4").mapIndexed { i, id -> result(id, best - i * 0.01, ResultSource.SEMANTIC) }

    @Test
    fun `maps the best cosine between the calibration floor and ceiling`() {
        assertEquals(0.0, Fusion.semanticConfidence(emptyList()))
        assertEquals(0.0, Fusion.semanticConfidence(semanticList(0.4)))
        assertEquals(0.5, Fusion.semanticConfidence(semanticList(0.51)), 1e-9)
        assertEquals(1.0, Fusion.semanticConfidence(semanticList(0.8)))
        assertEquals(0.75, Fusion.semanticConfidence(semanticList(0.5), SemanticCalibration(0.2, 0.6)), 1e-9)
    }

    @Test
    fun `keeps an unsure alias hit above a weak semantic list`() {
        val fused = Fusion.fuse(aliasOutput(0.45, listOf("A1", "A2")), semanticList(0.42), limit = 4, ranking = rrf)
        assertEquals(listOf("A1", "A2", "S1", "S2"), fused.map { it.emoji })
    }

    @Test
    fun `keeps a sure alias top above a weaker alias hit the semantic list favours`() {
        val results = listOf("👍" to 0.82, "🔥" to 0.8, "6️⃣" to 0.66).map { (emoji, score) ->
            AliasResult(emoji, emoji, score, ResultSource.ALIAS, emoji, "666", Field.ALIAS)
        }
        val alias = AliasSearchOutput("666", listOf("666"), results, 0.82)
        val semantic = listOf(
            result("6️⃣", 0.46, ResultSource.SEMANTIC),
            result("🕕", 0.45, ResultSource.SEMANTIC),
            result("7️⃣", 0.43, ResultSource.SEMANTIC),
        )
        assertEquals(listOf("👍", "🔥", "6️⃣", "🕕"), Fusion.fuse(alias, semantic, limit = 4, ranking = rrf).map { it.emoji })
    }

    @Test
    fun `lets the semantic list break near-ties among the top alias results`() {
        val semantic = listOf(result("🚀", 0.51, ResultSource.SEMANTIC), result("🦝", 0.5, ResultSource.SEMANTIC))
        val fused = Fusion.fuse(aliasOutput(0.78, listOf("🪨", "🚀")), semantic, limit = 3, ranking = rrf)
        assertEquals(listOf("🚀", "🪨", "🦝"), fused.map { it.emoji })
    }

    @Test
    fun `ranks semantic flags the alias tier does not hold after the other results`() {
        val flag = EmojiResult("🇧🇹", bhutan, 0.44, ResultSource.SEMANTIC)
        val semantic = listOf(flag, result("🐰", 0.43, ResultSource.SEMANTIC), result("🐇", 0.42, ResultSource.SEMANTIC))
        val fused = Fusion.fuse(aliasOutput(0.26, listOf("😄")), semantic, limit = 4, ranking = rrf)
        assertEquals(listOf("😄", "🐰", "🐇", "🇧🇹"), fused.map { it.emoji })
    }

    @Test
    fun `still lets a sure semantic list lead an unsure alias list`() {
        val fused = Fusion.fuse(aliasOutput(0.45, listOf("A1", "A2")), semanticList(0.7), limit = 4, ranking = rrf)
        assertEquals(listOf("S1", "S2", "S3", "S4"), fused.map { it.emoji })
    }

    @Test
    fun `asks the semantic tier only when the alias tier is unsure`() {
        val output = { tokens: List<String>, confidence: Double -> AliasSearchOutput<SearchResult>("", tokens, emptyList(), confidence) }
        assertFalse(Fusion.shouldUseSemantic(output(emptyList(), 0.0)))
        assertTrue(Fusion.shouldUseSemantic(output(listOf("x"), 0.5)))
        assertFalse(Fusion.shouldUseSemantic(output(listOf("x"), 0.8)))
        assertTrue(Fusion.shouldUseSemantic(output(listOf("x", "y"), 0.8)))
        assertFalse(Fusion.shouldUseSemantic(output(listOf("x", "y"), 0.95)))
    }
}
