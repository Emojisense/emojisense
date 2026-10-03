package com.emojisense

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import java.net.URLDecoder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val SEMANTIC_BODY =
    """{"query":"x","results":[{"emoji":"🌋","id":"1F30B","score":0.7,"source":"semantic"}],"packVersion":"test","cached":false}"""

/** Ports the semantic client tests of packages/core/test/client-session.test.ts. */
class SemanticClientTest {
    private fun client(transport: StubTransport, key: String? = null, cooldownMillis: Long = 0, clock: () -> Long = { 0 }) =
        SemanticClient(SemanticClient.Configuration("https://api.test/", key = key, overLimitCooldownMillis = cooldownMillis), transport, clock)

    private fun parameters(url: String): Map<String, String> = url.substringAfter('?').split('&').associate { pair ->
        val (name, value) = pair.split('=')
        URLDecoder.decode(name, "UTF-8") to URLDecoder.decode(value, "UTF-8")
    }

    @Test
    fun `sends the embedding text with accents, sends the key as a parameter and caches`() = runBlocking {
        val transport = StubTransport.json(SEMANTIC_BODY)
        val client = client(transport, key = "pk_1")
        val first = client.search("  Doğum   GÜNÜ!! ", SemanticSearchOptions(locale = "tr", limit = 5))
        client.search("doğum günü!!", SemanticSearchOptions(locale = "tr", limit = 5))
        assertEquals(1, transport.requests.size)
        assertEquals(SemanticLayer.API, first?.layer)
        assertEquals("🌋", first?.results?.first()?.emoji)
        val url = transport.requests.single()
        assertTrue(url.startsWith("https://api.test/v1/search?"))
        assertEquals(
            mapOf("q" to "doğum günü!!", "locale" to "tr", "limit" to "5", "mode" to "semantic", "key" to "pk_1"),
            parameters(url),
        )
    }

    @Test
    fun `marks an answer from its own memory as cached`() = runBlocking {
        val client = client(StubTransport.json(SEMANTIC_BODY))
        assertEquals(false, client.search("volcano")?.cached)
        assertEquals(true, client.search("volcano")?.cached)
    }

    @Test
    fun `encodes like URLSearchParams`() = runBlocking {
        val transport = StubTransport.json(SEMANTIC_BODY)
        client(transport).search("+1")
        client(transport).search("jurassic park!!")
        assertEquals("q=%2B1&locale=en&limit=24&mode=semantic", transport.requests[0].substringAfter('?'))
        assertEquals("q=jurassic+park%21%21&locale=en&limit=24&mode=semantic", transport.requests[1].substringAfter('?'))
    }

    @Test
    fun `sends region=auto only for the value auto, never a region code`() = runBlocking {
        val transport = StubTransport.json(SEMANTIC_BODY)
        client(transport).search("lava", SemanticSearchOptions(region = "auto"))
        client(transport).search("magma", SemanticSearchOptions(region = "AUTO"))
        client(transport).search("volcano", SemanticSearchOptions(region = "BR"))
        client(transport).search("eruption", SemanticSearchOptions())
        assertEquals(listOf("auto", "auto", null, null), transport.requests.map { parameters(it)["region"] })
    }

    @Test
    fun `reads the region of an API answer`() {
        assertEquals("DE", SemanticResponse.fromJson(SEMANTIC_BODY.replace("\"cached\":false", "\"cached\":false,\"region\":\"DE\"")).region)
        assertNull(SemanticResponse.fromJson(SEMANTIC_BODY.replace("\"cached\":false", "\"cached\":false,\"region\":null")).region)
        assertNull(SemanticResponse.fromJson(SEMANTIC_BODY).region)
    }

    @Test
    fun `does not ask for a query without searchable text`() = runBlocking {
        val transport = StubTransport.json(SEMANTIC_BODY)
        assertNull(client(transport).search(" 🎉 !! "))
        assertEquals(0, transport.requests.size)
    }

    @Test
    fun `keeps asking over the limit, because the edge cache still answers, but not twice`() = runBlocking {
        var overLimit = true
        val transport = StubTransport {
            val body = if (overLimit) SEMANTIC_BODY.replace("\"cached\":false", "\"cached\":false,\"overLimit\":true") else SEMANTIC_BODY
            HttpResponse(200, body.encodeToByteArray())
        }
        val client = client(transport)
        assertNull(client.search("lava eruption"))
        assertNull(client.search("lava eruption"))
        assertEquals(1, transport.requests.size)
        overLimit = false
        assertEquals(SemanticLayer.API, client.search("congrats")?.layer)
        assertEquals(2, transport.requests.size)
    }

    @Test
    fun `goes quiet after an over-limit answer when a cooldown is set`() = runBlocking {
        var now = 0L
        val transport = StubTransport.json(SEMANTIC_BODY.replace("\"cached\":false", "\"cached\":false,\"overLimit\":true"))
        val client = client(transport, cooldownMillis = 1000, clock = { now })
        assertNull(client.search("lava eruption"))
        assertNull(client.search("volcano eruption"))
        assertEquals(1, transport.requests.size)
        now = 2000
        client.search("volcano eruption")
        assertEquals(2, transport.requests.size)
    }

    @Test
    fun `peeks at its own memory only`() = runBlocking {
        val transport = StubTransport.json(SEMANTIC_BODY)
        val client = client(transport)
        assertNull(client.peek("volcano eruption", SemanticSearchOptions()))
        client.search("volcano eruption")
        val peeked = client.peek("volcano eruption", SemanticSearchOptions())
        assertEquals(true, peeked?.cached)
        assertEquals(SemanticLayer.API, peeked?.layer)
        assertNull(client.peek("volcano eruption", SemanticSearchOptions(locale = "tr")))
        assertEquals(1, transport.requests.size)
    }

    @Test
    fun `never peeks at an over-limit answer`() = runBlocking {
        val client = client(StubTransport.json(SEMANTIC_BODY.replace("\"cached\":false", "\"cached\":false,\"overLimit\":true")))
        assertNull(client.search("lava eruption"))
        assertNull(client.peek("lava eruption", SemanticSearchOptions()))
    }

    @Test
    fun `throws on HTTP errors`() = runBlocking {
        val error = assertFailsWith<EmojisenseException.HttpStatus> { client(StubTransport.json("nope", status = 429)).search("x y z") }
        assertEquals(429, error.status)
        assertTrue("HTTP 429" in error.message.orEmpty())
    }

    @Test
    fun `decodes the verdict of an unsure query`() {
        val response = SemanticResponse.fromJson(
            """{"results":[{"emoji":"🌋","id":"1F30B","score":0.4,"source":"semantic"}],"packVersion":"test","confidence":0.412,"unsure":true}""",
        )
        assertEquals(listOf(ResultSource.SEMANTIC), response.results.map { it.source })
        assertEquals(0.412, response.confidence)
        assertEquals(true, response.unsure)

        val older = SemanticResponse.fromJson(SEMANTIC_BODY)
        assertNull(older.confidence)
        assertNull(older.unsure)
    }

    @Test
    fun `decodes the calibration of the server's model`() {
        val withGap = SemanticResponse.fromJson(
            SEMANTIC_BODY.replace("\"cached\":false", "\"cached\":false,\"calibration\":{\"floor\":0.39,\"ceiling\":0.56,\"gapFloor\":0.02,\"gapCeiling\":0.1}"),
        )
        assertEquals(SemanticCalibration(0.39, 0.56, 0.02, 0.1), withGap.calibration)
        val withoutGap = SemanticResponse.fromJson(SEMANTIC_BODY.replace("\"cached\":false", "\"cached\":false,\"calibration\":{\"floor\":0.1,\"ceiling\":0.3}"))
        assertEquals(SemanticCalibration(0.1, 0.3), withoutGap.calibration)
        // Older servers send none; an incomplete one is ignored. The client's default applies.
        assertNull(SemanticResponse.fromJson(SEMANTIC_BODY).calibration)
        assertNull(SemanticResponse.fromJson(SEMANTIC_BODY.replace("\"cached\":false", "\"cached\":false,\"calibration\":{\"floor\":0.1}")).calibration)
    }

    @Test
    fun `keeps the most recent answers in its cache`() {
        val cache = LruCache<String, Int>(2)
        cache["a"] = 1
        cache["b"] = 2
        cache["a"]
        cache["c"] = 3
        assertEquals(listOf(1, null, 3), listOf(cache["a"], cache["b"], cache["c"]))
        assertEquals(2, cache.size)
    }
}

/** Ports packages/core/test/shards.test.ts. */
class ShardProviderTest {
    private val files = mapOf(
        "index.json" to """{"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256","keys":["c","co","th","the "]}""",
        "co.json" to """{"key":"co","entries":{"congrats on the launch":[["🚀","1F680",0.8],["🎉","1F389",0.7]]}}""",
        "the%20.json" to """{"key":"the ","entries":{"the office":[["🏢","1F3E2",0.6]]}}""",
    )

    @Test
    fun `picks the longest matching prefix key`() {
        val keys = listOf("c", "co", "th", "the ")
        assertEquals("the ", ShardProvider.shardKey("the office", keys))
        assertEquals("c", ShardProvider.shardKey("cat", keys))
        assertNull(ShardProvider.shardKey("zebra", keys))
    }

    @Test
    fun `answers from a shard and downloads each shard once`() = runBlocking {
        val transport = StubTransport.files(files)
        val provider = ShardProvider("https://x.test/p/1/", transport)
        val first = provider.search("Congrats on the launch")
        assertEquals(SemanticLayer.SHARD, first?.layer)
        assertEquals("m@256", first?.model)
        assertEquals(listOf("🚀", "🎉"), first?.results?.map { it.emoji })
        provider.search("congrats on the launch")
        assertEquals(2, transport.requests.size)
        assertEquals("🏢", provider.search("the office")?.results?.first()?.emoji)
    }

    @Test
    fun `leaves queries with accents or punctuation to the API`() = runBlocking {
        // Shards hold the semantic answers to the folded text; the API embeds the text as typed.
        val transport = StubTransport.files(files)
        val provider = ShardProvider("https://x.test/p/1", transport)
        assertNull(provider.search("congrats on the launch!"))
        assertNull(provider.search("congrats on thé launch"))
        assertEquals(0, transport.requests.size)
        assertEquals(SemanticLayer.SHARD, provider.search("congrats on the launch")?.layer)
    }

    @Test
    fun `returns null for unknown queries so the next layer is asked`() = runBlocking {
        val shards = ShardProvider("https://x.test/p/1", StubTransport.files(files))
        val apiTransport = StubTransport.json(SEMANTIC_BODY)
        val chain = ProviderChain(shards, SemanticClient(SemanticClient.Configuration("https://api.test"), apiTransport))
        assertEquals(SemanticLayer.API, chain.search("coffee time")?.layer)
        assertEquals(SemanticLayer.SHARD, chain.search("congrats on the launch")?.layer)
        assertEquals(1, apiTransport.requests.size)
    }

    @Test
    fun `treats network failures as no answer`() = runBlocking {
        val failing = ShardProvider("https://x.test/p/1", StubTransport { HttpResponse(500, ByteArray(0)) })
        assertNull(failing.search("congrats"))
        val throwing = ShardProvider("https://x.test/p/1", StubTransport { throw java.io.IOException("offline") })
        assertNull(throwing.search("congrats"))
    }

    // ── Shards per locale ────────────────────────────────────────────────────────────────────

    private val base = "https://x.test/p/1"
    private val localeFiles = mapOf(
        "$base/index.json" to files.getValue("index.json"),
        "$base/co.json" to files.getValue("co.json"),
        "$base/tr/index.json" to """{"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256","keys":["co","dogum "]}""",
        "$base/tr/co.json" to """{"key":"co","entries":{"congrats on the launch":[["🎊","1F38A",0.9]]}}""",
        "$base/tr/dogum%20.json" to """{"key":"dogum ","entries":{"dogum gunu":[["🎂","1F382",0.9]]}}""",
    )

    @Test
    fun `uses the root files for English and for no locale`() = runBlocking {
        val transport = StubTransport.urls(localeFiles)
        val provider = ShardProvider("$base/", transport)
        for (locale in listOf(null, "en", "EN", "", "en-GB")) {
            assertEquals("🚀", provider.search("congrats on the launch", SemanticSearchOptions(locale = locale))?.results?.first()?.emoji, "$locale")
        }
        assertEquals(listOf("$base/index.json", "$base/co.json"), transport.requests)
    }

    @Test
    fun `asks the folder of any other locale, in lowercase`() = runBlocking {
        val transport = StubTransport.urls(localeFiles)
        val provider = ShardProvider(base, transport)
        val upper = provider.search("Dogum gunu", SemanticSearchOptions(locale = "TR"))
        assertEquals(SemanticLayer.SHARD, upper?.layer)
        assertEquals(listOf("🎂"), upper?.results?.map { it.emoji })
        assertEquals(listOf("🎂"), provider.search("dogum gunu", SemanticSearchOptions(locale = "tr"))?.results?.map { it.emoji })
        // Only the language subtag counts, like the API's locale.
        assertEquals(listOf("🎂"), provider.search("dogum gunu", SemanticSearchOptions(locale = "tr_TR"))?.results?.map { it.emoji })
        assertEquals(listOf("$base/tr/index.json", "$base/tr/dogum%20.json"), transport.requests)
    }

    @Test
    fun `keeps the index and shards of each locale apart`() = runBlocking {
        val transport = StubTransport.urls(localeFiles)
        val provider = ShardProvider(base, transport)
        repeat(2) {
            assertEquals("🚀", provider.search("congrats on the launch", SemanticSearchOptions(locale = "en"))?.results?.first()?.emoji)
            assertEquals("🎊", provider.search("congrats on the launch", SemanticSearchOptions(locale = "tr"))?.results?.first()?.emoji)
        }
        assertEquals(listOf("$base/index.json", "$base/co.json", "$base/tr/index.json", "$base/tr/co.json"), transport.requests)
    }

    @Test
    fun `gives no answer for a locale without shards and does not ask again`() = runBlocking {
        val transport = StubTransport.urls(localeFiles)
        val shards = ShardProvider(base, transport)
        val german = SemanticSearchOptions(locale = "de")
        assertNull(shards.search("congrats on the launch", german))
        assertNull(shards.search("congrats on the way", german))
        assertEquals(listOf("$base/de/index.json"), transport.requests)

        val chain = ProviderChain(shards, SemanticClient(SemanticClient.Configuration("https://api.test"), StubTransport.json(SEMANTIC_BODY)))
        assertEquals(SemanticLayer.API, chain.search("congrats on the launch", german)?.layer)
        assertEquals(SemanticLayer.SHARD, shards.search("congrats on the launch")?.layer)
        assertEquals(1, transport.requests.count { it.endsWith("/de/index.json") })
    }

    // ── Hashed files and the base layer ──────────────────────────────────────────────────────

    /** Live English index with hashed files and a base index; the base files are in f/ as well. */
    private val layeredFiles = mapOf(
        "$base/index.json" to
            """{"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256","keys":["co"],"files":{"co":"f/live-co.json"},"base":"f/base-en.json"}""",
        "$base/f/live-co.json" to files.getValue("co.json"),
        "$base/f/base-en.json" to """{"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256","keys":["th"],"files":{"th":"base-th.json"}}""",
        "$base/f/base-th.json" to """{"key":"th","entries":{"thank you so much":[["🙏","1F64F",0.9]]}}""",
        "$base/tr/index.json" to """{"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256","keys":[],"files":{},"base":"../f/base-en.json"}""",
    )

    private fun serveLayered(url: String): HttpResponse =
        layeredFiles[url]?.let { HttpResponse(200, it.encodeToByteArray()) } ?: HttpResponse(404, ByteArray(0))

    private fun paths(transport: StubTransport): List<String> = transport.requests.map { it.removePrefix("$base/") }

    @Test
    fun `resolves file URLs like the URL constructor`() {
        assertEquals("https://x/p/1/f/a.json", ShardProvider.resolve("https://x/p/1/tr/index.json", "../f/a.json"))
        assertEquals("https://x/p/1/f/a.json", ShardProvider.resolve("https://x/p/1/index.json", "f/a.json"))
        assertEquals("https://x/p/1/the%20.json", ShardProvider.resolve("https://x/p/1/index.json", "the%20.json"))
        assertEquals("https://cdn.test/f/a.json", ShardProvider.resolve("https://x/p/1/index.json", "https://cdn.test/f/a.json"))
        assertNull(ShardProvider.resolve("https://x/p/1/index.json", "a b.json"))
    }

    @Test
    fun `reads the files the index names, then the base layer`() = runBlocking {
        val transport = StubTransport(::serveLayered)
        val provider = ShardProvider(base, transport)
        assertEquals("🚀", provider.search("congrats on the launch")?.results?.first()?.emoji)
        assertEquals("🙏", provider.search("thank you so much")?.results?.first()?.emoji)
        assertNull(provider.search("thanks a lot"))
        assertEquals(listOf("index.json", "f/base-en.json", "f/live-co.json", "f/base-th.json"), paths(transport))
    }

    @Test
    fun `resolves a base index named relative to a locale folder to the shared folder`() = runBlocking {
        val transport = StubTransport(::serveLayered)
        val provider = ShardProvider(base, transport)
        assertEquals(SemanticLayer.SHARD, provider.search("thank you so much", SemanticSearchOptions(locale = "tr"))?.layer)
        assertEquals("🙏", provider.search("thank you so much")?.results?.first()?.emoji)
        // English and Turkish share the base index and its file: each is downloaded once.
        assertEquals(listOf("tr/index.json", "f/base-en.json", "f/base-th.json", "index.json"), paths(transport))
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `peeks only at what is loaded, and prefetch loads it`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val served = StubTransport(::serveLayered)
        val provider = ShardProvider(base, { url -> gate.await(); served.get(url) }, scope = backgroundScope)
        val options = SemanticSearchOptions()
        assertNull(provider.peek("thank you so much", options))
        provider.prefetch("thank you", null)
        // prefetch returns at once: nothing has arrived yet.
        assertNull(provider.peek("thank you so much", options))
        gate.complete(Unit)
        runCurrent()
        assertEquals(listOf("index.json", "f/base-en.json", "f/base-th.json"), paths(served))
        assertEquals("🙏", provider.peek("thank you so much", options)?.results?.first()?.emoji)
        assertEquals(emptyList(), provider.peek("thank you so much", SemanticSearchOptions(limit = 0))?.results)
        assertNull(provider.peek("thank you!", options))
        // search uses the files that prefetch loaded.
        assertEquals("🙏", provider.search("thank you so much")?.results?.first()?.emoji)
        assertEquals(3, served.requests.size)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `prefetch with an empty query loads the indexes only`() = runTest {
        val transport = StubTransport(::serveLayered)
        ShardProvider(base, transport, scope = backgroundScope).prefetch("", "tr")
        runCurrent()
        assertEquals(listOf("tr/index.json", "f/base-en.json"), paths(transport))
    }

    @Test
    fun `asks again a while after a network error, but not after a 404`() = runBlocking {
        var now = 0L
        val failOnce = mutableSetOf("$base/index.json")
        val transport = StubTransport { url ->
            if (failOnce.remove(url)) throw java.io.IOException("network down")
            serveLayered(url)
        }
        val provider = ShardProvider(base, transport, retryMillis = 20, clock = { now })
        assertNull(provider.search("congrats on the launch"))
        // Within the retry delay, an unreachable host is not asked on every keystroke.
        assertNull(provider.search("congrats on the launch"))
        assertEquals(1, transport.requests.count { it == "$base/index.json" })
        now = 30
        assertEquals(SemanticLayer.SHARD, provider.search("congrats on the launch")?.layer)

        val german = SemanticSearchOptions(locale = "de")
        assertNull(provider.search("thanks", german))
        now = 1_000_000
        assertNull(provider.search("thanks", german))
        assertEquals(SemanticLayer.SHARD, provider.search("congrats on the launch")?.layer)
        assertEquals(2, transport.requests.count { it == "$base/index.json" })
        assertEquals(1, transport.requests.count { it == "$base/de/index.json" })
    }

    @Test
    fun `treats a file that is not a shard index as no index`() = runBlocking {
        val transport = StubTransport.urls(
            mapOf(
                "$base/index.json" to """{"format":"emojisense-shards","keys":"co"}""",
                "$base/co.json" to files.getValue("co.json"),
                "$base/tr/index.json" to """{"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256","keys":["co"],"base":"f/base.json"}""",
                "$base/tr/co.json" to files.getValue("co.json"),
                "$base/tr/f/base.json" to "[]",
            ),
        )
        val provider = ShardProvider(base, transport)
        assertNull(provider.search("congrats on the launch"))
        assertNull(provider.search("congrats on the launch"))
        assertEquals(listOf("$base/index.json"), transport.requests)
        // A base index that is not an index leaves the live layer.
        assertEquals("🚀", provider.search("congrats on the launch", SemanticSearchOptions(locale = "tr"))?.results?.first()?.emoji)

        // An error page served as 200 (e.g. a Wi-Fi login page) gives no answer either.
        assertNull(ShardProvider(base, StubTransport.json("<!doctype html><title>Wi-Fi login</title>")).search("congrats on the launch"))
    }
}

/** Ports the session tests of packages/core/test/client-session.test.ts. */
@OptIn(ExperimentalCoroutinesApi::class)
class SearchSessionTest {
    private val engine = AliasEngine(listOf(Fixtures.english))

    @Test
    fun `delivers alias results at once and fused results after the debounce`() = runTest {
        val transport = StubTransport.json(SEMANTIC_BODY)
        val states = mutableListOf<SessionState>()
        val session = SearchSession(
            engine = engine,
            scope = this,
            semantic = SemanticClient(SemanticClient.Configuration("https://api.test"), transport),
            debounceMillis = 200,
            onChange = { states.add(it) },
        )
        session.update("volcano erupt")
        assertEquals(SessionStatus.LOADING, states.last().status)
        session.update("volcano eruption")
        advanceTimeBy(250)
        runCurrent()
        assertEquals(1, transport.requests.size)
        assertEquals(SessionStatus.FUSED, states.last().status)
        assertTrue("🌋" in states.last().results.map { it.emoji })
    }

    @Test
    fun `fuses the same candidates whatever its limit, and shows the limit`() = runTest {
        val results = listOf("🌋" to "1F30B", "🔥" to "1F525", "🚒" to "1F692", "🎃" to "1F383").joinToString(",") { (emoji, id) ->
            """{"emoji":"$emoji","id":"$id","score":0.5,"source":"semantic"}"""
        }
        val transport = StubTransport.json("""{"packVersion":"test","cached":false,"results":[$results]}""")
        val states = mutableListOf<SessionState>()
        SearchSession(
            engine = engine,
            scope = this,
            semantic = SemanticClient(SemanticClient.Configuration("https://api.test"), transport),
            limit = 2,
            debounceMillis = 10,
            onChange = { states.add(it) },
        ).update("volcano eruption")
        advanceTimeBy(100)
        runCurrent()
        assertEquals("24", transport.requests.single().substringAfter("limit=").substringBefore('&'))
        assertEquals(SessionStatus.FUSED, states.last().status)
        assertTrue(states.all { it.results.size <= 2 })
    }

    @Test
    fun `keeps alias results when no layer answers`() = runTest {
        val states = mutableListOf<SessionState>()
        val session = SearchSession(engine, this, semantic = { _, _ -> null }, debounceMillis = 10, onChange = { states.add(it) })
        session.update("volcano eruption")
        advanceTimeBy(50)
        runCurrent()
        assertEquals(SessionStatus.ALIAS, states.last().status)
    }

    @Test
    fun `skips the network when the alias match is confident`() = runTest {
        val transport = StubTransport.json(SEMANTIC_BODY)
        val states = mutableListOf<SessionState>()
        val session = SearchSession(
            engine,
            this,
            semantic = SemanticClient(SemanticClient.Configuration("https://api.test"), transport),
            onChange = { states.add(it) },
        )
        session.update("rocket")
        advanceTimeBy(500)
        runCurrent()
        assertEquals(0, transport.requests.size)
        assertEquals(SessionStatus.ALIAS, states.last().status)
        assertFalse(states.last().unsure)
        assertEquals(1.0, states.last().confidence)
    }

    @Test
    fun `reports a failed request with the alias results`() = runTest {
        val states = mutableListOf<SessionState>()
        val session = SearchSession(engine, this, semantic = { _, _ -> throw IllegalStateException("down") }, debounceMillis = 10, onChange = { states.add(it) })
        session.update("volcano eruption")
        advanceTimeBy(50)
        runCurrent()
        assertEquals(SessionStatus.ERROR, states.last().status)
        assertEquals("down", states.last().error?.message)
    }

    @Test
    fun `shows an answer in memory at once, with no debounce and no request`() = runTest {
        val transport = StubTransport.json(SEMANTIC_BODY)
        val client = SemanticClient(SemanticClient.Configuration("https://api.test"), transport)
        client.search("volcano eruption", SemanticSearchOptions(limit = 24))
        val states = mutableListOf<SessionState>()
        SearchSession(engine, this, semantic = client, debounceMillis = 200, onChange = { states.add(it) }).update("volcano eruption")
        val shown = states.single()
        assertEquals(SessionStatus.FUSED, shown.status)
        assertEquals(SemanticLayer.API, shown.layer)
        assertEquals(true, shown.semanticCached)
        assertEquals(0.0, shown.semanticMillis)
        advanceTimeBy(500)
        runCurrent()
        assertEquals(1, transport.requests.size)
        assertEquals(1, states.size)
    }

    @Test
    fun `loads the index at once and answers from a loaded shard on the next keystroke, with no debounce`() = runTest {
        val shards = StubTransport.urls(
            mapOf(
                "https://cdn.test/p/test/index.json" to """{"format":"emojisense-shards","formatVersion":1,"packVersion":"test","model":"m@256","keys":["v"]}""",
                "https://cdn.test/p/test/v.json" to """{"key":"v","entries":{"volcano eruption":[["🌋","1F30B",0.8]]}}""",
            ),
        )
        val api = StubTransport.json(SEMANTIC_BODY)
        val states = mutableListOf<SessionState>()
        val session = SearchSession(
            engine = engine,
            scope = this,
            semantic = ProviderChain(
                ShardProvider("https://cdn.test/p/test", shards, scope = backgroundScope),
                SemanticClient(SemanticClient.Configuration("https://api.test"), api),
            ),
            debounceMillis = 1000,
            onChange = { states.add(it) },
        )
        assertEquals(listOf("https://cdn.test/p/test/index.json"), shards.requests)
        session.update("volcano erupti")
        advanceTimeBy(5)
        runCurrent()
        session.update("volcano eruption")
        val last = states.last()
        assertEquals(SessionStatus.FUSED, last.status)
        assertEquals(SemanticLayer.SHARD, last.layer)
        assertEquals(0.0, last.semanticMillis)
        assertTrue("🌋" in last.results.map { it.emoji })
        advanceTimeBy(2000)
        runCurrent()
        assertEquals(0, api.requests.size)
        assertEquals(listOf("https://cdn.test/p/test/index.json", "https://cdn.test/p/test/v.json"), shards.requests)
    }
}

/** Ports "unsure queries" of packages/core/test/client-session.test.ts. */
@OptIn(ExperimentalCoroutinesApi::class)
class UnsureSessionTest {
    private val engine = AliasEngine(listOf(Fixtures.english))

    /** The API's answer for an unsure query: a flat, low semantic list. */
    private val unsureBody = """{"packVersion":"test","cached":false,"unsure":true,"confidence":0,"results":[""" +
        """{"emoji":"🌋","id":"1F30B","score":0.4,"source":"semantic"},{"emoji":"🐐","id":"1F410","score":0.39,"source":"semantic"}]}"""

    @Test
    fun `calls a query unsure while it waits and after a flat semantic list, and asks once`() = runTest {
        val transport = StubTransport.json(unsureBody)
        val states = mutableListOf<SessionState>()
        SearchSession(
            engine = engine,
            scope = this,
            semantic = SemanticClient(SemanticClient.Configuration("https://api.test"), transport),
            debounceMillis = 10,
            onChange = { states.add(it) },
        ).update("kendrick lamar")
        assertEquals(SessionStatus.LOADING, states.last().status)
        assertTrue(states.last().unsure)
        advanceTimeBy(1000)
        runCurrent()
        assertEquals(1, transport.requests.size)
        val last = states.last()
        assertEquals(SessionStatus.FUSED, last.status)
        assertTrue(last.unsure)
        assertEquals(ResultSource.SEMANTIC, last.results.first().source)
    }

    @Test
    fun `judges with the calibration the API sends for its model`() = runTest {
        // A top of 0.4 that stands out: weak under the default calibration, sure under one whose
        // ceiling is below it.
        val body = """{"packVersion":"test","cached":false,"unsure":true,"confidence":0,"calibration":{"floor":0.1,"ceiling":0.3},"results":[""" +
            """{"emoji":"🌋","id":"1F30B","score":0.4,"source":"semantic"},{"emoji":"🐐","id":"1F410","score":0.3,"source":"semantic"}]}"""
        val states = mutableListOf<SessionState>()
        SearchSession(
            engine = engine,
            scope = this,
            semantic = SemanticClient(SemanticClient.Configuration("https://api.test"), StubTransport.json(body)),
            debounceMillis = 10,
            onChange = { states.add(it) },
        ).update("kendrick lamar")
        advanceTimeBy(1000)
        runCurrent()
        assertEquals(SessionStatus.FUSED, states.last().status)
        assertFalse(states.last().unsure)
    }
}
