package com.emojisense

/**
 * How a picker draws emoji. [NATIVE] draws the text with the system font. The other sets are images
 * that the Emojisense API hosts at `/v1/sets/<set>/<hexcode>.svg`, as `EmojiSet` and
 * `emojiImageUrl` in packages/core. Credit the set in the app (see NOTICE).
 */
public enum class EmojiSet(public val key: String) {
    NATIVE("native"),
    TWEMOJI("twemoji"),
    NOTO("noto"),
    FLUENT("fluent"),
    ;

    /** True for the image sets that the API hosts. */
    public val isHosted: Boolean get() = this != NATIVE

    /**
     * The image URL of an emoji, skin tone included, or null for [NATIVE] (draw the text). A set may
     * not draw every emoji (Fluent has no country flags): the API answers 404 then, and the picker
     * should draw the text instead. Hosted sets need a publishable [apiKey] whose plan includes
     * them (the API answers 401 or 402 otherwise), as `emojiImageUrl` in packages/core.
     */
    @JvmOverloads
    public fun imageUrl(emoji: String, endpoint: String, apiKey: String? = null): String? {
        if (!isHosted) return null
        val query = if (apiKey.isNullOrEmpty()) "" else "?key=${UrlEncoding.uriComponent(apiKey)}"
        return "${UrlEncoding.trimTrailingSlashes(endpoint)}/v1/sets/$key/${Hexcode.of(emoji)}.svg$query"
    }

    public companion object {
        @JvmStatic
        public fun fromKey(key: String): EmojiSet? = entries.firstOrNull { it.key == key }
    }
}

/** Emojibase hexcodes, as `hexcodeOf` in packages/core. */
public object Hexcode {
    /**
     * The Emojibase hexcode of an emoji, with or without a skin tone: "👍🏽" → "1F44D-1F3FD",
     * "❤️" → "2764", "❤️‍🔥" → "2764-FE0F-200D-1F525". U+FE0F is dropped only when it follows a
     * single code point. Pack rows store the same value for base emoji.
     */
    @JvmStatic
    public fun of(emoji: String): String {
        val points = CodePoints.of(emoji)
        val count = if (points.size == 2 && points[1] == 0xFE0F) 1 else points.size
        return (0 until count).joinToString("-") { points[it].toString(16).uppercase().padStart(4, '0') }
    }
}
