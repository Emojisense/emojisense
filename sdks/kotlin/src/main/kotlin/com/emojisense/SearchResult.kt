package com.emojisense

/** Where a result came from. */
public enum class ResultSource(public val key: String) {
    ALIAS("alias"),
    SEMANTIC("semantic"),

    /** An app's own emoji, drawn as an image ([SearchResult.imageUrl]). */
    CUSTOM("custom"),

    /** An editorial association of the culture layer ([CultureResult]). */
    CULTURE("culture"),

    /** The server's concept tier: an LLM's reading of an unsure query, checked against the catalog ([ConceptInfo]). */
    CONCEPT("concept"),
    ;

    public companion object {
        @JvmStatic
        public fun fromKey(key: String): ResultSource? = entries.firstOrNull { it.key == key }
    }
}

/** One ranked emoji from any tier. */
public sealed interface SearchResult {
    /** The emoji character, or `:shortcode:` for a custom emoji. */
    public val emoji: String

    /** Emojibase hexcode of the base emoji, e.g. "1F44D"; `C-<emojiId>` for a custom emoji. */
    public val id: String

    /** 0–1. Comparable within one source only. */
    public val score: Double
    public val source: ResultSource

    /** Custom emoji only: the image to draw instead of a font glyph. */
    public val imageUrl: String?

    /** Custom emoji only: the shortcode without colons, e.g. "party_parrot". */
    public val shortcode: String?
}

/** A result as the semantic tiers (shards, API) return it. */
public data class EmojiResult(
    override val emoji: String,
    override val id: String,
    override val score: Double,
    override val source: ResultSource,
    override val imageUrl: String? = null,
    override val shortcode: String? = null,
) : SearchResult

/** A Tier 0 (alias dictionary) result. */
public data class AliasResult(
    override val emoji: String,
    override val id: String,
    /** 0–1, rounded to 3 decimals. */
    override val score: Double,
    /** [ResultSource.ALIAS], or [ResultSource.CUSTOM] for a row of a custom pack. */
    override val source: ResultSource,
    /** Display label in the requested locale, else in the primary pack locale. */
    val label: String,
    /** The phrase that matched best, for debugging and "why this result" UI. */
    val match: String,
    val field: Field,
    override val imageUrl: String? = null,
    override val shortcode: String? = null,
) : SearchResult

/** An emoji the culture layer adds next to the canonical answer (PACK_FORMAT.md §9). */
public data class CultureResult(
    override val emoji: String,
    override val id: String,
    override val score: Double,
    /** The reason, in the culture file's locale. */
    val context: String,
    val cultureId: String,
    /** The trigger that matched. */
    val match: String,
    /** Display label from the engine; empty without one. */
    val label: String = "",
) : SearchResult {
    override val source: ResultSource get() = ResultSource.CULTURE
    override val imageUrl: String? get() = null
    override val shortcode: String? get() = null
}

/** One emoji of the loaded packs. */
public data class EmojiEntry(
    val emoji: String,
    val id: String,
    val group: String,
    val version: Double,
    val hasSkinTones: Boolean,
    /** Display label per loaded locale, in pack order. */
    val labels: Map<String, String>,
    /** Custom emoji only (see [SearchResult]). */
    val imageUrl: String? = null,
    val shortcode: String? = null,
)
