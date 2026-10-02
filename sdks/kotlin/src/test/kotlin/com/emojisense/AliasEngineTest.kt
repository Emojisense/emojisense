package com.emojisense

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ports packages/core/test/engine.test.ts (and the Swift AliasEngineTests). */
class AliasEngineTest {
    private val engine = AliasEngine(listOf(Fixtures.english, Fixtures.turkish))

    private fun top(query: String, locale: String? = null): List<String> =
        engine.search(query, AliasSearchOptions(locale = locale)).results.map { it.emoji }

    @Test
    fun `ranks an exact name first`() {
        assertEquals("🔥", top("fire").first())
        assertTrue("🚒" in top("fire"))
    }

    @Test
    fun `matches shortcodes and aliases`() {
        assertEquals("👍", top("+1").first())
        assertEquals("👍", top("lgtm").first())
        assertEquals("🚀", top("ship it").first())
        assertEquals("🦖", top("jurassic park").first())
    }

    @Test
    fun `weights rare words over stopwords`() {
        assertEquals("🐐", top("greatest of all time").first())
        assertEquals("🚀", top("the moon").first())
    }

    @Test
    fun `completes the token being typed`() {
        assertEquals("🚀", top("rock").first())
        assertEquals("🦖", top("jurassic pa").first())
    }

    @Test
    fun `does not prefix-complete after a trailing space`() {
        assertEquals(emptyList(), top("rock "))
        assertEquals(emptyList(), top("rock　"))
    }

    @Test
    fun `tolerates typos`() {
        assertEquals("🎃", top("hallowelen").first())
        assertEquals("🚀", top("rockt").first())
        assertEquals("👍", top("thumbs upp").first())
        assertEquals("🦖", top("dinasour").first())
    }

    @Test
    fun `searches across locales and prefers the active one`() {
        assertEquals("🎂", top("doğum günü", "tr").first())
        assertEquals("🎂", top("dogum gunu", "tr").first())
        assertEquals("🎂", top("iyi ki doğdun", "tr").first())
        assertEquals("🚀", top("rocket", "tr").first())
    }

    @Test
    fun `returns per-locale labels`() {
        val result = engine.canonicalSearch("tamam", AliasSearchOptions(locale = "tr")).results.first()
        assertEquals("baş parmak yukarıda", result.label)
    }

    @Test
    fun `returns nothing for empty or emoji-only queries`() {
        assertEquals(emptyList(), engine.search("").results)
        assertEquals(emptyList(), engine.search("🚀").results)
    }

    @Test
    fun `reports confidence and the matching phrase`() {
        val output = engine.canonicalSearch("jurassic park")
        assertTrue(output.confidence > 0.7)
        assertEquals("jurassic park", output.results.first().match)
        assertEquals(Field.ALIAS, output.results.first().field)
        assertEquals(0.0, engine.search("qxzvbn").confidence)
    }

    @Test
    fun `respects the limit`() {
        assertEquals(1, engine.search("f", AliasSearchOptions(limit = 1)).results.size)
    }

    @Test
    fun `merges an extension pack of the same locale without a locale penalty`() {
        val extension = Fixtures.english.copy(
            part = PackPart.EXT,
            emoji = listOf(Fixtures.row("🐐", "1F410", "", alias = "the goat")),
        )
        val withExtension = AliasEngine(listOf(Fixtures.english, Fixtures.turkish), listOf(extension))
        val goat = withExtension.search("the goat", AliasSearchOptions(locale = "en")).results.first()
        assertEquals("🐐", goat.emoji)
        assertTrue(goat.score > 0.75)
        assertEquals("goat", withExtension.entry("1F410")?.labels?.get("en"))
        assertEquals(listOf("en", "tr"), withExtension.locales)
    }

    @Test
    fun `adds the evidence bonus only for phrases of the preferred locale`() {
        // 🧛 comes first in row order, so a tie would rank it above 🎃.
        val english = Fixtures.english.copy(
            emoji = listOf(
                Fixtures.row("🧛", "1F9DB", "vampire", keyword = "halloween"),
                Fixtures.row("🎃", "1F383", "jack-o-lantern", keyword = "halloween|pumpkin", alias = "happy halloween"),
            ),
        )
        val spanish = Fixtures.english.copy(
            locale = "es",
            emoji = listOf(
                Fixtures.row("🧛", "1F9DB", "vampiro", alias = "fiesta de halloween|disfraz de halloween|noche de halloween"),
            ),
        )
        val multi = AliasEngine(listOf(english, spanish))
        val first = { locale: String -> multi.search("halloween", AliasSearchOptions(locale = locale)).results.first().emoji }
        assertEquals("🎃", first("en"))
        assertEquals("🧛", first("es"))
    }

    @Test
    fun `ranks an exact preferred match above an exact match only another pack has`() {
        val english = Fixtures.english.copy(
            emoji = listOf(
                Fixtures.row("🦶", "1F9B6", "foot"),
                Fixtures.row("🏈", "1F3C8", "american football", shortcode = "football"),
                Fixtures.row("⚽", "26BD", "soccer ball", keyword = "soccer"),
            ),
        )
        val french = Fixtures.english.copy(
            locale = "fr",
            emoji = listOf(
                Fixtures.row("🦶", "1F9B6", "pied"),
                Fixtures.row("🏈", "1F3C8", "football américain", keyword = "ballon ovale"),
                Fixtures.row("⚽", "26BD", "ballon de football", keyword = "football", alias = "foot"),
            ),
        )
        val multi = AliasEngine(listOf(english, french))
        val top = { query: String, locale: String ->
            multi.search(query, AliasSearchOptions(locale = locale, prefix = false)).results.map { "${it.emoji} ${it.score}" }
        }
        assertEquals(listOf("⚽ 0.8", "🦶 0.79"), top("foot", "fr").take(2))
        assertEquals(listOf("⚽ 0.87", "🏈 0.86"), top("football", "fr").take(2))
        assertEquals("⚽ 0.782", top("soccer", "fr").first())
        assertEquals("🦶 1.0", top("foot", "en").first())
    }

    @Test
    fun `keeps the whole-query alias above a partial name match the evidence lifts`() {
        val english = Fixtures.english.copy(
            emoji = listOf(
                Fixtures.row("🚢", "1F6A2", "ship", alias = "cargo ship|cruise ship|container ship|i ship it"),
                Fixtures.row("🚀", "1F680", "rocket", alias = "ship it|rocket ship"),
                Fixtures.row("📦", "1F4E6", "package", alias = "ship it"),
            ) + (0 until 1000).map { Fixtures.row("f$it", "F$it", "filler $it") },
        )
        val ships = AliasEngine(listOf(english))
        val top = { query: String ->
            ships.search(query, AliasSearchOptions(prefix = false)).results.map { "${it.emoji} ${it.score}" }
        }
        assertEquals(listOf("🚀 0.9", "📦 0.88", "🚢 0.87"), top("ship it").take(3))
        assertEquals("🚢 1.0", top("ship").first())
    }

    @Test
    fun `looks up entries by id`() {
        assertEquals("🚀", engine.entry("1F680")?.emoji)
        assertEquals(mapOf("en" to "rocket"), engine.entry("1F680")?.labels)
        assertNull(engine.entry("nope"))
    }

    @Test
    fun `needs at least one pack`() {
        assertFailsWith<EmojisenseException.NoPacks> { AliasEngine(emptyList()) }
    }

    private fun chinese(): AliasEngine {
        val zh = Fixtures.english.copy(
            locale = "zh",
            emoji = listOf(
                Fixtures.row("🎂", "1F382", "生日蛋糕", keyword = "生日|蛋糕", alias = "生日快乐"),
                Fixtures.row("🚀", "1F680", "火箭", keyword = "火箭", alias = "发射"),
            ),
        )
        return AliasEngine(listOf(Fixtures.english, zh))
    }

    @Test
    fun `splits a run that is not one token, longest first`() {
        val engine = chinese()
        val search = { query: String -> engine.search(query, AliasSearchOptions(locale = "zh")) }
        assertEquals(listOf("今天", "生日快乐"), search("今天生日快乐").tokens)
        assertEquals("🎂", search("今天生日快乐").results.first().emoji)
        assertEquals(listOf("火箭", "发射"), search("火箭发射").tokens)
        assertEquals("🚀", search("火箭发射").results.first().emoji)
    }

    @Test
    fun `keeps unknown characters together as one token`() {
        val engine = chinese()
        val search = { query: String -> engine.search(query, AliasSearchOptions(locale = "zh")) }
        assertEquals(listOf("今天", "蛋糕"), search("今天蛋糕").tokens)
        assertEquals("🎂", search("今天蛋糕").results.first().emoji)
        // Two unknown pieces outweigh one known piece: below the coverage threshold.
        assertEquals(listOf("今天", "蛋糕", "明天"), search("今天蛋糕明天").tokens)
        assertEquals(emptyList(), search("今天蛋糕明天").results)
    }

    @Test
    fun `splits function words out of a run even when no phrase holds them`() {
        val engine = chinese()
        val search = { query: String -> engine.search(query, AliasSearchOptions(locale = "zh")) }
        assertEquals(listOf("今天", "的", "蛋糕", "呀"), search("今天的蛋糕呀").tokens)
        assertEquals("🎂", search("今天的蛋糕呀").results.first().emoji)
    }

    // ── Function words ──────────────────────────────────────────────────────────────────────

    /**
     * The fixture's emoji stand in for the real ones: 🔥 = 🤔 (想 "think"), 🚀 = 🛌 (躺平),
     * 🐐 = 🙋 (我也是 "me too"), 👍 = 👌 (了解 "understood"), 🎃 = 😩 (устал "tired"), 🦖 = 🗿.
     */
    private val chineseFunctionWords by lazy {
        AliasEngine(
            listOf(
                Fixtures.english,
                Fixtures.english.copy(
                    locale = "zh",
                    emoji = listOf(
                        Fixtures.row("🔥", "1F525", "火", keyword = "想|思考"),
                        Fixtures.row("🚀", "1F680", "火箭", alias = "躺平"),
                        Fixtures.row("🐐", "1F410", "山羊", alias = "我也是|我"),
                        Fixtures.row("👍", "1F44D", "竖起大拇指", alias = "了解|好的"),
                    ),
                ),
            ),
        )
    }

    private val russianFunctionWords by lazy {
        AliasEngine(
            listOf(
                Fixtures.english,
                Fixtures.english.copy(
                    locale = "ru",
                    emoji = listOf(
                        Fixtures.row("🎃", "1F383", "тыква", keyword = "устал", alias = "я так устал"),
                        Fixtures.row("🐐", "1F410", "коза", alias = "я тоже|я"),
                        Fixtures.row("🦖", "1F996", "тираннозавр", alias = "очень"),
                    ),
                ),
            ),
        )
    }

    private fun zh(query: String) = chineseFunctionWords.search(query, AliasSearchOptions(locale = "zh"))

    private fun ru(query: String) = russianFunctionWords.search(query, AliasSearchOptions(locale = "ru"))

    @Test
    fun `function words never block the content word of a sentence`() {
        assertEquals(listOf("我", "想", "躺平"), zh("我想躺平").tokens)
        assertEquals("🚀", zh("我想躺平").results.first().emoji)
        assertEquals("🎃", ru("я очень устал").results.first().emoji)
    }

    @Test
    fun `does not complete a function word next to a content word`() {
        assertEquals(listOf("躺平", "了"), zh("躺平了").tokens)
        assertEquals(listOf("🚀"), zh("躺平了").results.map { it.emoji })
    }

    @Test
    fun `still matches a whole query of function words`() {
        assertEquals("🐐", zh("我也是").results.first().emoji)
        assertEquals("🐐", zh("我").results.first().emoji)
        assertEquals("🐐", ru("я тоже").results.first().emoji)
        assertEquals("🦖", ru("очень").results.first().emoji)
    }

    @Test
    fun `applies the query locale's list plus the English and Turkish ones`() {
        assertTrue("我" in FunctionWords.active("zh"))
        assertTrue("the" in FunctionWords.active("zh"))
        assertTrue("bir" in FunctionWords.active("zh"))
        assertTrue("son" in FunctionWords.active("es"))
        assertTrue("son" !in FunctionWords.active("en"))
        assertEquals(FunctionWords.active("en"), FunctionWords.active("ja"))
    }

    @Test
    fun `does not split an indexed token or one still being typed`() {
        val engine = chinese()
        val search = { query: String -> engine.search(query, AliasSearchOptions(locale = "zh")) }
        assertEquals(listOf("生日快乐"), search("生日快乐").tokens)
        assertEquals(listOf("生日快"), search("生日快").tokens)
        assertEquals("🎂", search("生日快").results.first().emoji)
        assertEquals(listOf("生日", "快"), search("生日快 ").tokens)
        assertEquals(listOf("rockets"), this.engine.search("rockets").tokens)
    }

    @Test
    fun `is safe to search concurrently`() = runBlocking {
        val expected = engine.search("jurassic park").results
        val results = (0 until 16).map { async(Dispatchers.Default) { engine.search("jurassic park").results } }.awaitAll()
        results.forEach { assertEquals(expected, it) }
    }
}

/** Ports packages/core/test/custom.test.ts. */
class CustomPackTest {
    private val engine = AliasEngine(listOf(Fixtures.english, Fixtures.turkish, Fixtures.custom))

    @Test
    fun `adds custom rows after the catalog, with their image and shortcode`() {
        assertEquals(Fixtures.english.emoji.size + 2, engine.entries.size)
        val entry = engine.entry("C-e1")!!
        assertEquals(":party_parrot:", entry.emoji)
        assertEquals("custom", entry.group)
        assertEquals("https://api.test/v1/custom/app1/e1", entry.imageUrl)
        assertEquals("party_parrot", entry.shortcode)
        assertEquals(false, entry.hasSkinTones)
        assertEquals(listOf("en", "tr"), engine.locales)
        assertEquals("test", engine.packVersion)
    }

    @Test
    fun `finds custom emoji by shortcode words and aliases, with source custom`() {
        val first = engine.canonicalSearch("party parrot").results.first()
        assertEquals(":party_parrot:", first.emoji)
        assertEquals("C-e1", first.id)
        assertEquals(ResultSource.CUSTOM, first.source)
        assertEquals("https://api.test/v1/custom/app1/e1", first.imageUrl)
        assertEquals("party_parrot", first.shortcode)
        assertEquals("party_parrot", first.label)
        assertEquals("C-e2", engine.search("squirrel").results.first().id)
    }

    @Test
    fun `ranks custom and catalog emoji together`() {
        val ids = engine.search("ship it").results.map { it.id }
        assertTrue("C-e2" in ids)
        assertTrue("1F680" in ids)
    }

    @Test
    fun `does not penalize custom phrases in any locale`() {
        val inTurkish = engine.search("celebrate", AliasSearchOptions(locale = "tr")).results.first()
        val inEnglish = engine.search("celebrate", AliasSearchOptions(locale = "en")).results.first()
        assertEquals(inEnglish.score, inTurkish.score)
    }

    @Test
    fun `keeps catalog results unchanged in shape`() {
        val rocket = engine.search("rocket").results.first()
        assertEquals(ResultSource.ALIAS, rocket.source)
        assertNull(rocket.imageUrl)
        assertNull(rocket.shortcode)
    }

    @Test
    fun `works with a custom pack alone, e g on the server`() {
        val only = AliasEngine(listOf(Fixtures.custom))
        val first = only.search("dance").results.first()
        assertEquals("C-e1", first.id)
        assertEquals(ResultSource.CUSTOM, first.source)
        assertEquals(emptyList(), only.locales)
    }

    @Test
    fun `keeps imageUrl through fusion`() {
        val alias = engine.search("shipit").results
        val fused = Fusion.fuseResults(alias, listOf(EmojiResult("🚀", "1F680", 0.8, ResultSource.SEMANTIC)))
        assertEquals("https://api.test/v1/custom/app1/e2", fused.first { it.id == "C-e2" }.imageUrl)
    }

    @Test
    fun `asks the API for the key's custom pack, with the tenant`() = runBlocking {
        val transport = StubTransport.json(Fixtures.CUSTOM_JSON)
        val pack = PackLoader.loadCustomPack("https://api.test/", "pk_live_x", "acme 1", transport)
        assertEquals("https://api.test/v1/custom/app1/e1", pack.images["C-e1"])
        assertEquals(listOf("https://api.test/v1/custom-pack?key=pk_live_x&tenant=acme+1"), transport.requests)
    }

    @Test
    fun `rejects failed requests and packs that are not custom`() = runBlocking {
        val status = assertFailsWith<EmojisenseException.HttpStatus> {
            PackLoader.loadCustomPack("https://api.test", "k", transport = StubTransport.json("{}", status = 401))
        }
        assertTrue("HTTP 401" in status.message.orEmpty())
        val regular = Fixtures.CUSTOM_JSON.replace("\"part\":\"custom\",", "")
        val error = assertFailsWith<EmojisenseException.InvalidData> {
            PackLoader.loadCustomPack("https://api.test", "k", transport = StubTransport.json(regular))
        }
        assertTrue("not a custom emoji pack" in error.message.orEmpty())
    }
}
