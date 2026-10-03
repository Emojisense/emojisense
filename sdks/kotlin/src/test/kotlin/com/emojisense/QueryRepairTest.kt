package com.emojisense

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Ports packages/core/test/query-repair.test.ts: whole-word completions, short typos, split words. */
class QueryRepairTest {
    private val en = Pack(
        packVersion = "test",
        locale = "en",
        emojiVersion = "17.0",
        groups = listOf("test"),
        emoji = listOf(
            Fixtures.row("👋", "1F44B", "waving hand", alias = "hello|hallo"),
            Fixtures.row("🤘", "1F918", "sign of the horns", alias = "hell yeah"),
            Fixtures.row("🎃", "1F383", "jack-o-lantern", alias = "halloween"),
            Fixtures.row("🫟", "1FADF", "splatter", alias = "messy"),
            Fixtures.row("🐘", "1F418", "elephant"),
            Fixtures.row("🌈", "1F308", "rainbow"),
            Fixtures.row("☔", "2614", "umbrella with rain drops", keyword = "rain"),
        ),
    )
    private val engine = AliasEngine(listOf(en))

    private fun top(query: String): SearchResult? = engine.search(query).results.firstOrNull()

    // ── Completion of a whole word ────────────────────────────────────────────────────────────

    @Test
    fun `a completion of a whole word ranks below the word itself`() {
        // "hell" is a word ("hell yeah"), so "hello" is a weak completion of it.
        assertEquals("🤘", top("hell")?.emoji)
    }

    @Test
    fun `a completion is untouched while the word is not one yet`() {
        assertEquals("👋", top("hel")?.emoji)
    }

    // ── Typo of a short token ─────────────────────────────────────────────────────────────────

    @Test
    fun `a typo of a short token scores below a typo of a longer one`() {
        // One edit each: "messi" (5) → "messy", "elephnt" (7) → "elephant".
        val short = (top("messi")?.score ?: 0.0) / (top("messy")?.score ?: 1.0)
        val long = (top("elephnt")?.score ?: 0.0) / (top("elephant")?.score ?: 1.0)
        assertTrue(short < long)
        assertEquals(0.7 * 0.9, short, 0.005)
    }

    // ── A word split by a space ───────────────────────────────────────────────────────────────

    @Test
    fun `a split word is also searched joined, slightly below the joined word itself`() {
        val split = engine.search("hallo ween")
        assertEquals("🎃", split.results.first().emoji)
        assertEquals((top("halloween")?.score ?: 0.0) * 0.95, split.results.first().score, 0.0005)
        assertEquals(split.results.first().score, split.confidence)
        assertEquals(1.0, split.coverage)
        // The words as typed still count: the greeting stays in the list.
        assertTrue("👋" in split.results.map { it.emoji })
        assertEquals("hallo ween", split.query)
        assertEquals(listOf("hallo", "ween"), split.tokens)
    }

    @Test
    fun `a split word joins only into a vocabulary word`() {
        assertEquals("🌈", engine.search("rain bow").results.first().emoji)
        assertFalse("🌈" in engine.search("rain drops").results.map { it.emoji })
    }

    @Test
    fun `a split word keeps the trailing space of the query`() {
        // "hallo ween " searches "halloween " as a finished word: no completion, the same top.
        assertEquals("🎃", engine.search("hallo ween ").results.first().emoji)
        assertEquals(engine.search("hallo ween").results.first().score, engine.search("hallo ween ").results.first().score)
    }
}
