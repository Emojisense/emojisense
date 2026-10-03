package com.emojisense

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Ports packages/core/test/partial-match.test.ts: the partial-match rules of PACK_FORMAT.md §4. */
class PartialMatchTest {
    private fun pack(locale: String, vararg rows: PackRow) =
        Pack(packVersion = "test", locale = locale, emojiVersion = "17.0", groups = listOf("test"), emoji = rows.toList())

    private val en = pack(
        "en",
        Fixtures.row("🪨", "1FAA8", "rock"),
        Fixtures.row("🚀", "1F680", "rocket", keyword = "space"),
        Fixtures.row("🪔", "1FA94", "diya lamp", keyword = "lamp"),
        Fixtures.row("🦙", "1F999", "llama"),
        Fixtures.row("💍", "1F48D", "ring", keyword = "wedding"),
        Fixtures.row("🧎", "1F9CE", "person kneeling"),
        Fixtures.row("🐈", "1F408", "cat"),
    )
    private val tr = pack(
        "tr",
        Fixtures.row("🪨", "1FAA8", "kaya"),
        Fixtures.row("🚀", "1F680", "roket"),
        Fixtures.row("🪔", "1FA94", "kandil"),
        Fixtures.row("🦙", "1F999", "lama"),
        Fixtures.row("💍", "1F48D", "yüzük"),
        Fixtures.row("🧎", "1F9CE", "diz çöken kişi"),
        Fixtures.row("🐈", "1F408", "kedi"),
    )
    private val id = pack(
        "id",
        Fixtures.row("🪨", "1FAA8", "batu"),
        Fixtures.row("🚀", "1F680", "roket"),
        Fixtures.row("🪔", "1FA94", "pelita"),
        Fixtures.row("🦙", "1F999", "llama"),
        Fixtures.row("💍", "1F48D", "cincin", alias = "lamaran"),
        Fixtures.row("🧎", "1F9CE", "orang berlutut", alias = "lamar pacar"),
        Fixtures.row("🐈", "1F408", "kucing"),
    )

    private val enTr = AliasEngine(listOf(en, tr))
    private val enId = AliasEngine(listOf(en, id))

    private fun emoji(engine: AliasEngine, query: String, locale: String = "en"): List<String> =
        engine.search(query, AliasSearchOptions(locale = locale)).results.map { it.emoji }

    private fun coverage(engine: AliasEngine, query: String, locale: String? = null): Double =
        engine.search(query, AliasSearchOptions(locale = locale)).coverage

    // ── Short tokens need stronger evidence for a typo match ─────────────────────────────────

    @Test
    fun `never reads a short token as a word it extends`() {
        // "rockt" → "rocket" (a letter left out), not "rock" (a letter more).
        assertEquals("🚀", emoji(enTr, "rockt").first())
        assertFalse("🪨" in emoji(enTr, "rockt"))
    }

    @Test
    fun `matches a short typo only to a word of the preferred locale`() {
        // "lamar" is not Turkish "lama" (🦙): a word it extends, in another locale.
        assertEquals(emptyList(), emoji(enTr, "lamar "))
        // "kedu" is a typo of Turkish "kedi" for Turkish users, not for English ones.
        assertEquals(listOf("🐈"), emoji(enTr, "kedu ", "tr"))
        assertEquals(emptyList(), emoji(enTr, "kedu ", "en"))
        // A typo of a preferred-locale word still matches: "rcok" → "rock".
        assertEquals("🪨", emoji(enTr, "rcok ").first())
    }

    // ── A partial match of one token does not stand for a query of unknown words ─────────────

    @Test
    fun `drops a prefix match of one token when another token matches nothing`() {
        assertTrue("🚀" in emoji(enTr, "roc"))
        assertEquals(emptyList(), emoji(enTr, "qzxv roc"))
    }

    @Test
    fun `keeps an exact word next to an unknown one`() {
        assertTrue("🪨" in emoji(enTr, "qzxv rock"))
        assertTrue(coverage(enTr, "qzxv rock") < Confidence.WHOLE_COVERAGE)
    }

    // ── Prefix completions into another locale's words ────────────────────────────────────────

    @Test
    fun `rank below an exact word, in any locale`() {
        // id "lamar" (in "lamar pacar") is a whole word; id "lamaran" only completes it. A completion
        // of a whole word is weak enough to drop out entirely (WHOLE_WORD_COMPLETION_QUALITY).
        val results = emoji(enId, "lamar")
        val ring = results.indexOf("💍")
        assertEquals(0, results.indexOf("🧎"))
        assertTrue(ring == -1 || ring > 0)
    }

    @Test
    fun `never outrank a match of the preferred locale`() {
        // "lam" completes en "lamp" and id "lamaran": the English word first.
        assertEquals("🪔", emoji(enId, "lam").first())
        val out = enId.search("lam", AliasSearchOptions(locale = "en"))
        val ring = out.results.first { it.emoji == "💍" }
        assertTrue(ring.score < out.results.first().score)
    }

    @Test
    fun `are whole words for the locale that has them`() {
        assertEquals("💍", enId.search("lamara", AliasSearchOptions(locale = "id")).results.first().emoji)
        assertEquals(1.0, coverage(enId, "lamara", "id"))
        assertEquals(0.0, coverage(enId, "lamara", "en"))
    }

    // ── Coverage ──────────────────────────────────────────────────────────────────────────────

    @Test
    fun `is the share of the query one phrase matches with whole tokens`() {
        assertEquals(1.0, coverage(enTr, "rock"))
        assertEquals(1.0, coverage(enTr, "rocke")) // completion of the word being typed
        assertEquals(1.0, coverage(enTr, "rockt")) // a typo of the whole word
        assertEquals(0.0, coverage(enTr, ""))
        assertEquals(0.0, coverage(enTr, "qzxv"))
    }

    @Test
    fun `keeps coverage on the output with culture results`() {
        val culture = Culture(packVersion = "test", locale = "en", from = "2026-10-02", until = "2026-10-16", entries = emptyList())
        assertEquals(1.0, enTr.withCulture(culture).search("rock").coverage)
    }
}
