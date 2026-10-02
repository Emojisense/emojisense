package com.emojisense

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

/** Search fields of a pack row, strongest first, with their default weights (PACK_FORMAT.md §2). */
public enum class Field(public val key: String, public val defaultWeight: Double) {
    /** The normalized display label. Derived, not stored. */
    NAME("name", 1.0),
    SHORTCODE("shortcode", 0.95),
    KEYWORD("keyword", 0.85),
    ALIAS("alias", 0.8),
    TYPO("typo", 0.75),
    LOW("low", 0.55),
    ;

    public companion object {
        @JvmStatic
        public fun fromKey(key: String): Field? = entries.firstOrNull { it.key == key }
    }
}

/** One emoji of a pack: an 11-position JSON array (PACK_FORMAT.md §2, "Rows"). */
public data class PackRow(
    /** The emoji, fully qualified; `:shortcode:` in a custom pack. */
    val emoji: String,
    /** Emojibase hexcode of the base emoji, e.g. "1F44D" (the stable id); `C-<emojiId>` for custom emoji. */
    val hexcode: String,
    /** Index into [Pack.groups]. */
    val group: Int = 0,
    /** Emoji version that introduced it, e.g. 15.1. Hide rows the device cannot draw. */
    val version: Double = 1.0,
    val hasSkinTones: Boolean = false,
    /** Display label in the pack locale. Not normalized; empty in extension parts. */
    val label: String,
    /** `|`-joined normalized phrases per field, for every field except [Field.NAME]. */
    val shortcode: String = "",
    val keyword: String = "",
    val alias: String = "",
    val typo: String = "",
    val low: String = "",
) {
    /** The stored phrases of a field. [Field.NAME] is derived from [label] and returns "". */
    public fun phrases(field: Field): String = when (field) {
        Field.NAME -> ""
        Field.SHORTCODE -> shortcode
        Field.KEYWORD -> keyword
        Field.ALIAS -> alias
        Field.TYPO -> typo
        Field.LOW -> low
    }
}

/**
 * `core` renders first; `ext` holds the remaining aliases, typos and low-confidence phrases;
 * `custom` is an app's own emoji (GET /v1/custom-pack), drawn as images.
 */
public enum class PackPart(public val key: String) {
    CORE("core"),
    EXT("ext"),
    CUSTOM("custom"),
}

/** A client data pack, format v1: `pack.<locale>.json`, `pack.<locale>.ext.json` or a custom pack. */
public data class Pack(
    val packVersion: String,
    val locale: String,
    val part: PackPart = PackPart.CORE,
    val emojiVersion: String,
    val groups: List<String>,
    /** Field weight overrides. Fields without an entry use [Field.defaultWeight]. */
    val weights: Map<Field, Double> = emptyMap(),
    val emoji: List<PackRow>,
    /** Custom packs only: image URL per hexcode (`C-<emojiId>`). */
    val images: Map<String, String> = emptyMap(),
) {
    val isCustom: Boolean get() = part == PackPart.CUSTOM

    public fun weight(field: Field): Double = weights[field] ?: field.defaultWeight

    public companion object {
        public const val FORMAT: String = "emojisense-pack"
        public const val FORMAT_VERSION: Int = 1

        /** Hexcode prefix of custom emoji rows. It never collides with an Emojibase hexcode. */
        public const val CUSTOM_ID_PREFIX: String = "C-"

        /** Decodes and validates a pack file. Throws [EmojisenseException] for another format or version. */
        @JvmStatic
        public fun fromJson(json: String): Pack {
            val root = parseJsonObject(json, "pack")
            root.requireFormat(FORMAT, FORMAT_VERSION)
            val rows = root["emoji"] as? JsonArray ?: throw EmojisenseException.InvalidData("pack has no emoji rows")
            return Pack(
                packVersion = root.string("packVersion"),
                locale = root.string("locale"),
                part = PackPart.entries.firstOrNull { it.key == root.optionalString("part") } ?: PackPart.CORE,
                emojiVersion = root.optionalString("emojiVersion") ?: "",
                groups = root.optionalArray("groups")?.strings("groups") ?: emptyList(),
                weights = root.optionalObject("weights")?.let(::decodeWeights) ?: emptyMap(),
                emoji = rows.map(::decodeRow),
                images = root.optionalObject("images")?.mapNotNull { (key, value) ->
                    value.stringOrNull()?.let { key to it }
                }?.toMap() ?: emptyMap(),
            )
        }

        @JvmStatic
        public fun fromJson(bytes: ByteArray): Pack = fromJson(bytes.decodeToString())

        private fun decodeWeights(weights: JsonObject): Map<Field, Double> = weights.mapNotNull { (key, value) ->
            val field = Field.fromKey(key) ?: return@mapNotNull null
            (value as? JsonPrimitive)?.doubleOrNull?.let { field to it }
        }.toMap()

        private fun decodeRow(element: JsonElement): PackRow {
            val row = element as? JsonArray
            if (row == null || row.size < ROW_LENGTH) throw EmojisenseException.InvalidData("a pack row must have $ROW_LENGTH positions")
            fun text(position: Int) = row[position].stringOrNull()
                ?: throw EmojisenseException.InvalidData("pack row position $position must be a string")
            fun number(position: Int) = (row[position] as? JsonPrimitive)?.takeUnless { it.isString }
                ?: throw EmojisenseException.InvalidData("pack row position $position must be a number")
            return PackRow(
                emoji = text(0),
                hexcode = text(1),
                group = number(2).intOrNull ?: -1,
                version = number(3).doubleOrNull ?: 0.0,
                hasSkinTones = number(4).intOrNull == 1,
                label = text(5),
                shortcode = text(6),
                keyword = text(7),
                alias = text(8),
                typo = text(9),
                low = text(10),
            )
        }

        private const val ROW_LENGTH = 11
    }
}
