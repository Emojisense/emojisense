package com.emojisense

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class PackTest {
    private fun packJson(format: String = Pack.FORMAT, formatVersion: Int = 1, extra: String = "") =
        """{"format":"$format","formatVersion":$formatVersion,"packVersion":"0.1.0","locale":"en",
         "emojiVersion":"17.0","groups":["smileys-emotion"]$extra,
         "emoji":[["🦖","1F996",0,5,1,"T-Rex","t rex","dinosaur|rex","jurassic park","dinasour",""]]}"""

    @Test
    fun `decodes heterogeneous rows`() {
        val pack = Pack.fromJson(packJson())
        assertEquals(PackPart.CORE, pack.part)
        assertEquals(
            PackRow("🦖", "1F996", 0, 5.0, true, "T-Rex", "t rex", "dinosaur|rex", "jurassic park", "dinasour", ""),
            pack.emoji.first(),
        )
    }

    @Test
    fun `reads the part and weight overrides`() {
        val pack = Pack.fromJson(packJson(extra = ""","part":"ext","weights":{"alias":0.7,"x":1}"""))
        assertEquals(PackPart.EXT, pack.part)
        assertEquals(0.7, pack.weight(Field.ALIAS))
        assertEquals(0.85, pack.weight(Field.KEYWORD))
    }

    @Test
    fun `rejects other formats`() {
        val format = assertFailsWith<EmojisenseException.InvalidFormat> { Pack.fromJson(packJson(format = "something-else")) }
        assertEquals("something-else", format.found)
        val version = assertFailsWith<EmojisenseException.UnsupportedFormatVersion> { Pack.fromJson(packJson(formatVersion = 2)) }
        assertEquals(2, version.version)
        assertFailsWith<EmojisenseException.InvalidData> { Pack.fromJson("""{"format":"emojisense-pack","formatVersion":1}""") }
    }

    @Test
    fun `loads core packs English first`() = runBlocking {
        val english = packJson()
        val turkish = english.replace("\"locale\":\"en\"", "\"locale\":\"tr\"")
        val transport = StubTransport.files(mapOf("pack.en.json" to english, "pack.tr.json" to turkish))
        val packs = PackLoader("https://x.test/v1/pack/0.1.0/", transport).loadPacks(listOf("tr", "en"))
        assertEquals(listOf("en", "tr"), packs.map { it.locale })
        assertEquals(setOf("https://x.test/v1/pack/0.1.0/pack.en.json", "https://x.test/v1/pack/0.1.0/pack.tr.json"), transport.requests.toSet())
    }

    @Test
    fun `leaves out a locale without a pack and loads each locale once`() = runBlocking {
        val transport = StubTransport.files(mapOf("pack.en.json" to packJson()))
        val packs = PackLoader("https://x.test/v1/pack/0.1.0", transport).loadPacks(listOf("de", "en", "de"))
        assertEquals(listOf("en"), packs.map { it.locale })
        assertEquals(listOf("pack.de.json", "pack.en.json"), transport.requests.map { it.substringAfterLast('/') }.sorted())
    }

    @Test
    fun `fails when English does not load`() = runBlocking {
        val turkish = packJson().replace("\"locale\":\"en\"", "\"locale\":\"tr\"")
        val loader = PackLoader("https://x.test/v1/pack/0.1.0", StubTransport.files(mapOf("pack.tr.json" to turkish)))
        val error = assertFailsWith<EmojisenseException.HttpStatus> { loader.loadPacks(listOf("tr")) }
        assertEquals(404, error.status)
    }

    @Test
    fun `rejects a file that does not match the manifest`() = runBlocking {
        val manifest = """{"format":"emojisense-manifest","formatVersion":1,"packVersion":"0.1.0","emojiVersion":"17.0",
            "emojiCount":1,"files":{"pack.en.json":{"sha256":"00","bytes":1,"gzipBytes":1,"locale":"en"}}}"""
        val loader = PackLoader("https://x.test/v1/pack/0.1.0", StubTransport.files(mapOf("manifest.json" to manifest, "pack.en.json" to packJson())))
        val loaded = loader.loadManifest()
        assertEquals("en", loaded.files.getValue("pack.en.json").locale)
        val error = assertFailsWith<EmojisenseException.ChecksumMismatch> { loader.loadPacks(manifest = loaded) }
        assertEquals("pack.en.json", error.file)
    }

    @Test
    fun `accepts a file that matches the manifest`() = runBlocking {
        val body = packJson()
        val sha = java.security.MessageDigest.getInstance("SHA-256").digest(body.encodeToByteArray()).joinToString("") { "%02x".format(it) }
        val manifest = """{"format":"emojisense-manifest","formatVersion":1,"packVersion":"0.1.0","emojiVersion":"17.0",
            "emojiCount":1,"files":{"pack.en.json":{"sha256":"$sha","bytes":1,"gzipBytes":1,"locale":"en"}}}"""
        val loader = PackLoader("https://x.test/v1/pack/0.1.0", StubTransport.files(mapOf("manifest.json" to manifest, "pack.en.json" to body)))
        assertEquals("T-Rex", loader.loadPacks(manifest = loader.loadManifest()).single().emoji.single().label)
    }
}

class EmojiSetTest {
    @Test
    fun `hexcodes match Emojibase`() {
        val cases = listOf(
            "👍" to "1F44D",
            "👍🏽" to "1F44D-1F3FD",
            "❤️" to "2764",
            "❤️‍🔥" to "2764-FE0F-200D-1F525",
            "🏌🏿‍♂️" to "1F3CC-1F3FF-200D-2642-FE0F",
            "🧑🏾‍🤝‍🧑🏾" to "1F9D1-1F3FE-200D-1F91D-200D-1F9D1-1F3FE",
            "#️⃣" to "0023-FE0F-20E3",
            "🇺🇸" to "1F1FA-1F1F8",
            "🏴󠁧󠁢󠁥󠁮󠁧󠁿" to "1F3F4-E0067-E0062-E0065-E006E-E0067-E007F",
        )
        for ((emoji, hexcode) in cases) assertEquals(hexcode, Hexcode.of(emoji), emoji)
    }

    @Test
    fun `hosted sets point at the sets route`() {
        assertEquals("https://api.emojisense.com/v1/sets/twemoji/1F44D-1F3FD.svg", EmojiSet.TWEMOJI.imageUrl("👍🏽", "https://api.emojisense.com/"))
        assertEquals("https://api.emojisense.com/v1/sets/fluent/0023-FE0F-20E3.svg", EmojiSet.FLUENT.imageUrl("#️⃣", "https://api.emojisense.com"))
        assertEquals(null, EmojiSet.NATIVE.imageUrl("👍", "https://api.emojisense.com"))
    }

    @Test
    fun `hosted sets send the publishable key`() {
        assertEquals(
            "https://api.emojisense.com/v1/sets/noto/1F44D.svg?key=pk_live_a%2Bb",
            EmojiSet.NOTO.imageUrl("👍", "https://api.emojisense.com", "pk_live_a+b"),
        )
        assertEquals("https://api.emojisense.com/v1/sets/noto/1F44D.svg", EmojiSet.NOTO.imageUrl("👍", "https://api.emojisense.com", ""))
    }

    @Test
    fun `matches the TypeScript set list`() {
        assertEquals(listOf("native", "twemoji", "noto", "fluent"), EmojiSet.entries.map { it.key })
        assertEquals(listOf(EmojiSet.TWEMOJI, EmojiSet.NOTO, EmojiSet.FLUENT), EmojiSet.entries.filter { it.isHosted })
        assertEquals(EmojiSet.NOTO, EmojiSet.fromKey("noto"))
    }
}
