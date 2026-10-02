package com.emojisense

/**
 * The immutable Tier 0 index (PACK_FORMAT.md §4 "Index"), built once from the loaded packs.
 *
 * Built exactly like `createEngine` in packages/core/src/engine.ts: the same phrase order, the
 * same vocabulary order (UTF-16 code units, as JavaScript sorts), the same postings and IDF.
 * Custom packs add their own rows; their phrases count for every locale (§8).
 */
internal class AliasIndex(packs: List<Pack>) {
    val primary: Pack
    val locales: List<String>

    /** Locale → bit mask of its packs (core and ext count as one locale). */
    val preferredMasks: Map<String, Int>

    /** Bit mask of the custom packs: their phrases are preferred for every locale. */
    val customMask: Int
    val entries: List<EmojiEntry>
    val indexById: Map<String, Int>

    val phraseText: Array<String>
    val phraseEmoji: IntArray
    val phraseField: ByteArray

    /** Bit i set = the phrase is in packs[i]. */
    val phraseLocaleMask: IntArray
    val phraseLength: IntArray

    /** Weight of the phrase's field in the pack that added it first. */
    val phraseFieldWeight: DoubleArray

    /** Sorted, so prefix search is a binary search. A token id is a position in it. */
    val vocabulary: Array<String>
    val tokenIds: Map<String, Int>

    /** Phrases of token `t`: `postings[postingStart[t] until postingStart[t + 1]]`. */
    val postingStart: IntArray
    val postings: IntArray
    val idf: DoubleArray
    val maxIdf: Double
    val tokenIdsByLength: Map<Int, IntArray>

    init {
        if (packs.isEmpty()) throw EmojisenseException.NoPacks()
        primary = packs.firstOrNull { !it.isCustom } ?: packs[0]
        locales = packs.filter { !it.isCustom }.map { it.locale }.distinct()
        val masks = LinkedHashMap<String, Int>()
        var custom = 0
        packs.forEachIndexed { packIndex, pack ->
            val bit = 1 shl packIndex
            if (pack.isCustom) custom = custom or bit else masks[pack.locale] = (masks[pack.locale] ?: 0) or bit
        }
        preferredMasks = masks
        customMask = custom

        // Entries: the primary pack's rows, then the rows of the custom packs.
        val sources = mutableListOf<Pair<Pack, PackRow>>()
        val byId = HashMap<String, Int>()
        for (pack in listOf(primary) + packs.filter { it !== primary && it.isCustom }) {
            for (row in pack.emoji) {
                if (byId.containsKey(row.hexcode)) continue
                byId[row.hexcode] = sources.size
                sources.add(pack to row)
            }
        }
        indexById = byId

        val labels = Array(sources.size) { LinkedHashMap<String, String>() }
        val phrases = PhraseCollector(sources.size)
        packs.forEachIndexed { packIndex, pack ->
            val fieldWeights = Field.entries.map { pack.weight(it) }
            val packBit = 1 shl packIndex
            for (row in pack.emoji) {
                val emojiIndex = byId[row.hexcode] ?: continue
                if (row.label.isNotEmpty()) labels[emojiIndex][pack.locale] = row.label
                for (field in Field.entries) {
                    val weight = fieldWeights[field.ordinal]
                    if (weight <= 0) continue
                    // The name field is the normalized label; the other fields are stored normalized.
                    val value = if (field == Field.NAME) {
                        if (row.label.isEmpty()) "" else Normalizer.normalize(row.label)
                    } else {
                        row.phrases(field)
                    }
                    if (value.isEmpty()) continue
                    for (phrase in value.split('|')) {
                        if (phrase.isNotEmpty()) phrases.add(phrase, emojiIndex, field, packBit, weight)
                    }
                }
            }
        }
        entries = sources.mapIndexed { index, (pack, row) -> entryOf(pack, row, labels[index]) }

        phraseText = phrases.text.toTypedArray()
        phraseEmoji = phrases.emoji.toIntArray()
        phraseField = ByteArray(phrases.field.size) { phrases.field[it].toByte() }
        phraseLocaleMask = phrases.localeMask.toIntArray()
        phraseFieldWeight = phrases.fieldWeight.toDoubleArray()

        // Sorted vocabulary; token ids become positions in it.
        val firstSeen = phrases.tokens
        val order = firstSeen.indices.sortedWith { a, b -> firstSeen[a].compareTo(firstSeen[b]) }
        vocabulary = Array(order.size) { firstSeen[order[it]] }
        val sortedId = IntArray(order.size)
        order.forEachIndexed { position, provisional -> sortedId[provisional] = position }
        tokenIds = HashMap<String, Int>(vocabulary.size * 2).also { map -> vocabulary.forEachIndexed { id, token -> map[token] = id } }

        val start = IntArray(vocabulary.size + 1)
        for (k in 0 until phrases.tokenCount) start[sortedId[phrases.phraseTokenIds[k]] + 1]++
        for (i in 1 until start.size) start[i] += start[i - 1]
        val fill = start.copyOf(vocabulary.size)
        val posted = IntArray(start[vocabulary.size])
        val lengths = IntArray(phraseText.size)
        var k = 0
        for (phrase in phraseText.indices) {
            val end = phrases.phraseTokenEnd[phrase]
            lengths[phrase] = end - k
            while (k < end) {
                val id = sortedId[phrases.phraseTokenIds[k]]
                posted[fill[id]++] = phrase
                k++
            }
        }
        postingStart = start
        postings = posted
        phraseLength = lengths

        // IDF over emoji (not phrases), so a token repeated across one emoji's aliases stays specific.
        val idfValues = DoubleArray(vocabulary.size)
        val lastSeen = IntArray(entries.size) { -1 }
        val idfByFrequency = HashMap<Int, Double>()
        var max = 0.0
        for (token in vocabulary.indices) {
            var frequency = 0
            for (posting in start[token] until start[token + 1]) {
                val emoji = phraseEmoji[posted[posting]]
                if (lastSeen[emoji] != token) {
                    lastSeen[emoji] = token
                    frequency++
                }
            }
            val value = idfByFrequency.getOrPut(frequency) { ReferenceMath.log(1 + entries.size.toDouble() / frequency) }
            idfValues[token] = value
            if (value > max) max = value
        }
        idf = idfValues
        maxIdf = max

        val byLength = LinkedHashMap<Int, MutableList<Int>>()
        vocabulary.forEachIndexed { id, token -> byLength.getOrPut(token.length) { mutableListOf() }.add(id) }
        tokenIdsByLength = byLength.mapValues { it.value.toIntArray() }
    }

    val phraseCount: Int get() = phraseText.size

    private fun entryOf(pack: Pack, row: PackRow, labels: Map<String, String>): EmojiEntry {
        val entry = EmojiEntry(
            emoji = row.emoji,
            id = row.hexcode,
            group = pack.groups.getOrNull(row.group) ?: "unknown",
            version = row.version,
            hasSkinTones = row.hasSkinTones,
            labels = labels,
        )
        if (!pack.isCustom) return entry
        return entry.copy(imageUrl = pack.images[row.hexcode]?.ifEmpty { null }, shortcode = shortcodeOf(row))
    }

    /** `:party_parrot:` → `party_parrot` (JavaScript `/^:(.+):$/`), else the label. */
    private fun shortcodeOf(row: PackRow): String {
        val emoji = row.emoji
        val inner = if (emoji.length >= 3 && emoji.startsWith(":") && emoji.endsWith(":")) emoji.substring(1, emoji.length - 1) else null
        return if (inner != null && inner.none { it == '\n' || it == '\r' || it == ' ' || it == ' ' }) inner else row.label
    }
}

/** Pass 1 of the index build: phrases deduplicated per emoji (the strongest field, the first pack wins). */
private class PhraseCollector(emojiCount: Int) {
    val text = ArrayList<String>()
    val emoji = ArrayList<Int>()
    val field = ArrayList<Int>()
    val localeMask = ArrayList<Int>()
    val fieldWeight = ArrayList<Double>()

    /** Tokens in first-seen order; a token's provisional id is its position. */
    val tokens = ArrayList<String>()

    /** Provisional token ids of phrase p: `phraseTokenIds[phraseTokenEnd[p - 1] until phraseTokenEnd[p]]`. */
    var phraseTokenIds = IntArray(1024)
        private set
    val phraseTokenEnd = ArrayList<Int>()
    var tokenCount = 0
        private set
    private val tokenIds = HashMap<String, Int>()
    private val seenByEmoji = arrayOfNulls<HashMap<String, Int>>(emojiCount)

    fun add(phrase: String, emojiIndex: Int, field: Field, packBit: Int, weight: Double) {
        val seen = seenByEmoji[emojiIndex] ?: HashMap<String, Int>().also { seenByEmoji[emojiIndex] = it }
        val existing = seen[phrase]
        if (existing != null) {
            localeMask[existing] = localeMask[existing] or packBit
            return
        }
        seen[phrase] = text.size
        text.add(phrase)
        emoji.add(emojiIndex)
        this.field.add(field.ordinal)
        localeMask.add(packBit)
        fieldWeight.add(weight)
        if (phrase.indexOf(' ') < 0) addToken(phrase) else Normalizer.tokenize(phrase).forEach(::addToken)
        phraseTokenEnd.add(tokenCount)
    }

    private fun addToken(token: String) {
        val id = tokenIds.getOrPut(token) {
            tokens.add(token)
            tokens.size - 1
        }
        if (tokenCount == phraseTokenIds.size) phraseTokenIds = phraseTokenIds.copyOf(tokenCount * 2)
        phraseTokenIds[tokenCount++] = id
    }
}
