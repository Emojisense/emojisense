package com.emojisense

/** The small packs of packages/core/test/fixture.ts. */
object Fixtures {
    fun row(
        emoji: String,
        hexcode: String,
        label: String,
        shortcode: String = "",
        keyword: String = "",
        alias: String = "",
        typo: String = "",
        low: String = "",
    ) = PackRow(
        emoji = emoji,
        hexcode = hexcode,
        label = label,
        shortcode = shortcode,
        keyword = keyword,
        alias = alias,
        typo = typo,
        low = low,
    )

    val english = Pack(
        packVersion = "test",
        locale = "en",
        emojiVersion = "17.0",
        groups = listOf("test"),
        emoji = listOf(
            row("👍", "1F44D", "thumbs up", shortcode = "+1|thumbsup", keyword = "good|like|yes", alias = "lgtm|approve"),
            row("🔥", "1F525", "fire", keyword = "flame|hot", alias = "on fire|lit|hotfix"),
            row("🚒", "1F692", "fire engine", keyword = "engine|truck"),
            row("🚀", "1F680", "rocket", keyword = "space", alias = "ship it|launch|deploy|to the moon"),
            row("🦖", "1F996", "T-Rex", keyword = "dinosaur|tyrannosaurus", alias = "jurassic park|dino", typo = "dinasour"),
            row("🐐", "1F410", "goat", alias = "greatest of all time|goat"),
            row("🎃", "1F383", "jack-o-lantern", keyword = "halloween|pumpkin"),
            row("🎂", "1F382", "birthday cake", keyword = "birthday|cake", alias = "happy birthday"),
        ),
    )

    val turkish = english.copy(
        locale = "tr",
        emoji = listOf(
            row("👍", "1F44D", "baş parmak yukarıda", keyword = "tamam|onay"),
            row("🎂", "1F382", "doğum günü pastası", keyword = "dogum gunu|pasta", alias = "iyi ki dogdun"),
        ),
    )

    /** An app's custom emoji, as GET /v1/custom-pack serves them (PACK_FORMAT.md §8). */
    val custom = Pack(
        packVersion = "custom-1a2b3c4d",
        locale = "und",
        part = PackPart.CUSTOM,
        emojiVersion = "",
        groups = listOf("custom"),
        emoji = listOf(
            PackRow(":party_parrot:", "C-e1", 0, 0.0, false, "party_parrot", "party parrot", "", "celebrate|dance", "", ""),
            PackRow(":shipit:", "C-e2", 0, 0.0, false, "shipit", "shipit", "", "ship it|squirrel", "", ""),
        ),
        images = mapOf("C-e1" to "https://api.test/v1/custom/app1/e1", "C-e2" to "https://api.test/v1/custom/app1/e2"),
    )

    const val CUSTOM_JSON = """{"format":"emojisense-pack","formatVersion":1,"packVersion":"custom-1a2b3c4d","locale":"und",
        "part":"custom","emojiVersion":"","groups":["custom"],
        "emoji":[[":party_parrot:","C-e1",0,0,0,"party_parrot","party parrot","","celebrate|dance","",""]],
        "images":{"C-e1":"https://api.test/v1/custom/app1/e1"}}"""
}

/** An HTTP transport that answers from a function and records every request. */
class StubTransport(private val respond: (String) -> HttpResponse) : HttpTransport {
    val requests = mutableListOf<String>()

    override suspend fun get(url: String): HttpResponse {
        synchronized(requests) { requests.add(url) }
        return respond(url)
    }

    companion object {
        /** Serves bodies by the last, still percent-encoded, path segment; anything else is a 404. */
        fun files(files: Map<String, String>) = StubTransport { url ->
            val segment = url.substringBefore('?').substringAfterLast('/')
            files[segment]?.let { HttpResponse(200, it.encodeToByteArray()) } ?: HttpResponse(404, ByteArray(0))
        }

        /** Serves bodies by the full URL; anything else is a 404. */
        fun urls(urls: Map<String, String>) = StubTransport { url ->
            urls[url]?.let { HttpResponse(200, it.encodeToByteArray()) } ?: HttpResponse(404, ByteArray(0))
        }

        fun json(body: String, status: Int = 200) = StubTransport { HttpResponse(status, body.encodeToByteArray()) }
    }
}
