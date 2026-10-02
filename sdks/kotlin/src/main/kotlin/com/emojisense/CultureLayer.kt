package com.emojisense

import java.util.Calendar
import java.util.Locale

/** Options of [CultureLayer.matchCulture] and [CultureLayer.applyCulture]. */
public data class ApplyCultureOptions @JvmOverloads constructor(
    /**
     * ISO 3166-1 alpha-2 region, e.g. "BR". Without it, only entries for every region (`"*"`)
     * apply; regional entries need an explicit region.
     */
    val region: String? = null,
    /** The moment windows are checked against (epoch milliseconds, local calendar day). Default: now. */
    val now: Long? = null,
    /**
     * The calendar day windows are checked against, "YYYY-MM-DD". It wins over [now]. A server
     * passes the request's UTC day, because it does not know the user's.
     */
    val day: String? = null,
    /** Let the last word complete a trigger while the user is typing. */
    val prefix: Boolean = true,
    /** Length of the returned list. Default: the canonical results plus the culture results. */
    val limit: Int? = null,
    /** Label locale (with [engine]). */
    val locale: String? = null,
    /** Only add emoji this engine knows, with its glyph and label. */
    val engine: AliasEngine? = null,
)

/** Options of [CultureLayer.relevantNow]. */
public data class RelevantNowOptions @JvmOverloads constructor(
    /** Pick the file of this locale when several are given. */
    val locale: String? = null,
    val region: String? = null,
    val now: Long? = null,
    /** "YYYY-MM-DD"; wins over [now]. */
    val day: String? = null,
    val limit: Int = 8,
)

/** One emoji of the "relevant now" shelf. */
public data class RelevantEmoji(val emoji: String, val hexcode: String, val context: String, val cultureId: String)

/**
 * Culture layer: editorial associations that add emoji next to the canonical answer ("greatest
 * of all time" keeps 🐐 first and also shows ⚽ 🇦🇷 🇵🇹). PACK_FORMAT.md §9; a port of
 * packages/core/src/culture.ts.
 */
public object CultureLayer {
    private const val MAX_CULTURE_RESULTS = 5

    /** A typed prefix completes a trigger only when it is this long and covers half of the trigger. */
    private const val MIN_PREFIX_LENGTH = 3

    /** A BCP 47-style locale tag: "en", "pt", "zh-Hans", "pt-BR". Nothing that can change the URL path. */
    private val LOCALE_TAG = Regex("^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$")
    private val ISO_REGION = Regex("^[A-Z]{2}$")
    private val DAY = Regex("^\\d{4}-\\d{2}-\\d{2}$")

    /**
     * Fetches one locale's culture file, e.g. from `https://api.emojisense.com/v1/culture/0.1.0`.
     * It holds the windows of the next 12 months and changes only when a deploy brings new entries:
     * cache it for an hour, not forever.
     */
    @JvmStatic
    @JvmOverloads
    public suspend fun loadCulture(
        baseUrl: String,
        locale: String,
        transport: HttpTransport = UrlConnectionTransport(),
    ): Culture {
        if (!LOCALE_TAG.matches(locale)) throw EmojisenseException.InvalidLocale(locale)
        val url = "${UrlEncoding.trimTrailingSlashes(baseUrl)}/${UrlEncoding.uriComponent("culture.$locale.json")}"
        val response = transport.get(url)
        if (!response.isSuccess) throw EmojisenseException.HttpStatus(response.status, url)
        return Culture.fromJson(response.body)
    }

    /**
     * The ISO 3166-1 alpha-2 region of a BCP 47 locale tag: "pt-BR" → "BR", "zh-Hant-TW" → "TW".
     * Null when the tag has no such region ("en", "es-419") or is not a valid tag.
     */
    @JvmStatic
    public fun regionOf(locale: String): String? = LanguageTag.region(locale)?.takeIf { ISO_REGION.matches(it) }

    /**
     * The region of the device's language (`Locale.getDefault()`), the default region for culture
     * entries when an app gives none. It is read on the device and never sent anywhere.
     */
    @JvmStatic
    public fun deviceRegion(): String? = Locale.getDefault().country.uppercase(Locale.ROOT).takeIf { ISO_REGION.matches(it) }

    /** The local calendar day of `now` (epoch milliseconds) as "YYYY-MM-DD". */
    @JvmStatic
    @JvmOverloads
    public fun localDay(now: Long = System.currentTimeMillis()): String {
        val calendar = Calendar.getInstance()
        calendar.timeInMillis = now
        val month = (calendar.get(Calendar.MONTH) + 1).toString().padStart(2, '0')
        val day = calendar.get(Calendar.DAY_OF_MONTH).toString().padStart(2, '0')
        return "${calendar.get(Calendar.YEAR)}-$month-$day"
    }

    /**
     * The day a scope checks windows against: [day] when given (it must be "YYYY-MM-DD"), else the
     * local calendar day of [now] (default: now).
     */
    @JvmStatic
    @JvmOverloads
    public fun scopeDay(day: String? = null, now: Long? = null): String {
        if (day == null) return localDay(now ?: System.currentTimeMillis())
        if (!DAY.matches(day)) throw EmojisenseException.InvalidData("culture day must be YYYY-MM-DD, got \"$day\"")
        return day
    }

    /** Is a window active on `day` ("YYYY-MM-DD")? Null = always. Yearly windows may wrap the year end. */
    @JvmStatic
    public fun isActiveOn(window: CultureWindow?, day: String): Boolean {
        if (window == null) return true
        if (!window.isYearly) return window.from <= day && day <= window.to
        val monthDay = day.substring(minOf(5, day.length))
        return if (window.from <= window.to) {
            window.from <= monthDay && monthDay <= window.to
        } else {
            monthDay >= window.from || monthDay <= window.to
        }
    }

    /** Culture results for a query (active window and region only), strongest first. At most [ApplyCultureOptions.limit] (5). */
    @JvmStatic
    @JvmOverloads
    public fun matchCulture(culture: Culture, query: String, options: ApplyCultureOptions = ApplyCultureOptions()): List<CultureResult> {
        val normalized = Normalizer.normalize(query)
        if (normalized.isEmpty()) return emptyList()
        val typing = options.prefix && !endsWithJavaScriptWhitespace(query)
        val day = scopeDay(options.day, options.now)
        val best = LinkedHashMap<String, CultureResult>()
        for (entry in culture.entries) {
            if (!inScope(entry, options.region, day)) continue
            var quality = 0.0
            var match = ""
            for (trigger in entry.triggers) {
                val value = triggerQuality(trigger, normalized, typing)
                if (value > quality) {
                    quality = value
                    match = trigger
                }
            }
            if (quality == 0.0) continue
            for (item in entry.emoji) {
                val score = roundScore(item.weight * quality)
                if (score <= (best[item.hexcode]?.score ?: 0.0)) continue
                best[item.hexcode] = CultureResult(
                    emoji = item.emoji,
                    id = item.hexcode,
                    score = score,
                    context = entry.context,
                    cultureId = entry.id,
                    match = match,
                )
            }
        }
        return best.values.sortedWith { a, b -> b.score.compareTo(a.score) }.take(maxOf(0, options.limit ?: MAX_CULTURE_RESULTS))
    }

    /**
     * The regional sense that leads the list, if any. All of these must hold:
     * - the entry is regional and the app named a region in its scope (no region, no lead);
     * - the normalized query equals one of its triggers (a prefix being typed is not enough);
     * - the canonical top result is one of its `outranks` hexcodes, the reading the editor saw.
     *
     * The lead is the entry's strongest emoji. When several entries qualify, the strongest wins.
     */
    @JvmStatic
    @JvmOverloads
    public fun matchRegionalLead(
        culture: Culture,
        query: String,
        canonicalTopId: String?,
        region: String?,
        now: Long? = null,
        day: String? = null,
    ): CultureResult? {
        if (region.isNullOrEmpty() || canonicalTopId == null) return null
        val normalized = Normalizer.normalize(query)
        val scope = scopeDay(day, now)
        var lead: CultureResult? = null
        for (entry in culture.entries) {
            if (entry.kind != CultureKind.REGIONAL || canonicalTopId !in entry.outranks) continue
            if (normalized !in entry.triggers || !inScope(entry, region, scope)) continue
            var strongest: CultureEmoji? = null
            for (item in entry.emoji) if (strongest == null || item.weight > strongest.weight) strongest = item
            if (strongest == null || strongest.hexcode == canonicalTopId) continue
            if (lead != null && lead.score >= strongest.weight) continue
            lead = CultureResult(
                emoji = strongest.emoji,
                id = strongest.hexcode,
                score = strongest.weight,
                context = entry.context,
                cultureId = entry.id,
                match = normalized,
            )
        }
        return lead
    }

    /**
     * Adds culture results right after the canonical top result. They never go above it, unless
     * the canonical list is empty or a regional [lead] is given: the lead goes first and the
     * canonical top result second. An emoji that is already lower in the list moves up and carries
     * its cultural context.
     */
    @JvmStatic
    @JvmOverloads
    public fun insertCulture(
        results: List<SearchResult>,
        matches: List<CultureResult>,
        limit: Int = results.size + matches.size + 1,
        lead: CultureResult? = null,
    ): List<SearchResult> {
        val top = results.firstOrNull() ?: return matches.take(maxOf(0, limit))
        val head: List<SearchResult> = if (lead != null && lead.id != top.id) listOf(lead, top) else listOf(top)
        val ids = head.mapTo(HashSet()) { it.id }
        val added = matches.filter { it.id !in ids }
        added.forEach { ids.add(it.id) }
        return (head + added + results.drop(1).filter { it.id !in ids }).take(maxOf(0, limit))
    }

    /** [matchCulture], [matchRegionalLead] and [insertCulture] in one step. */
    @JvmStatic
    @JvmOverloads
    public fun applyCulture(
        results: List<SearchResult>,
        culture: Culture,
        query: String,
        options: ApplyCultureOptions = ApplyCultureOptions(),
    ): List<SearchResult> {
        val engine = options.engine
        fun withLabel(match: CultureResult): CultureResult? {
            if (engine == null) return match
            val entry = engine.entry(match.id) ?: return null
            val label = entry.labels[options.locale ?: ""] ?: entry.labels["en"] ?: entry.labels.values.firstOrNull() ?: ""
            return match.copy(emoji = entry.emoji, label = label)
        }
        val matches = matchCulture(culture, query, options.copy(limit = MAX_CULTURE_RESULTS)).mapNotNull(::withLabel)
        val lead = matchRegionalLead(culture, query, results.firstOrNull()?.id, options.region, options.now, options.day)
        val limit = options.limit ?: (results.size + matches.size + 1)
        return insertCulture(results, matches, limit, lead?.let(::withLabel))
    }

    /**
     * Emoji for an optional "relevant now" shelf: featured seasonal and event entries that are
     * active today, one emoji per entry in turn (so two festivals share the shelf), in file order.
     */
    @JvmStatic
    @JvmOverloads
    public fun relevantNow(cultures: List<Culture>, options: RelevantNowOptions = RelevantNowOptions()): List<RelevantEmoji> {
        val file = (if (options.locale != null) cultures.firstOrNull { it.locale == options.locale } else cultures.firstOrNull())
            ?: return emptyList()
        val day = scopeDay(options.day, options.now)
        val entries = file.entries.filter {
            it.featured && (it.kind == CultureKind.SEASONAL || it.kind == CultureKind.EVENT) && inScope(it, options.region, day)
        }
        val shelf = mutableListOf<RelevantEmoji>()
        val seen = HashSet<String>()
        val depth = entries.maxOfOrNull { it.emoji.size } ?: 0
        for (i in 0 until depth) {
            if (shelf.size >= options.limit) break
            for (entry in entries) {
                val item = entry.emoji.getOrNull(i) ?: continue
                if (!seen.add(item.hexcode)) continue
                shelf.add(RelevantEmoji(item.emoji, item.hexcode, entry.context, entry.id))
                if (shelf.size == options.limit) break
            }
        }
        return shelf
    }

    @JvmStatic
    @JvmOverloads
    public fun relevantNow(culture: Culture, options: RelevantNowOptions = RelevantNowOptions()): List<RelevantEmoji> =
        relevantNow(listOf(culture), options)

    private fun inScope(entry: CultureEntry, region: String?, day: String): Boolean {
        val code = region?.uppercase(Locale.ROOT)
        val listed = "*" in entry.regions || (code != null && code in entry.regions)
        val excepted = code != null && code in entry.exceptRegions
        return listed && !excepted && isActiveOn(entry.window, day)
    }

    /** How well a normalized query hits a trigger: 1 exact, < 1 a prefix being typed, 0 no match. */
    private fun triggerQuality(trigger: String, query: String, typing: Boolean): Double {
        if (trigger == query) return 1.0
        if (typing && query.length >= MIN_PREFIX_LENGTH && 2 * query.length >= trigger.length && trigger.startsWith(query)) {
            return 0.6 + (0.4 * query.length) / trigger.length
        }
        return 0.0
    }
}

/** The region subtag of a BCP 47 language tag, parsed like `Intl.Locale` (well-formed tags only). */
internal object LanguageTag {
    private val LANGUAGE = Regex("^([A-Za-z]{2,3}|[A-Za-z]{5,8})$")
    private val SCRIPT = Regex("^[A-Za-z]{4}$")
    private val REGION = Regex("^([A-Za-z]{2}|[0-9]{3})$")
    private val VARIANT = Regex("^([A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3})$")
    private val EXTENSION = Regex("^[A-Za-z0-9]{1,8}$")

    /** The region subtag, uppercase, or null when there is none or the tag is not well formed. */
    fun region(tag: String): String? {
        val subtags = tag.split('-')
        if (subtags.isEmpty() || !LANGUAGE.matches(subtags[0])) return null
        var position = 1
        if (position < subtags.size && SCRIPT.matches(subtags[position])) position++
        var region: String? = null
        if (position < subtags.size && REGION.matches(subtags[position])) region = subtags[position++].uppercase(Locale.ROOT)
        while (position < subtags.size && VARIANT.matches(subtags[position])) position++
        // Extensions and private use: singleton subtags followed by 1–8 alphanumerics.
        while (position < subtags.size) {
            if (subtags[position].length != 1 || position + 1 >= subtags.size) return null
            position++
            val start = position
            while (position < subtags.size && subtags[position].length > 1 && EXTENSION.matches(subtags[position])) position++
            if (position == start) return null
        }
        return region
    }
}
