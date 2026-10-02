package com.emojisense

/** Options of [AliasEngine.search]. */
public data class AliasSearchOptions @JvmOverloads constructor(
    /** Maximum number of results. */
    val limit: Int = 24,
    /** Preferred locale. Matches that exist only in other loaded packs get a small penalty. */
    val locale: String? = null,
    /** Treat the last token as a prefix while the user is still typing. */
    val prefix: Boolean = true,
    /** `false` = the canonical ranking only, even when the engine has a culture file (reproducible). */
    val culture: Boolean = true,
    /** ISO 3166-1 alpha-2 region for regional culture entries, e.g. "BR". */
    val region: String? = null,
    /** The moment culture windows are checked against (epoch milliseconds, local calendar day). Default: now. */
    val now: Long? = null,
    /** The calendar day culture windows are checked against, "YYYY-MM-DD". It wins over [now]. */
    val day: String? = null,
)

/** What a search returns. With culture results, [results] holds [CultureResult]s after the top result. */
public data class AliasSearchOutput<out R : SearchResult>(
    /** The normalized query that was searched. */
    val query: String,
    val tokens: List<String>,
    val results: List<R>,
    /** Score of the best canonical result, 0 when there is none. */
    val confidence: Double,
    /**
     * 0–1, rounded to 3 decimals: the largest IDF-weighted share of the query that one phrase
     * matches with whole tokens (exact, a typo of the token, or a completion of the token being
     * typed into a word of the preferred locale). A prefix completion into another locale's word is
     * a partial match and does not count. Below [Confidence.WHOLE_COVERAGE] the dictionary does not
     * explain the query: "kendrick lamar" matches at most "lamar". PACK_FORMAT.md §4.
     */
    val coverage: Double = 0.0,
)

/**
 * Tier 0: offline alias search over one or more packs (PACK_FORMAT.md §4).
 *
 * A port of `createEngine` in packages/core/src/engine.ts with the same ranking and the same
 * scores. Searching is thread-safe: concurrent calls share the scratch buffers of the index and
 * run one at a time, so a keystroke allocates no per-phrase state.
 */
public class AliasEngine private constructor(
    private val searcher: Searcher,
    /** The culture file whose entries add results after the canonical top result, or null. */
    public val culture: Culture?,
) {
    /**
     * Builds the index from packs in index order (PACK_FORMAT.md §2): every core part first,
     * English first, then the extension parts, then custom packs.
     */
    @JvmOverloads
    public constructor(
        packs: List<Pack>,
        minCoverage: Double = DEFAULT_MIN_COVERAGE,
        culture: Culture? = null,
        /** false = ignore the packs' `popularity`: equal scores keep row order. */
        popularity: Boolean = true,
    ) : this(Searcher(AliasIndex(packs, popularity), minCoverage), culture)

    /** Builds the index from the core parts, then the extension parts. */
    @JvmOverloads
    public constructor(
        core: List<Pack>,
        extensions: List<Pack>,
        minCoverage: Double = DEFAULT_MIN_COVERAGE,
        culture: Culture? = null,
    ) : this(core + extensions, minCoverage, culture)

    public val entries: List<EmojiEntry> get() = searcher.index.entries

    /** Locales of the loaded packs, custom packs excepted. */
    public val locales: List<String> get() = searcher.index.locales
    public val packVersion: String get() = searcher.index.primary.packVersion

    public fun entry(id: String): EmojiEntry? = searcher.index.indexById[id]?.let { searcher.index.entries[it] }

    /** How often people use the emoji, 0–1, from the packs' `popularity` (0 = unknown). */
    public fun popularity(id: String): Double =
        searcher.index.indexById[id]?.let { searcher.index.entryPopularity[it] / 100.0 } ?: 0.0

    /** The same index with another culture file (null = none). The index is shared, not rebuilt. */
    public fun withCulture(culture: Culture?): AliasEngine = AliasEngine(searcher, culture)

    /** The canonical ranking, plus culture results after its top result when the engine has a culture file. */
    @JvmOverloads
    public fun search(query: String, options: AliasSearchOptions = AliasSearchOptions()): AliasSearchOutput<SearchResult> {
        val output = canonicalSearch(query, options)
        val culture = culture
        if (culture == null || !options.culture) return output
        val results = CultureLayer.applyCulture(
            output.results,
            culture,
            query,
            ApplyCultureOptions(
                region = options.region,
                now = options.now,
                day = options.day,
                prefix = options.prefix,
                limit = options.limit,
                locale = options.locale,
                engine = this,
            ),
        )
        return AliasSearchOutput(output.query, output.tokens, results, output.confidence, output.coverage)
    }

    /** The canonical ranking only, as alias results (the culture option is ignored). */
    @JvmOverloads
    public fun canonicalSearch(query: String, options: AliasSearchOptions = AliasSearchOptions()): AliasSearchOutput<AliasResult> =
        searcher.search(query, options)

    public companion object {
        /**
         * Minimum IDF-weighted share of the query a phrase must cover (0–1). Higher = fewer partial
         * matches on multi-word queries.
         */
        public const val DEFAULT_MIN_COVERAGE: Double = 0.34
    }
}

/** The ranking of PACK_FORMAT.md §4 over one index, with its reusable scratch space. */
internal class Searcher(val index: AliasIndex, private val minCoverage: Double) {
    private val quality = FloatArray(index.phraseCount * MAX_QUERY_TOKENS)

    /** Bit i set = query token i matches the phrase by a whole-token candidate (not a partial one). */
    private val phraseWhole = ByteArray(index.phraseCount)
    private val phraseStamp = IntArray(index.phraseCount)
    private val touchedPhrases = IntArray(index.phraseCount)
    private val emojiStamp = IntArray(index.entries.size)
    private val emojiScore = DoubleArray(index.entries.size)
    private val emojiPhrase = IntArray(index.entries.size)

    /** Matching phrases from preferred-locale packs, the best phrase included. */
    private val emojiPreferred = IntArray(index.entries.size)

    /** The emoji has an exact whole-query name, shortcode, keyword or alias match in a preferred-locale pack. */
    private val emojiExactPreferred = BooleanArray(index.entries.size)

    /** The emoji's best phrase is an exact whole-query match. */
    private val emojiBestExact = BooleanArray(index.entries.size)

    /** The emoji's best phrase needs a partial match (a prefix completion into another locale's word). */
    private val emojiBestPartial = BooleanArray(index.entries.size)
    private val touchedEmoji = IntArray(index.entries.size)
    private val editDistance = EditDistance()
    private var generation = 0

    private class Scored(val emoji: Int, val phrase: Int, var score: Double)

    /** The ranked emoji, and the largest share of the query one phrase matches with whole tokens. */
    private class Ranking(val scored: List<Scored>, val wholeCoverage: Double)

    fun search(query: String, options: AliasSearchOptions): AliasSearchOutput<AliasResult> {
        val normalized = Normalizer.normalize(query)
        val lastIsPrefix = options.prefix && !endsWithJavaScriptWhitespace(query)
        val functionWords = FunctionWords.active(options.locale ?: index.primary.locale)
        val tokens = queryTokens(normalized, lastIsPrefix, functionWords)
        if (tokens.isEmpty()) return AliasSearchOutput(normalized, tokens, emptyList(), 0.0, 0.0)
        val (results, wholeCoverage) = synchronized(this) {
            val ranking = rank(tokens, lastIsPrefix, functionWords, options.locale)
            ranking.scored.take(maxOf(0, options.limit)).map { result(it, options.locale) } to ranking.wholeCoverage
        }
        return AliasSearchOutput(normalized, tokens, results, results.firstOrNull()?.score ?: 0.0, roundScore(wholeCoverage))
    }

    /** Scores every phrase the query touches and keeps the best phrase per emoji. Caller holds the lock. */
    private fun rank(tokens: List<String>, lastIsPrefix: Boolean, functionWords: Set<String>, locale: String?): Ranking {
        val count = tokens.size
        val preferredMask = (index.preferredMasks[locale ?: index.primary.locale] ?: 1) or index.customMask
        fun isPreferred(phrase: Int) = (index.phraseLocaleMask[phrase] and preferredMask) != 0
        startSearch()

        val isFunctionWord = tokens.map { it in functionWords }
        // Next to a content word, a function word neither completes as a prefix ("了" is not "了解")
        // nor stands for a typo. A query of function words only ("я тоже") is searched as typed.
        val hasContentWord = false in isFunctionWord
        // Query tokens without any candidate: the dictionary does not know them.
        var unknownTokens = 0
        var touchedPhraseCount = 0
        val weights = DoubleArray(count)
        tokens.forEachIndexed { position, token ->
            val partial = HashSet<Int>()
            val candidates = if (hasContentWord && isFunctionWord[position]) {
                exactly(token)
            } else {
                expand(token, lastIsPrefix && position == count - 1, preferredMask, partial)
            }
            // A function word the vocabulary lacks is not an unknown word of the query.
            if (candidates.isEmpty() && !isFunctionWord[position]) unknownTokens++
            val bit = 1 shl position
            var bestQuality = 0.0
            var weight = index.maxIdf
            for ((id, candidateQuality) in candidates) {
                if (candidateQuality > bestQuality) {
                    bestQuality = candidateQuality
                    weight = index.idf[id]
                }
                val whole = id !in partial
                for (posting in index.postingStart[id] until index.postingStart[id + 1]) {
                    val phrase = index.postings[posting]
                    val base = phrase * MAX_QUERY_TOKENS
                    if (phraseStamp[phrase] != generation) {
                        phraseStamp[phrase] = generation
                        quality.fill(0f, base, base + count)
                        phraseWhole[phrase] = 0
                        touchedPhrases[touchedPhraseCount++] = phrase
                    }
                    if (candidateQuality > quality[base + position]) quality[base + position] = candidateQuality.toFloat()
                    if (whole) phraseWhole[phrase] = (phraseWhole[phrase].toInt() or bit).toByte()
                }
            }
            weights[position] = if (isFunctionWord[position]) minOf(weight, FUNCTION_WORD_WEIGHT_CAP) else weight
        }
        var totalWeight = 0.0
        for (weight in weights) totalWeight += weight

        var touchedEmojiCount = 0
        var bestWholeCoverage = 0.0
        for (t in 0 until touchedPhraseCount) {
            val phrase = touchedPhrases[t]
            val base = phrase * MAX_QUERY_TOKENS
            val wholeBits = phraseWhole[phrase].toInt() and 0xFF
            var covered = 0.0
            var wholeCovered = 0.0
            var matched = 0
            var exactTokens = 0
            var partialMatch = false
            for (i in 0 until count) {
                val value = quality[base + i].toDouble()
                if (value > 0) {
                    matched++
                    if (((wholeBits shr i) and 1) != 0) wholeCovered += weights[i] else partialMatch = true
                }
                if (value == 1.0) exactTokens++
                covered += value * weights[i]
            }
            val allExact = exactTokens == count
            val coverage = covered / totalWeight
            if (coverage < minCoverage) continue
            // A prefix or typo match of one token cannot stand for a query whose other words the
            // dictionary does not know: en "kendrick lamar" is not 💍 (id "lamaran") or 🦙 ("lama").
            if (unknownTokens > 0 && matched == 1 && exactTokens == 0) continue
            val wholeCoverage = wholeCovered / totalWeight
            if (wholeCoverage > bestWholeCoverage) bestWholeCoverage = wholeCoverage

            val length = index.phraseLength[phrase]
            val preferred = isPreferred(phrase)
            val exact = allExact && length == count
            val score = index.phraseFieldWeight[phrase] *
                coverage *
                (0.6 + 0.4 * minOf(1.0, matched.toDouble() / length)) *
                (if (exact) (if (count >= 2) EXACT_PHRASE_BONUS else 1.0) else NON_EXACT_FACTOR) *
                (if (preferred) 1.0 else FOREIGN_LOCALE_FACTOR)

            val emoji = index.phraseEmoji[phrase]
            if (emojiStamp[emoji] != generation) {
                emojiStamp[emoji] = generation
                emojiScore[emoji] = score
                emojiPhrase[emoji] = phrase
                emojiPreferred[emoji] = 0
                emojiExactPreferred[emoji] = false
                emojiBestExact[emoji] = exact
                emojiBestPartial[emoji] = partialMatch
                touchedEmoji[touchedEmojiCount++] = emoji
            } else if (score > emojiScore[emoji]) {
                emojiScore[emoji] = score
                emojiPhrase[emoji] = phrase
                emojiBestExact[emoji] = exact
                emojiBestPartial[emoji] = partialMatch
            }
            if (preferred) {
                emojiPreferred[emoji]++
                if (exact && index.phraseField[phrase] < STRONG_FIELDS) emojiExactPreferred[emoji] = true
            }
        }

        // Only phrases of the preferred locale add evidence: with many locales loaded, other
        // languages would otherwise lift every emoji that shares a loanword to the bonus cap.
        val scored = ArrayList<Scored>(touchedEmojiCount)
        for (t in 0 until touchedEmojiCount) {
            val emoji = touchedEmoji[t]
            val best = emojiPhrase[emoji]
            val support = emojiPreferred[emoji] - (if (isPreferred(best)) 1 else 0)
            val score = minOf(1.0, emojiScore[emoji] + minOf(MAX_EVIDENCE_BONUS, support * EVIDENCE_BONUS))
            scored.add(Scored(emoji, best, score))
        }
        capPartialBelowWhole(scored, ::isPreferred)

        // An exact name, shortcode, keyword or alias match in a preferred-locale pack beats an
        // exact name or shortcode match that only another pack has (PACK_FORMAT.md §4).
        var topExactPreferred = 0.0
        for (candidate in scored) {
            if (emojiExactPreferred[candidate.emoji] && candidate.score > topExactPreferred) topExactPreferred = candidate.score
        }
        if (topExactPreferred > 0) {
            for (candidate in scored) {
                if (!emojiExactPreferred[candidate.emoji] && emojiBestExact[candidate.emoji] &&
                    index.phraseField[candidate.phrase] < DOMINANT_FIELDS && !isPreferred(candidate.phrase)
                ) {
                    candidate.score = minOf(candidate.score, topExactPreferred - CAP_MARGIN)
                }
            }
        }
        capForeignPrefixBelowPreferred(scored, ::isPreferred)
        // Equal scores: the more used emoji first (pack `popularity`), then row order (PACK_FORMAT.md §4).
        val popularity = index.entryPopularity
        scored.sortWith { a, b ->
            b.score.compareTo(a.score).takeIf { it != 0 }
                ?: popularity[b.emoji].compareTo(popularity[a.emoji]).takeIf { it != 0 }
                ?: a.emoji.compareTo(b.emoji)
        }
        return Ranking(scored, bestWholeCoverage)
    }

    /**
     * A prefix completion into another locale's word never outranks a preferred-locale match: an
     * emoji whose best phrase needs one scores at most [CAP_MARGIN] below the lowest emoji whose
     * best phrase is in a preferred-locale pack and needs none (PACK_FORMAT.md §4).
     */
    private fun capForeignPrefixBelowPreferred(scored: List<Scored>, isPreferred: (Int) -> Boolean) {
        var lowestPreferred = Double.POSITIVE_INFINITY
        for (candidate in scored) {
            if (!emojiBestPartial[candidate.emoji] && isPreferred(candidate.phrase) && candidate.score < lowestPreferred) {
                lowestPreferred = candidate.score
            }
        }
        if (lowestPreferred == Double.POSITIVE_INFINITY) return
        val cap = maxOf(0.0, lowestPreferred - CAP_MARGIN)
        for (candidate in scored) {
            if (emojiBestPartial[candidate.emoji]) candidate.score = minOf(candidate.score, cap)
        }
    }

    /**
     * The evidence bonus breaks near-ties. It never lifts an emoji whose best phrase matches only
     * part of the query above one whose best phrase is the whole query, in a preferred-locale pack,
     * with a higher phrase score. Such an emoji scores at most [CAP_MARGIN] below the lowest of them.
     */
    private fun capPartialBelowWhole(scored: List<Scored>, isPreferred: (Int) -> Boolean) {
        val whole = scored
            .filter { emojiBestExact[it.emoji] && isPreferred(it.phrase) }
            .sortedWith { a, b -> emojiScore[b.emoji].compareTo(emojiScore[a.emoji]) }
        if (whole.isEmpty()) return
        // lowest[i] = the lowest score among the i + 1 whole-query matches with the highest phrase scores.
        val lowest = DoubleArray(whole.size)
        whole.forEachIndexed { i, candidate -> lowest[i] = if (i == 0) candidate.score else minOf(candidate.score, lowest[i - 1]) }
        for (candidate in scored) {
            if (emojiBestExact[candidate.emoji]) continue
            val phraseScore = emojiScore[candidate.emoji]
            var above = 0
            var end = whole.size
            while (above < end) {
                val middle = (above + end) ushr 1
                if (emojiScore[whole[middle].emoji] > phraseScore) above = middle + 1 else end = middle
            }
            if (above > 0) candidate.score = minOf(candidate.score, lowest[above - 1] - CAP_MARGIN)
        }
    }

    private fun result(scored: Scored, locale: String?): AliasResult {
        val entry = index.entries[scored.emoji]
        return AliasResult(
            emoji = entry.emoji,
            id = entry.id,
            score = roundScore(scored.score),
            source = if (entry.shortcode == null) ResultSource.ALIAS else ResultSource.CUSTOM,
            label = entry.labels[locale ?: ""] ?: entry.labels[index.primary.locale] ?: entry.shortcode ?: "",
            match = index.phraseText[scored.phrase],
            field = Field.entries[index.phraseField[scored.phrase].toInt()],
            imageUrl = entry.imageUrl,
            shortcode = entry.shortcode?.ifEmpty { null },
        )
    }

    private fun startSearch() {
        generation++
        if (generation == 0) {
            // The stamps wrapped around: clear them so no slot looks current.
            phraseStamp.fill(0)
            emojiStamp.fill(0)
            generation = 1
        }
    }

    // ── Query tokens ─────────────────────────────────────────────────────────────────────────

    /**
     * Query tokens. A token of an unspaced script that is not in the vocabulary (and, while
     * typing, is not the start of one) is split into the vocabulary tokens and function words it holds.
     */
    private fun queryTokens(normalized: String, lastIsPrefix: Boolean, functionWords: Set<String>): List<String> {
        val tokens = Normalizer.tokenize(normalized).take(MAX_QUERY_TOKENS)
        return tokens.flatMapIndexed { position, token ->
            when {
                index.tokenIds.containsKey(token) || !isUnspacedScript(token) -> listOf(token)
                lastIsPrefix && position == tokens.size - 1 && completes(token) -> listOf(token)
                else -> segment(token, functionWords)
            }
        }.take(MAX_QUERY_TOKENS)
    }

    /** The vocabulary token equal to [token], if any: a function word next to content words matches only itself. */
    private fun exactly(token: String): Map<Int, Double> = index.tokenIds[token]?.let { mapOf(it to 1.0) } ?: emptyMap()

    /** Does a longer vocabulary token start with `prefix`? */
    private fun completes(prefix: String): Boolean = index.vocabulary.getOrNull(lowerBound(prefix))?.startsWith(prefix) ?: false

    /**
     * Splits a run of an unspaced script into vocabulary tokens and function words, longest match
     * first from the left. Code points where neither starts stay together as one unknown piece.
     */
    private fun segment(run: String, functionWords: Set<String>): List<String> {
        val points = CodePoints.of(run)
        val offsets = IntArray(points.size + 1)
        for (i in 0 until points.size) offsets[i + 1] = offsets[i] + Character.charCount(points[i])
        val text = { start: Int, end: Int -> run.substring(offsets[start], offsets[end]) }
        val pieces = mutableListOf<String>()
        var unknownStart = -1
        var start = 0
        while (start < points.size) {
            var length = minOf(MAX_PIECE_LENGTH, points.size - start)
            while (length > 0 && text(start, start + length).let { !index.tokenIds.containsKey(it) && it !in functionWords }) {
                length--
            }
            if (length == 0) {
                if (unknownStart < 0) unknownStart = start
                start++
                continue
            }
            if (unknownStart >= 0) pieces.add(text(unknownStart, start))
            unknownStart = -1
            pieces.add(text(start, start + length))
            start += length
        }
        if (unknownStart >= 0) pieces.add(text(unknownStart, points.size))
        return pieces
    }

    // ── Query expansion ──────────────────────────────────────────────────────────────────────

    /**
     * Vocabulary tokens a query token may stand for, with a match quality in (0, 1], in the order
     * the reference engine finds them (the order breaks ties for the token weight). [partial] gets
     * the prefix completions into words that no preferred-locale pack has: they match with less
     * quality and never count as whole-token coverage.
     */
    private fun expand(token: String, asPrefix: Boolean, preferredMask: Int, partial: MutableSet<Int>): Map<Int, Double> {
        val candidates = LinkedHashMap<Int, Double>()
        fun add(id: Int, quality: Double) {
            if (quality > (candidates[id] ?: 0.0)) candidates[id] = quality
        }
        fun isPreferredToken(id: Int) = (index.tokenLocaleMask[id] and preferredMask) != 0
        val exact = index.tokenIds[token]
        if (exact != null) add(exact, 1.0)

        var prefixMatches = 0
        if (asPrefix) {
            val start = lowerBound(token)
            var position = start
            while (position < index.vocabulary.size && position < start + MAX_PREFIX_EXPANSION) {
                val candidate = index.vocabulary[position]
                if (!candidate.startsWith(token)) break
                if (candidate.length > token.length) {
                    val quality = 0.6 + (0.35 * token.length) / candidate.length
                    if (isPreferredToken(position)) {
                        add(position, quality)
                    } else {
                        add(position, quality * FOREIGN_PREFIX_QUALITY)
                        partial.add(position)
                    }
                    prefixMatches++
                }
                position++
            }
        }

        // While a word is still being typed and it already completes to real words, it is not a typo.
        if (exact != null || prefixMatches > 0) return candidates
        // "upp" → "up", "happpy" → "happy": a repeated final letter is the most common slip.
        Fuzzy.squeezeRepeatedEnding(token)?.let { squeezed -> index.tokenIds[squeezed]?.let { add(it, 0.85) } }
        val maxEdits = Fuzzy.maxEdits(token.length)
        // With no edits allowed only an exact match could qualify, and there is none.
        if (maxEdits == 0) return candidates
        val short = token.length <= SHORT_TYPO_LENGTH
        for (length in token.length - maxEdits..token.length + maxEdits) {
            for (id in index.tokenIdsByLength[length] ?: continue) {
                val candidate = index.vocabulary[id]
                if (!Fuzzy.isPlausibleTypo(token, candidate)) continue
                // A short token is a typo only of a preferred-locale word, and never of a word it
                // extends: en "lamar" is not "lama" (🦙, Turkish), "messi" is not "mess".
                if (short && (token.startsWith(candidate) || !isPreferredToken(id))) continue
                val distance = editDistance.compute(token, candidate, maxEdits)
                if (distance <= maxEdits) add(id, if (distance == 1) 0.8 else 0.65)
            }
        }
        return candidates
    }

    /** First vocabulary position whose token is not less than `prefix` (UTF-16 order). */
    private fun lowerBound(prefix: String): Int {
        var low = 0
        var high = index.vocabulary.size
        while (low < high) {
            val middle = (low + high) ushr 1
            if (index.vocabulary[middle] < prefix) low = middle + 1 else high = middle
        }
        return low
    }

    private companion object {
        const val MAX_QUERY_TOKENS = 8
        const val MAX_PREFIX_EXPANSION = 400
        const val NON_EXACT_FACTOR = 0.9

        /** A multi-word query that equals a whole phrase ("ship it") beats one-word name hits ("ship"). */
        const val EXACT_PHRASE_BONUS = 1.1
        const val FOREIGN_LOCALE_FACTOR = 0.92
        const val EVIDENCE_BONUS = 0.02
        const val MAX_EVIDENCE_BONUS = 0.06

        /** How far below the match it must not pass a capped emoji scores. */
        const val CAP_MARGIN = 0.01

        /** Fields (in [Field] order) whose exact preferred-locale match outranks a foreign name or shortcode. */
        const val STRONG_FIELDS = 4

        /** Fields whose weight beats a preferred alias even after the foreign factor: name, shortcode. */
        const val DOMINANT_FIELDS = 2
        /** The most a function word ([FunctionWords]) weighs, so it never blocks a match. */
        const val FUNCTION_WORD_WEIGHT_CAP = 0.3

        /**
         * Quality factor of a prefix completion into a word that only other locales' packs have: en
         * "lamar" → id "lamaran" (💍) is a partial match, not the word the user is typing.
         */
        const val FOREIGN_PREFIX_QUALITY = 0.7

        /** Tokens up to this length (UTF-16 units) need stronger evidence for a typo match (PACK_FORMAT.md §4). */
        const val SHORT_TYPO_LENGTH = 5

        /** Longest piece (code points) tried when a run of an unspaced script is split. */
        const val MAX_PIECE_LENGTH = 16

        /**
         * Scripts written without spaces between words: Thai, Lao, Myanmar, Khmer, kana, Han (the
         * ranges of `UNSPACED_SCRIPT` in packages/core/src/engine.ts).
         */
        val UNSPACED_RANGES = intArrayOf(
            0x0E00, 0x0EFF, 0x1000, 0x109F, 0x1780, 0x17FF, 0x3040, 0x30FF,
            0x3400, 0x4DBF, 0x4E00, 0x9FFF, 0xF900, 0xFAFF, 0x20000, 0x3134F,
        )

        fun isUnspacedScript(token: String): Boolean {
            var i = 0
            while (i < token.length) {
                val codePoint = token.codePointAt(i)
                for (r in UNSPACED_RANGES.indices step 2) {
                    if (codePoint >= UNSPACED_RANGES[r] && codePoint <= UNSPACED_RANGES[r + 1]) return true
                }
                i += Character.charCount(codePoint)
            }
            return false
        }
    }
}
