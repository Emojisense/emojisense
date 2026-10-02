package com.emojisense

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import java.net.URLDecoder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
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
    fun `throws on HTTP errors`() = runBlocking {
        val error = assertFailsWith<EmojisenseException.HttpStatus> { client(StubTransport.json("nope", status = 429)).search("x y z") }
        assertEquals(429, error.status)
        assertTrue("HTTP 429" in error.message.orEmpty())
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
}
