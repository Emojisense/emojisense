package com.emojisense

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * `regional`: a word whose main sense differs by region ("football" is ⚽ outside North America).
 * It is the only kind that may put its emoji first, and only under the rules of
 * [CultureLayer.matchRegionalLead]. Everywhere else it adds after the top result like a lasting entry.
 */
public enum class CultureKind(public val key: String) {
    LASTING("lasting"),
    SEASONAL("seasonal"),
    EVENT("event"),
    REGIONAL("regional"),
    ;

    public companion object {
        /** A kind this SDK does not know behaves as a lasting entry (add after the top result, never above). */
        @JvmStatic
        public fun fromKey(key: String?): CultureKind = entries.firstOrNull { it.key == key } ?: LASTING
    }
}

/**
 * Inclusive days: "MM-DD" with `recurs = "yearly"` (may wrap the year end), else "YYYY-MM-DD".
 * A festival on a lunar calendar is one dated entry per year (e.g. `diwali-2026`).
 */
public data class CultureWindow(val from: String, val to: String, val recurs: String? = null) {
    val isYearly: Boolean get() = recurs == "yearly"
}

/** `[emoji, hexcode, weight]`, weight 0–1. */
public data class CultureEmoji(val emoji: String, val hexcode: String, val weight: Double)

public data class CultureEntry(
    val id: String,
    val kind: CultureKind = CultureKind.LASTING,
    /** Why these emoji fit, in the file's locale. Neutral, short. */
    val context: String = "",
    /** Null = always (lasting and regional entries). */
    val window: CultureWindow? = null,
    /** ISO 3166-1 alpha-2 codes, or `["*"]` for every region. */
    val regions: List<String> = listOf("*"),
    /** With `regions = ["*"]`: regions where the entry does not apply when the app names one. */
    val exceptRegions: List<String> = emptyList(),
    /** Normalized phrases (PACK_FORMAT.md §3) that people of this locale type. */
    val triggers: List<String> = emptyList(),
    /** Strongest first. */
    val emoji: List<CultureEmoji> = emptyList(),
    /** May appear on a "relevant now" shelf (seasonal and event entries only). */
    val featured: Boolean = false,
    /** Regional entries only: hexcodes of the canonical top answers this regional sense may move to second place. */
    val outranks: List<String> = emptyList(),
)

/** One locale's culture file: `culture.<locale>.json` (PACK_FORMAT.md §9). */
public data class Culture(
    val packVersion: String,
    val locale: String,
    /** Days the build covered (YYYY-MM-DD). Seasonal and event entries outside them are not in the file. */
    val from: String,
    val until: String,
    val entries: List<CultureEntry>,
    /** Ids of the featured entries active on [from], in shelf order (for clients that do not evaluate windows). */
    val relevantNow: List<String> = emptyList(),
) {
    public companion object {
        public const val FORMAT: String = "emojisense-culture"
        public const val FORMAT_VERSION: Int = 1

        /** Decodes and validates a culture file. Throws [EmojisenseException] for another format or version. */
        @JvmStatic
        public fun fromJson(json: String): Culture {
            val root = parseJsonObject(json, "culture file")
            root.requireFormat(FORMAT, FORMAT_VERSION)
            val entries = root["entries"] as? JsonArray
                ?: throw EmojisenseException.InvalidData("culture file has no entries")
            return Culture(
                packVersion = root.optionalString("packVersion") ?: "",
                locale = root.optionalString("locale") ?: "",
                from = root.optionalString("from") ?: "",
                until = root.optionalString("until") ?: "",
                entries = entries.map(::decodeEntry),
                relevantNow = root.optionalArray("relevantNow")?.mapNotNull { it.stringOrNull() } ?: emptyList(),
            )
        }

        @JvmStatic
        public fun fromJson(bytes: ByteArray): Culture = fromJson(bytes.decodeToString())

        private fun decodeEntry(element: JsonElement): CultureEntry {
            val entry = element as? JsonObject ?: throw EmojisenseException.InvalidData("a culture entry must be an object")
            return CultureEntry(
                id = entry.string("id"),
                kind = CultureKind.fromKey(entry.optionalString("kind")),
                context = entry.optionalString("context") ?: "",
                window = (entry["when"]?.takeUnless { it is JsonNull } as? JsonObject)?.let {
                    CultureWindow(from = it.string("from"), to = it.string("to"), recurs = it.optionalString("recurs"))
                },
                regions = entry.optionalArray("regions")?.strings("regions") ?: emptyList(),
                exceptRegions = entry.optionalArray("exceptRegions")?.strings("exceptRegions") ?: emptyList(),
                triggers = entry.optionalArray("triggers")?.strings("triggers") ?: emptyList(),
                emoji = entry.optionalArray("emoji")?.map(::decodeEmoji) ?: emptyList(),
                featured = entry.optionalBoolean("featured") == true,
                outranks = entry.optionalArray("outranks")?.strings("outranks") ?: emptyList(),
            )
        }

        private fun decodeEmoji(element: JsonElement): CultureEmoji {
            val item = element as? JsonArray
            val weight = (item?.getOrNull(2) as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull
            val emoji = item?.getOrNull(0).stringOrNull()
            val hexcode = item?.getOrNull(1).stringOrNull()
            if (emoji == null || hexcode == null || weight == null) {
                throw EmojisenseException.InvalidData("a culture emoji must be [emoji, hexcode, weight]")
            }
            return CultureEmoji(emoji, hexcode, weight)
        }
    }
}
