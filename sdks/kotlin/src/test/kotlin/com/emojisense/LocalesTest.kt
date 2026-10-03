package com.emojisense

import kotlinx.coroutines.runBlocking
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ports packages/core/test/locales.test.ts (and the Swift LocalesTests). */
class LocalesTest {
    private val portuguese = Fixtures.english.copy(
        locale = "pt",
        emoji = listOf(
            Fixtures.row("🎃", "1F383", "abóbora", alias = "careca nato"),
            Fixtures.row("🎂", "1F382", "bolo de aniversário", keyword = "bolo"),
        ),
    )
    private val engine = AliasEngine(listOf(Fixtures.english, Fixtures.turkish, portuguese, Fixtures.custom))

    private fun emoji(query: String, locale: String, locales: List<String>? = null): List<String> =
        engine.search(query, AliasSearchOptions(locale = locale, locales = locales)).results.map { it.emoji }

    // ── Search in the user's languages ───────────────────────────────────────────────────────

    @Test
    fun `matches every loaded pack by default`() {
        assertEquals(listOf("🎃"), emoji("nato", "en"))
    }

    @Test
    fun `leaves out the phrases of the other loaded languages`() {
        assertEquals(emptyList(), emoji("nato", "en", listOf("en", "tr")))
        assertEquals(emptyList(), emoji("bolo", "en", listOf("en", "tr")))
        assertEquals(listOf("🎂"), emoji("iyi ki dogdun", "en", listOf("en", "tr")))
    }

    @Test
    fun `never completes or corrects a word into a language the user does not have`() {
        assertTrue("🎃" in emoji("carec", "en"))
        assertEquals(emptyList(), emoji("carec", "en", listOf("en")))
        assertTrue("🎃" in emoji("carecs", "en"))
        assertEquals(emptyList(), emoji("carecs", "en", listOf("en")))
    }

    @Test
    fun `always searches English, the preferred locale and custom packs`() {
        assertTrue("👍" in emoji("thumbsup", "tr", listOf("tr")))
        assertEquals(listOf("🎂"), emoji("bolo", "pt", listOf("en")))
        assertTrue(":party_parrot:" in emoji("party parrot", "en", listOf("en")))
    }

    @Test
    fun `is passed on by the search session`() = runBlocking {
        val states = mutableListOf<SessionState>()
        SearchSession(engine, this, locale = "en", locales = listOf("en", "tr"), onChange = { states.add(it) }).update("nato")
        assertEquals(emptyList(), states.last().results)
    }

    // ── userLocales ──────────────────────────────────────────────────────────────────────────

    @Test
    fun `maps the user's language tags to packs, most preferred first, always with English`() {
        assertEquals(listOf("tr", "en"), PackLocales.userLocales(listOf("tr-TR", "en-US", "de", "tr")))
        assertEquals(listOf("pt", "en"), PackLocales.userLocales(listOf("pt-BR")))
        assertEquals(listOf("zh", "id", "en"), PackLocales.userLocales(listOf("zh-Hant-TW", "in")))
        assertEquals(listOf("en"), PackLocales.userLocales(emptyList()))
    }

    @Test
    fun `keeps to the supported packs`() {
        assertEquals(listOf("tr", "en"), PackLocales.userLocales(listOf("fr", "tr"), supported = listOf("en", "tr")))
    }

    @Test
    fun `reads the device's languages by default`() {
        val original = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("es-MX"))
            assertEquals(listOf("es-MX"), PackLocales.deviceLanguages())
            assertEquals(listOf("es", "en"), PackLocales.userLocales())
            Locale.setDefault(Locale.forLanguageTag("ru-RU"))
            assertEquals(listOf("ru", "en"), PackLocales.userLocales())
        } finally {
            Locale.setDefault(original)
        }
    }

    // ── packLocaleOf ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `maps a BCP 47 tag to its language's pack`() {
        assertEquals("en", PackLocales.packLocaleOf("en_US"))
        assertEquals("pt", PackLocales.packLocaleOf(" PT-br "))
        assertEquals("zh", PackLocales.packLocaleOf("zh_Hans"))
        assertNull(PackLocales.packLocaleOf("de-DE"))
        assertNull(PackLocales.packLocaleOf(""))
    }
}
