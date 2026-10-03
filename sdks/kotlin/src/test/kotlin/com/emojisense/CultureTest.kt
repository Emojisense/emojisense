package com.emojisense

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ports packages/core/test/culture.test.ts. */
@OptIn(ExperimentalCoroutinesApi::class)
class CultureTest {
    private val pack = Fixtures.english.copy(
        emoji = Fixtures.english.emoji + listOf(
            Fixtures.row("⚽", "26BD", "soccer ball", keyword = "football"),
            Fixtures.row("🇦🇷", "1F1E6-1F1F7", "flag: Argentina"),
            Fixtures.row("🇵🇹", "1F1F5-1F1F9", "flag: Portugal"),
            Fixtures.row("👻", "1F47B", "ghost"),
            Fixtures.row("🙇", "1F647", "person bowing", keyword = "apology|bow"),
            Fixtures.row("🏈", "1F3C8", "american football", shortcode = "football"),
        ),
    )

    private val goat = CultureEntry(
        id = "goat-football",
        context = "Football's greatest-of-all-time debate",
        triggers = listOf("goat", "greatest of all time"),
        emoji = listOf(
            CultureEmoji("🐐", "1F410", 0.7),
            CultureEmoji("⚽", "26BD", 0.6),
            CultureEmoji("🇦🇷", "1F1E6-1F1F7", 0.45),
            CultureEmoji("🇵🇹", "1F1F5-1F1F9", 0.45),
        ),
    )
    private val halloween = CultureEntry(
        id = "halloween",
        kind = CultureKind.SEASONAL,
        context = "Halloween, 31 October",
        window = CultureWindow("10-15", "10-31", "yearly"),
        triggers = listOf("halloween", "spooky season"),
        emoji = listOf(CultureEmoji("🎃", "1F383", 0.9), CultureEmoji("👻", "1F47B", 0.8)),
        featured = true,
    )
    private val bowJapan = CultureEntry(
        id = "thanks-bow-jp",
        context = "Thanks and apologies with a bow, as in Japan",
        regions = listOf("JP"),
        triggers = listOf("thank you"),
        emoji = listOf(CultureEmoji("🙇", "1F647", 0.7)),
    )
    private val newYear = CultureEntry(
        id = "new-year",
        kind = CultureKind.SEASONAL,
        context = "New Year",
        window = CultureWindow("12-26", "01-02", "yearly"),
        triggers = listOf("new year"),
        emoji = listOf(CultureEmoji("🎆", "1F386", 0.8), CultureEmoji("🥂", "1F942", 0.7)),
        featured = true,
    )

    private fun culture(entries: List<CultureEntry>, locale: String = "en") =
        Culture(packVersion = "test", locale = locale, from = "2026-10-02", until = "2026-10-16", entries = entries)

    /** A local date, like `new Date(year, monthIndex, day, hour)`. Gregorian whatever the default locale. */
    private fun date(year: Int, month: Int, day: Int, hour: Int = 0, minute: Int = 0): Long =
        GregorianCalendar(TimeZone.getDefault(), Locale.ROOT).apply {
            clear()
            set(year, month, day, hour, minute)
        }.timeInMillis

    /** Runs [block] with the device's language (and time zone), then restores both. */
    private inline fun onDevice(languageTag: String, timeZone: String? = null, block: () -> Unit) {
        val locale = Locale.getDefault()
        val zone = TimeZone.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag(languageTag))
            if (timeZone != null) TimeZone.setDefault(TimeZone.getTimeZone(timeZone))
            block()
        } finally {
            Locale.setDefault(locale)
            TimeZone.setDefault(zone)
        }
    }

    private val october20 = date(2026, 9, 20, 12)
    private fun ids(results: List<SearchResult>) = results.map { it.emoji }

    // ── Windows ──────────────────────────────────────────────────────────────────────────────

    @Test
    fun `treats lasting entries as always active`() {
        assertTrue(CultureLayer.isActiveOn(null, "2026-01-01"))
    }

    @Test
    fun `checks dated windows inclusively`() {
        val window = CultureWindow("2027-01-07", "2027-02-05")
        assertFalse(CultureLayer.isActiveOn(window, "2027-01-06"))
        assertTrue(CultureLayer.isActiveOn(window, "2027-01-07"))
        assertTrue(CultureLayer.isActiveOn(window, "2027-02-05"))
        assertFalse(CultureLayer.isActiveOn(window, "2027-02-06"))
    }

    @Test
    fun `repeats yearly windows every year and wraps them across the year end`() {
        val october = CultureWindow("10-15", "10-31", "yearly")
        assertTrue(CultureLayer.isActiveOn(october, "2026-10-31"))
        assertTrue(CultureLayer.isActiveOn(october, "2031-10-15"))
        assertFalse(CultureLayer.isActiveOn(october, "2026-11-01"))
        val newYearWindow = CultureWindow("12-26", "01-02", "yearly")
        assertFalse(CultureLayer.isActiveOn(newYearWindow, "2026-12-25"))
        assertTrue(CultureLayer.isActiveOn(newYearWindow, "2026-12-26"))
        assertTrue(CultureLayer.isActiveOn(newYearWindow, "2027-01-01"))
        assertTrue(CultureLayer.isActiveOn(newYearWindow, "2027-01-02"))
        assertFalse(CultureLayer.isActiveOn(newYearWindow, "2027-01-03"))
        assertFalse(CultureLayer.isActiveOn(newYearWindow, "2027-06-15"))
        val crossing = CultureWindow("2027-12-24", "2028-01-01")
        assertTrue(CultureLayer.isActiveOn(crossing, "2027-12-31"))
        assertTrue(CultureLayer.isActiveOn(crossing, "2028-01-01"))
        assertFalse(CultureLayer.isActiveOn(crossing, "2026-12-31"))
    }

    @Test
    fun `uses the local calendar day`() {
        assertEquals("2026-12-31", CultureLayer.localDay(date(2026, 11, 31, 23, 59)))
        assertEquals("2027-01-01", CultureLayer.localDay(date(2027, 0, 1, 0, 1)))
    }

    @Test
    fun `counts days in the Gregorian calendar whatever the default locale`() {
        val moment = date(2026, 9, 20, 12)
        // Calendar.getInstance() gives a Buddhist year (2569) in th-TH and an era year (8) in Japanese.
        for (tag in listOf("th-TH", "ja-JP-u-ca-japanese", "ja-JP-x-lvariant-JP")) {
            onDevice(tag) { assertEquals("2026-10-20", CultureLayer.localDay(moment), tag) }
        }
    }

    @Test
    fun `handles leap days in yearly and dated windows`() {
        assertEquals("2028-02-29", CultureLayer.localDay(date(2028, 1, 29, 12)))
        val aroundMarch = CultureWindow("02-25", "03-03", "yearly")
        assertTrue(CultureLayer.isActiveOn(aroundMarch, "2028-02-29"))
        assertTrue(CultureLayer.isActiveOn(aroundMarch, "2027-02-28"))
        assertTrue(CultureLayer.isActiveOn(aroundMarch, "2027-03-01"))
        val toFebruary28 = CultureWindow("02-20", "02-28", "yearly")
        assertTrue(CultureLayer.isActiveOn(toFebruary28, "2028-02-28"))
        assertFalse(CultureLayer.isActiveOn(toFebruary28, "2028-02-29"))
        val fromMarch = CultureWindow("03-01", "03-08", "yearly")
        assertFalse(CultureLayer.isActiveOn(fromMarch, "2028-02-29"))
        assertTrue(CultureLayer.isActiveOn(fromMarch, "2028-03-01"))
        val leapEvent = CultureWindow("2028-02-28", "2028-03-01")
        assertTrue(CultureLayer.isActiveOn(leapEvent, "2028-02-29"))
        assertFalse(CultureLayer.isActiveOn(leapEvent, "2028-03-02"))
    }

    @Test
    fun `checks an explicit day before now, and only a YYYY-MM-DD day`() {
        assertEquals("2026-10-20", CultureLayer.scopeDay(now = october20))
        assertEquals("2026-11-01", CultureLayer.scopeDay("2026-11-01", october20))
        assertFailsWith<EmojisenseException.InvalidData> { CultureLayer.scopeDay("2026-11-1") }
        val file = culture(listOf(halloween))
        assertEquals(emptyList(), CultureLayer.matchCulture(file, "halloween", ApplyCultureOptions(now = october20, day = "2026-11-01")))
        assertEquals(2, CultureLayer.matchCulture(file, "halloween", ApplyCultureOptions(now = date(2026, 4, 1), day = "2026-10-31")).size)
    }

    // ── matchCulture ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `matches exact triggers on the normalized query`() {
        val results = CultureLayer.matchCulture(culture(listOf(goat)), "  Greatest of ALL time! ")
        assertEquals(listOf("🐐", "⚽", "🇦🇷", "🇵🇹"), ids(results))
        val first = results.first()
        assertEquals(ResultSource.CULTURE, first.source)
        assertEquals("goat-football", first.cultureId)
        assertEquals("Football's greatest-of-all-time debate", first.context)
        assertEquals("greatest of all time", first.match)
        assertEquals(0.7, first.score)
    }

    @Test
    fun `completes a trigger while typing, but not from short or tiny prefixes`() {
        val atHalloween = ApplyCultureOptions(now = october20)
        assertEquals(listOf("🎃", "👻"), ids(CultureLayer.matchCulture(culture(listOf(halloween)), "hallo", atHalloween)))
        assertTrue(CultureLayer.matchCulture(culture(listOf(halloween)), "hallo", atHalloween).first().score < 0.9)
        assertEquals(emptyList(), CultureLayer.matchCulture(culture(listOf(halloween)), "hal", atHalloween))
        assertEquals(emptyList(), CultureLayer.matchCulture(culture(listOf(goat)), "go"))
        assertEquals(emptyList(), CultureLayer.matchCulture(culture(listOf(halloween)), "hallo ", atHalloween))
        assertEquals(emptyList(), CultureLayer.matchCulture(culture(listOf(halloween)), "hallo", atHalloween.copy(prefix = false)))
    }

    @Test
    fun `applies seasonal entries only inside their window`() {
        assertEquals(emptyList(), CultureLayer.matchCulture(culture(listOf(halloween)), "halloween", ApplyCultureOptions(now = date(2026, 9, 1))))
        assertEquals(2, CultureLayer.matchCulture(culture(listOf(halloween)), "halloween", ApplyCultureOptions(now = october20)).size)
        assertEquals(2, CultureLayer.matchCulture(culture(listOf(newYear)), "new year", ApplyCultureOptions(now = date(2027, 0, 1, 10))).size)
    }

    @Test
    fun `applies regional entries only with a matching region`() {
        val file = culture(listOf(bowJapan))
        assertEquals(emptyList(), CultureLayer.matchCulture(file, "thank you"))
        assertEquals(emptyList(), CultureLayer.matchCulture(file, "thank you", ApplyCultureOptions(region = "US")))
        assertEquals(listOf("🙇"), ids(CultureLayer.matchCulture(file, "thank you", ApplyCultureOptions(region = "jp"))))
    }

    @Test
    fun `keeps the strongest entry per emoji and caps the count`() {
        val other = CultureEntry(id = "a", triggers = listOf("goat"), emoji = listOf(CultureEmoji("⚽", "26BD", 0.9)))
        val results = CultureLayer.matchCulture(culture(listOf(goat, other)), "goat", ApplyCultureOptions(limit = 2))
        assertEquals(listOf("⚽" to "a", "🐐" to "goat-football"), results.map { it.emoji to it.cultureId })
    }

    // ── matchCultureInText ───────────────────────────────────────────────────────────────────

    private val thanks = bowJapan.copy(triggers = listOf("thank you", "thanks"))
    private val midAutumn = CultureEntry(
        id = "mid-autumn",
        context = "Mid-Autumn Festival",
        triggers = listOf("中秋节"),
        emoji = listOf(CultureEmoji("🥮", "1F96E", 0.9)),
    )

    @Test
    fun `finds a trigger as whole words inside a message`() {
        val file = culture(listOf(thanks, goat))
        assertEquals(listOf("🙇"), ids(CultureLayer.matchCultureInText(file, "Thanks so much for the help!", ApplyCultureOptions(region = "JP"))))
        assertEquals(listOf("🐐", "⚽", "🇦🇷", "🇵🇹"), ids(CultureLayer.matchCultureInText(file, "he is the goat, no debate")))
    }

    @Test
    fun `never matches part of a word`() {
        assertEquals(emptyList(), CultureLayer.matchCultureInText(culture(listOf(thanks)), "happy thanksgiving", ApplyCultureOptions(region = "JP")))
    }

    @Test
    fun `keeps the region and the window`() {
        val file = culture(listOf(thanks, halloween))
        assertEquals(emptyList(), CultureLayer.matchCultureInText(file, "thanks a lot"))
        assertEquals(emptyList(), CultureLayer.matchCultureInText(file, "ready for halloween?", ApplyCultureOptions(day = "2026-10-01")))
        assertEquals("🎃", CultureLayer.matchCultureInText(file, "ready for halloween?", ApplyCultureOptions(day = "2026-10-20")).firstOrNull()?.emoji)
    }

    @Test
    fun `matches triggers of a script without spaces anywhere in the text`() {
        val file = culture(listOf(midAutumn), "zh")
        assertEquals("中秋节", CultureLayer.matchCultureInText(file, "祝大家中秋节快乐").firstOrNull()?.match)
    }

    @Test
    fun `names the longest trigger that matched`() {
        assertEquals(
            "thank you",
            CultureLayer.matchCultureInText(culture(listOf(thanks)), "thank you, thanks!", ApplyCultureOptions(region = "JP")).firstOrNull()?.match,
        )
        val shortFirst = thanks.copy(triggers = listOf("thanks", "thank you"))
        assertEquals(
            "thank you",
            CultureLayer.matchCultureInText(culture(listOf(shortFirst)), "thank you, thanks!", ApplyCultureOptions(region = "JP")).firstOrNull()?.match,
        )
    }

    @Test
    fun `adds after the top reaction in applyCulture, with no regional lead`() {
        val top = EmojiResult("🙏", "1F64F", 0.9, ResultSource.SEMANTIC)
        val merged = CultureLayer.applyCulture(listOf(top), culture(listOf(thanks)), "thanks so much!", ApplyCultureOptions(region = "JP", text = true))
        assertEquals(listOf("🙏", "🙇"), ids(merged))
        val football = culture(listOf(footballSoccer))
        val canonical = listOf(EmojiResult("🏈", "1F3C8", 1.0, ResultSource.ALIAS))
        assertEquals(listOf("⚽", "🏈"), ids(CultureLayer.applyCulture(canonical, football, "football", ApplyCultureOptions(region = "GB"))))
        assertEquals(listOf("🏈", "⚽"), ids(CultureLayer.applyCulture(canonical, football, "football", ApplyCultureOptions(region = "GB", text = true))))
    }

    // ── insertCulture ────────────────────────────────────────────────────────────────────────

    private val canonical = listOf(
        EmojiResult("🐐", "1F410", 1.0, ResultSource.ALIAS),
        EmojiResult("♑", "2651", 0.89, ResultSource.ALIAS),
        EmojiResult("⚽", "26BD", 0.5, ResultSource.ALIAS),
    )
    private val goatMatches get() = CultureLayer.matchCulture(culture(listOf(goat)), "goat")

    @Test
    fun `adds culture results right after the canonical top result, never above it`() {
        val merged = CultureLayer.insertCulture(canonical, goatMatches)
        assertEquals(listOf("🐐", "⚽", "🇦🇷", "🇵🇹", "♑"), ids(merged))
        assertEquals(ResultSource.ALIAS, merged[0].source)
        assertEquals(goat.context, (merged[1] as CultureResult).context)
    }

    @Test
    fun `puts culture results first only when the canonical list is empty, and cuts to the limit`() {
        assertEquals(listOf("🐐", "⚽", "🇦🇷", "🇵🇹"), ids(CultureLayer.insertCulture(emptyList(), goatMatches)))
        assertEquals(3, CultureLayer.insertCulture(canonical, goatMatches, 3).size)
    }

    // ── Regional senses ──────────────────────────────────────────────────────────────────────

    private val footballSoccer = CultureEntry(
        id = "football-soccer",
        kind = CultureKind.REGIONAL,
        context = "Outside North America, football means soccer",
        regions = listOf("*"),
        exceptRegions = listOf("US", "CA"),
        triggers = listOf("football"),
        emoji = listOf(CultureEmoji("⚽", "26BD", 0.9)),
        outranks = listOf("1F3C8"),
    )
    private val pantsUk = CultureEntry(
        id = "pants-underwear",
        kind = CultureKind.REGIONAL,
        context = "In Britain, pants are underwear",
        regions = listOf("GB"),
        triggers = listOf("pants"),
        emoji = listOf(CultureEmoji("👻", "1F47B", 0.8)),
        outranks = listOf("1F410"),
    )
    private val regionalEngine by lazy { AliasEngine(listOf(pack)).withCulture(culture(listOf(footballSoccer, pantsUk, goat))) }

    /** `""`: no region, whatever the device's region is. */
    private fun top2(query: String, region: String = "") =
        ids(regionalEngine.search(query, AliasSearchOptions(prefix = false, region = region)).results.take(2))

    @Test
    fun `keeps the canonical answer first without a region`() {
        assertEquals(listOf("🏈"), ids(regionalEngine.search("football", AliasSearchOptions(culture = false)).results.take(1)))
        assertEquals(listOf("🏈", "⚽"), top2("football"))
    }

    @Test
    fun `leads with the regional sense in its regions, and keeps the canonical answer second`() {
        val results = regionalEngine.search("football", AliasSearchOptions(region = "gb")).results
        assertEquals(listOf("⚽", "🏈"), ids(results.take(2)))
        val lead = results[0] as CultureResult
        assertEquals("football-soccer", lead.cultureId)
        assertEquals("Outside North America, football means soccer", lead.context)
        assertEquals("soccer ball", lead.label)
        assertEquals(1, ids(results).count { it == "⚽" })
    }

    @Test
    fun `changes nothing in the regions it excludes`() {
        assertEquals(listOf("🏈", "⚽"), top2("football", "US"))
        assertEquals("🏈", top2("football", "CA")[0])
    }

    @Test
    fun `needs the whole trigger, not a prefix being typed`() {
        assertEquals("🏈", regionalEngine.search("footba", AliasSearchOptions(region = "GB")).results[0].emoji)
    }

    @Test
    fun `leads only over the canonical answers it names`() {
        val file = culture(listOf(pantsUk))
        assertNull(CultureLayer.matchRegionalLead(file, "pants", "1F456", "GB"))
        assertEquals("👻", CultureLayer.matchRegionalLead(file, "pants", "1F410", "GB")?.emoji)
        assertNull(CultureLayer.matchRegionalLead(file, "pants", "1F410", "IE"))
        assertNull(CultureLayer.matchRegionalLead(file, "pants", "1F410", null))
    }

    @Test
    fun `never leads for other kinds, even in their region`() {
        assertNull(CultureLayer.matchRegionalLead(culture(listOf(bowJapan)), "thank you", "1F44D", "JP"))
    }

    @Test
    fun `is off with culture false and keeps the canonical answer within a short limit`() {
        assertEquals("🏈", regionalEngine.search("football", AliasSearchOptions(region = "GB", culture = false)).results[0].emoji)
        assertEquals(listOf("⚽", "🏈"), ids(regionalEngine.search("football", AliasSearchOptions(region = "GB", limit = 2)).results))
    }

    @Test
    fun `follows the session region`() = runTest {
        val states = mutableListOf<SessionState>()
        SearchSession(regionalEngine, this, region = "DE", onChange = { states.add(it) }).update("football")
        assertEquals(listOf("⚽", "🏈"), ids(states[0].results).take(2))
    }

    /** An API that answers 🏈 and finds the region of the request. */
    private fun apiWithRegion(region: String?, requests: MutableList<SemanticSearchOptions>) = SemanticProvider { _, options ->
        requests.add(options)
        SemanticResponse(
            results = listOf(EmojiResult("🏈", "1F3C8", 0.9, ResultSource.SEMANTIC)),
            packVersion = "test",
            layer = SemanticLayer.API,
            region = region,
        )
    }

    @Test
    fun `learns the region from the API with region auto`() = runTest {
        val requests = mutableListOf<SemanticSearchOptions>()
        val states = mutableListOf<SessionState>()
        val session = SearchSession(
            regionalEngine,
            this,
            semantic = apiWithRegion("DE", requests),
            debounceMillis = 10,
            region = "auto",
            shouldUseSemantic = { true },
            onChange = { states.add(it) },
        )
        session.update("football")
        assertEquals(listOf("🏈", "⚽"), ids(states.last().results).take(2))
        advanceTimeBy(50)
        runCurrent()
        assertEquals(SessionStatus.FUSED, states.last().status)
        assertEquals(listOf("⚽", "🏈"), ids(states.last().results).take(2))
        assertEquals(listOf("auto"), requests.map { it.region })
        session.update("football")
        assertEquals(listOf("⚽", "🏈"), ids(states.last().results).take(2))
    }

    @Test
    fun `keeps an explicit region on the device and over the API region`() = runTest {
        val requests = mutableListOf<SemanticSearchOptions>()
        val states = mutableListOf<SessionState>()
        val session = SearchSession(
            regionalEngine,
            this,
            semantic = apiWithRegion("DE", requests),
            debounceMillis = 10,
            region = "US",
            shouldUseSemantic = { true },
            onChange = { states.add(it) },
        )
        session.update("football")
        advanceTimeBy(50)
        runCurrent()
        assertEquals(SessionStatus.FUSED, states.last().status)
        assertEquals(listOf("🏈", "⚽"), ids(states.last().results).take(2))
        assertEquals(listOf<String?>(null), requests.map { it.region })
    }

    // ── Engine with culture ──────────────────────────────────────────────────────────────────

    private val file = culture(listOf(goat, halloween, CultureEntry(id = "x", triggers = listOf("goat"), emoji = listOf(CultureEmoji("🦄", "1F984", 1.0)))))
    private val cultureEngine by lazy { AliasEngine(listOf(pack), culture = file) }

    @Test
    fun `adds context after the canonical top result`() {
        val output = cultureEngine.search("goat")
        assertEquals(listOf("🐐", "⚽", "🇦🇷", "🇵🇹"), ids(output.results))
        val second = output.results[1] as CultureResult
        assertEquals("soccer ball", second.label)
        assertEquals("goat-football", second.cultureId)
        assertEquals(cultureEngine.search("goat", AliasSearchOptions(culture = false)).confidence, output.confidence)
    }

    @Test
    fun `drops culture emoji the packs do not have and opts out with culture false`() {
        assertFalse("🦄" in ids(cultureEngine.search("goat").results))
        assertEquals(listOf("🐐"), ids(cultureEngine.search("goat", AliasSearchOptions(culture = false)).results))
    }

    @Test
    fun `shares the index with withCulture`() {
        val plain = cultureEngine.withCulture(null)
        assertNull(plain.culture)
        assertTrue(plain.entries === cultureEngine.entries)
        assertEquals(listOf("🐐"), ids(plain.search("goat").results))
        assertEquals(4, plain.withCulture(file).search("goat").results.size)
    }

    @Test
    fun `respects the search limit and the window of seasonal entries`() {
        assertEquals(2, cultureEngine.search("goat", AliasSearchOptions(limit = 2)).results.size)
        assertEquals(listOf("🎃", "👻"), ids(cultureEngine.search("halloween", AliasSearchOptions(now = october20)).results))
        assertNotEquals(ResultSource.CULTURE, cultureEngine.search("halloween", AliasSearchOptions(now = date(2026, 5, 1))).results.getOrNull(1)?.source)
    }

    // ── Session with culture ─────────────────────────────────────────────────────────────────

    @Test
    fun `applies culture after fusion, so the canonical top result stays first`() = runTest {
        val semanticFirst = SemanticProvider { _, _ ->
            SemanticResponse(
                results = listOf(
                    EmojiResult("🇵🇹", "1F1F5-1F1F9", 0.9, ResultSource.SEMANTIC),
                    EmojiResult("🐐", "1F410", 0.8, ResultSource.SEMANTIC),
                ),
                packVersion = "test",
            )
        }
        val states = mutableListOf<SessionState>()
        val session = SearchSession(
            engine = AliasEngine(listOf(pack)).withCulture(culture(listOf(goat))),
            scope = this,
            semantic = semanticFirst,
            debounceMillis = 10,
            shouldUseSemantic = { true },
            onChange = { states.add(it) },
        )
        session.update("greatest of all time")
        assertEquals(listOf("🐐", "⚽", "🇦🇷", "🇵🇹"), ids(states[0].results))
        assertTrue(states[0].alias.results.all { it.source == ResultSource.ALIAS })
        advanceTimeBy(50)
        runCurrent()
        val fused = states.last()
        assertEquals(SessionStatus.FUSED, fused.status)
        assertEquals("🐐", fused.results[0].emoji)
        assertEquals(List(3) { ResultSource.CULTURE }, fused.results.subList(1, 4).map { it.source })
    }

    @Test
    fun `turns culture off with a null culture and passes the region to regional entries`() = runTest {
        val states = mutableListOf<SessionState>()
        SearchSession(AliasEngine(listOf(pack), culture = culture(listOf(goat))), this, culture = null, onChange = { states.add(it) }).update("goat")
        assertEquals(listOf("🐐"), ids(states[0].results))
        SearchSession(AliasEngine(listOf(pack)), this, culture = culture(listOf(bowJapan)), region = "JP", onChange = { states.add(it) }).update("thank you")
        assertEquals(listOf("🙇"), ids(states.last().results))
    }

    @Test
    fun `uses the device's region by default, and none with an empty region`() = runTest {
        onDevice("en-JP") {
            fun search(region: String?): List<String> {
                val states = mutableListOf<SessionState>()
                SearchSession(AliasEngine(listOf(pack)), this, culture = culture(listOf(bowJapan)), region = region, onChange = { states.add(it) })
                    .update("thank you")
                return ids(states[0].results)
            }
            assertEquals(listOf("🙇"), search(null))
            assertEquals(listOf("🙇"), search("device"))
            assertEquals(emptyList(), search(""))
        }
    }

    @Test
    fun `uses the device's region in an engine search by default, and none with an empty region`() {
        val engine = AliasEngine(listOf(pack), culture = culture(listOf(bowJapan)))
        onDevice("en-JP") {
            assertEquals(listOf("🙇"), ids(engine.search("thank you").results))
            assertEquals(listOf("🙇"), ids(engine.search("thank you", AliasSearchOptions(region = "Device")).results))
            assertEquals(emptyList(), ids(engine.search("thank you", AliasSearchOptions(region = "")).results))
        }
        onDevice("ja", "Asia/Tokyo") {
            assertEquals(emptyList(), ids(engine.search("thank you").results))
            val zoned = engine.withCulture(engine.culture?.copy(zones = mapOf("Asia/Tokyo" to "JP")))
            assertEquals(listOf("🙇"), ids(zoned.search("thank you").results))
        }
    }

    @Test
    fun `checks windows against its clock`() = runTest {
        val states = mutableListOf<SessionState>()
        var now = date(2026, 9, 1, 12)
        val session = SearchSession(AliasEngine(listOf(pack)), this, culture = culture(listOf(halloween)), clock = { now }, onChange = { states.add(it) })
        session.update("halloween")
        assertEquals(listOf("🎃"), ids(states.last().results))
        now = october20
        session.update("halloween")
        assertEquals(listOf("🎃", "👻"), ids(states.last().results))
    }

    // ── relevantNow ──────────────────────────────────────────────────────────────────────────

    private val shelfFiles by lazy {
        listOf(
            culture(
                listOf(
                    goat,
                    halloween,
                    newYear.copy(id = "dia", window = halloween.window, emoji = listOf(CultureEmoji("🎃", "1F383", 1.0), CultureEmoji("💀", "1F480", 0.9))),
                ),
            ),
            culture(listOf(halloween), "es"),
        )
    }

    @Test
    fun `lists featured seasonal entries active now, one emoji per entry in turn`() {
        assertEquals(
            listOf("🎃" to "halloween", "👻" to "halloween", "💀" to "dia"),
            CultureLayer.relevantNow(shelfFiles, RelevantNowOptions(now = october20)).map { it.emoji to it.cultureId },
        )
    }

    @Test
    fun `is empty outside every window and never lists lasting entries`() {
        assertEquals(emptyList(), CultureLayer.relevantNow(shelfFiles, RelevantNowOptions(now = date(2026, 4, 1))))
    }

    @Test
    fun `picks the file of the locale and honours limit and region`() {
        assertEquals(1, CultureLayer.relevantNow(shelfFiles, RelevantNowOptions(locale = "es", now = october20, limit = 1)).size)
        assertEquals(emptyList(), CultureLayer.relevantNow(shelfFiles, RelevantNowOptions(locale = "fr", now = october20)))
        val regional = culture(listOf(halloween.copy(regions = listOf("US"))))
        assertEquals(emptyList(), CultureLayer.relevantNow(regional, RelevantNowOptions(now = october20)))
        assertEquals(2, CultureLayer.relevantNow(regional, RelevantNowOptions(now = october20, region = "us")).size)
    }

    // ── One culture file for twelve months ───────────────────────────────────────────────────

    private val diwali = CultureEntry(
        id = "diwali-2026",
        kind = CultureKind.EVENT,
        context = "Diwali 2026",
        window = CultureWindow("2026-10-30", "2026-11-11"),
        triggers = listOf("diwali"),
        emoji = listOf(CultureEmoji("🪔", "1FA94", 0.9)),
        featured = true,
    )

    /** Built on 2026-10-02 for 366 days: every yearly entry, the events of the next 12 months, no snapshot. */
    private val yearFile by lazy { culture(listOf(diwali, halloween, newYear, goat)).copy(until = "2027-10-03") }

    private fun at(year: Int, month: Int, day: Int, hour: Int = 12) = date(year, month - 1, day, hour)

    private fun on(now: Long) = yearFile.entries
        .filter { CultureLayer.matchCulture(yearFile, it.triggers.firstOrNull() ?: "", ApplyCultureOptions(now = now, prefix = false)).isNotEmpty() }
        .map { it.id }

    private fun shelf(now: Long) = CultureLayer.relevantNow(yearFile, RelevantNowOptions(now = now)).map { it.cultureId }.distinct()

    @Test
    fun `switches a seasonal entry on the day it starts, with the same file`() {
        assertEquals(listOf("goat-football"), on(at(2026, 10, 14)))
        assertEquals(listOf("halloween", "goat-football"), on(at(2026, 10, 15)))
        assertEquals(emptyList(), shelf(at(2026, 10, 14)))
        assertEquals(listOf("halloween"), shelf(at(2026, 10, 15)))
        assertEquals(listOf("diwali-2026", "goat-football"), on(at(2026, 11, 1)))
    }

    @Test
    fun `follows the local day, not the hour, and drops an event the day after it ends`() {
        assertFalse("halloween" in on(at(2026, 10, 14, 23)))
        assertTrue("halloween" in on(date(2026, 9, 15, 0, 1)))
        assertTrue("diwali-2026" in on(at(2026, 11, 11)))
        assertEquals(listOf("diwali-2026"), shelf(at(2026, 11, 11)))
        assertFalse("diwali-2026" in on(at(2026, 11, 12)))
        assertEquals(emptyList(), shelf(at(2026, 11, 12)))
    }

    @Test
    fun `crosses the year end and starts the next season again`() {
        assertEquals(listOf("goat-football"), on(at(2026, 12, 25)))
        assertEquals(listOf("new-year", "goat-football"), on(date(2026, 11, 31, 23, 59)))
        assertEquals(listOf("new-year", "goat-football"), on(at(2027, 1, 2)))
        assertEquals(listOf("goat-football"), on(at(2027, 1, 3)))
        assertEquals(listOf("halloween", "goat-football"), on(at(2027, 10, 15)))
    }

    @Test
    fun `follows the day in a long-lived session`() = runTest {
        var now = date(2026, 9, 14, 23, 59)
        val states = mutableListOf<SessionState>()
        val session = SearchSession(AliasEngine(listOf(pack)).withCulture(yearFile), this, clock = { now }, onChange = { states.add(it) })
        session.update("halloween")
        now = date(2026, 9, 15, 0, 1)
        session.update("halloween")
        assertEquals(listOf(false, true), states.map { state -> state.results.any { it.source == ResultSource.CULTURE } })
    }

    @Test
    fun `checks the windows of a file built the old way and ignores its relevantNow list`() {
        val oldStyle = culture(listOf(halloween)).copy(from = "2026-10-20", until = "2026-11-03", relevantNow = listOf("halloween"))
        assertEquals(2, CultureLayer.relevantNow(oldStyle, RelevantNowOptions(now = at(2026, 10, 20))).size)
        assertEquals(emptyList(), CultureLayer.relevantNow(oldStyle, RelevantNowOptions(now = at(2026, 11, 5))))
    }

    // ── Files ────────────────────────────────────────────────────────────────────────────────

    private val fileJson = """{"format":"emojisense-culture","formatVersion":1,"packVersion":"0.1.0","locale":"es",
        "from":"2026-10-02","until":"2026-10-16","entries":[
        {"id":"goat-football","kind":"lasting","context":"El debate","when":null,"regions":["*"],
         "triggers":["goat","el goat"],"emoji":[["🐐","1F410",0.7],["⚽","26BD",0.6]]},
        {"id":"halloween","kind":"seasonal","context":"Halloween","when":{"from":"10-15","to":"10-31","recurs":"yearly"},
         "regions":["*"],"triggers":["halloween"],"emoji":[["🎃","1F383",0.9]],"featured":true},
        {"id":"futbol","kind":"regional","context":"Fútbol","when":null,"regions":["*"],"exceptRegions":["US"],
         "triggers":["football"],"emoji":[["⚽","26BD",0.9]],"outranks":["1F3C8"]},
        {"id":"future","kind":"someday","context":"A kind from a newer file","when":null,"regions":["*"],
         "triggers":["x"],"emoji":[]}],
        "relevantNow":["halloween"]}"""

    @Test
    fun `decodes a culture file`() {
        val decoded = Culture.fromJson(fileJson)
        assertEquals("es", decoded.locale)
        assertEquals(listOf("halloween"), decoded.relevantNow)
        assertEquals(CultureWindow("10-15", "10-31", "yearly"), decoded.entries[1].window)
        assertTrue(decoded.entries[1].featured)
        assertEquals(listOf("US"), decoded.entries[2].exceptRegions)
        assertEquals(CultureKind.REGIONAL, decoded.entries[2].kind)
        // A kind this SDK does not know acts as a lasting entry.
        assertEquals(CultureKind.LASTING, decoded.entries[3].kind)
        assertEquals(CultureEmoji("🐐", "1F410", 0.7), decoded.entries[0].emoji[0])
    }

    @Test
    fun `fetches culture locale json from the base URL`() = runBlocking {
        val transport = StubTransport.json(fileJson)
        val loaded = CultureLayer.loadCulture("https://x.test/v1/culture/0.1.0/", "es", transport)
        assertEquals(listOf("https://x.test/v1/culture/0.1.0/culture.es.json"), transport.requests)
        assertEquals(4, loaded.entries.size)
    }

    @Test
    fun `rejects HTTP errors and other files`() = runBlocking {
        val status = assertFailsWith<EmojisenseException.HttpStatus> {
            CultureLayer.loadCulture("https://x.test", "en", StubTransport.json("", status = 404))
        }
        assertTrue("HTTP 404" in status.message.orEmpty())
        assertFailsWith<EmojisenseException.InvalidFormat> {
            CultureLayer.loadCulture("https://x.test", "en", StubTransport.json(Fixtures.CUSTOM_JSON))
        }
        Unit
    }

    @Test
    fun `refuses locales that are not plain locale tags, before any request`() = runBlocking {
        val transport = StubTransport.json(fileJson)
        for (locale in listOf("../../v1/pack/0.1.0/pack.en", "en/../x", "en?x=1", "en#", "EN", "", "e")) {
            assertFailsWith<EmojisenseException.InvalidLocale>(locale) { CultureLayer.loadCulture("https://x.test", locale, transport) }
        }
        assertEquals(0, transport.requests.size)
        CultureLayer.loadCulture("https://x.test", "pt-BR", transport)
        assertEquals(listOf("https://x.test/culture.pt-BR.json"), transport.requests)
    }

    // ── Regions ──────────────────────────────────────────────────────────────────────────────

    @Test
    fun `reads the two-letter region subtag of a locale tag`() {
        assertEquals("BR", CultureLayer.regionOf("pt-BR"))
        assertEquals("TW", CultureLayer.regionOf("zh-Hant-TW"))
        assertEquals("US", CultureLayer.regionOf("en-us"))
        assertEquals("CH", CultureLayer.regionOf("de-CH-1996"))
        assertEquals("GB", CultureLayer.regionOf("en-GB-u-ca-gregory"))
    }

    @Test
    fun `gives no region without a two-letter region subtag`() {
        for (tag in listOf("en", "zh-Hans", "es-419", "", "not a tag")) assertNull(CultureLayer.regionOf(tag), tag)
    }

    @Test
    fun `derives the device region from the default locale`() {
        onDevice("pt-BR") { assertEquals("BR", CultureLayer.deviceRegion()) }
        onDevice("fr") { assertNull(CultureLayer.deviceRegion()) }
    }

    @Test
    fun `falls back to the time zone when the language has no region`() {
        onDevice("ja", "Asia/Tokyo") {
            assertEquals("JP", CultureLayer.deviceRegion(mapOf("Asia/Tokyo" to "JP")))
            assertNull(CultureLayer.deviceRegion(mapOf("Not/A_Zone" to "JP")))
            assertNull(CultureLayer.deviceRegion())
        }
        onDevice("en-CA", "Asia/Tokyo") { assertEquals("CA", CultureLayer.deviceRegion(mapOf("Asia/Tokyo" to "JP"))) }
    }

    @Test
    fun `resolves an app's region option`() {
        onDevice("en-IN") {
            assertEquals("IN", CultureLayer.resolveRegion(null))
            assertEquals("IN", CultureLayer.resolveRegion(CultureLayer.DEVICE_REGION))
            assertEquals("IN", CultureLayer.resolveRegion("DEVICE"))
            assertNull(CultureLayer.resolveRegion(""))
            assertEquals("BR", CultureLayer.resolveRegion("BR"))
            assertEquals("auto", CultureLayer.resolveRegion("auto"))
        }
        onDevice("ja", "Asia/Tokyo") {
            val zoned = culture(emptyList()).copy(zones = mapOf("Asia/Tokyo" to "JP"))
            assertEquals("JP", CultureLayer.resolveRegion(null, zoned))
            assertNull(CultureLayer.resolveRegion(null))
        }
    }

    @Test
    fun `decodes the time zones of a culture file, and none from an older file`() {
        assertEquals(emptyMap(), Culture.fromJson(fileJson).zones)
        val zoned = fileJson.replace("\"relevantNow\"", "\"zones\":{\"Asia/Tokyo\":\"JP\",\"Europe/Lisbon\":\"PT\",\"Odd/Value\":7},\"relevantNow\"")
        assertEquals(mapOf("Asia/Tokyo" to "JP", "Europe/Lisbon" to "PT"), Culture.fromJson(zoned).zones)
    }

    // ── cultureUrlFor ────────────────────────────────────────────────────────────────────────

    @Test
    fun `finds the culture directory next to a pack directory`() {
        assertEquals("https://api.emojisense.com/v1/culture/0.1.0", CultureLayer.cultureUrlFor("https://api.emojisense.com/v1/pack/0.1.0"))
        assertEquals("/v1/culture/0.1.0", CultureLayer.cultureUrlFor("/v1/pack/0.1.0/"))
    }

    @Test
    fun `gives no culture directory for other layouts`() {
        assertNull(CultureLayer.cultureUrlFor("https://packs.test/0.1.0"))
        assertNull(CultureLayer.cultureUrlFor("https://example.com/packs/0.1.0"))
    }
}
