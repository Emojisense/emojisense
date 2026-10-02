package com.emojisense

/** The parsed [UnicodeTables]: lookups for the normalizer, by code point. */
internal object UnicodeData {
    val emojiParts = RangeSet.parse(UnicodeTables.EMOJI_PARTS)
    val word = RangeSet.parse(UnicodeTables.WORD)
    val spacing = RangeSet.parse(UnicodeTables.SPACING)
    val cased = RangeSet.parse(UnicodeTables.CASED)
    val caseIgnorable = RangeSet.parse(UnicodeTables.CASE_IGNORABLE)
    val lowercase = CodePointMap.parse(UnicodeTables.LOWERCASE)
    val canonical = CodePointMap.parse(UnicodeTables.CANONICAL)
    val compatibility = CodePointMap.parse(UnicodeTables.COMPATIBILITY)
    private val classRanks = RankedRanges.parse(UnicodeTables.COMBINING_CLASS_RANK)
    private val compositions = Compositions.parse(UnicodeTables.COMPOSITIONS)

    /** 0 for starters; otherwise the order of the canonical combining class (1 = lowest). */
    fun combiningClassRank(codePoint: Int): Int = if (codePoint < FIRST_COMBINING_MARK) 0 else classRanks[codePoint]

    /** The primary composite of a pair, Hangul excepted, or -1. */
    fun composite(first: Int, second: Int): Int = compositions[first, second]

    /** No code point below U+0300 is a non-starter. */
    private const val FIRST_COMBINING_MARK = 0x300
}

private fun entries(chunks: Array<String>): Sequence<String> =
    chunks.asSequence().flatMap { it.splitToSequence(' ') }.filter { it.isNotEmpty() }

private fun hex(text: String): Int = text.toInt(16)

private fun codePointsOf(text: String): IntArray = text.split(',').map(::hex).toIntArray()

/** Sorted, disjoint, inclusive code point ranges. */
internal class RangeSet private constructor(private val starts: IntArray, private val ends: IntArray) {
    operator fun contains(codePoint: Int): Boolean {
        var low = 0
        var high = starts.size
        while (low < high) {
            val middle = (low + high) ushr 1
            if (ends[middle] < codePoint) low = middle + 1 else high = middle
        }
        return low < starts.size && starts[low] <= codePoint
    }

    companion object {
        fun parse(chunks: Array<String>): RangeSet {
            val ranges = entries(chunks).map { entry ->
                val dash = entry.indexOf('-')
                if (dash < 0) hex(entry).let { it to it } else hex(entry.substring(0, dash)) to hex(entry.substring(dash + 1))
            }.toList()
            return RangeSet(IntArray(ranges.size) { ranges[it].first }, IntArray(ranges.size) { ranges[it].second })
        }
    }
}

/** Code point → code point sequence, sorted by code point. */
internal class CodePointMap private constructor(
    private val keys: IntArray,
    private val offsets: IntArray,
    private val values: IntArray,
) {
    /** The position of `codePoint`'s mapping, or a negative number when it has none. */
    fun indexOf(codePoint: Int): Int = keys.binarySearch(codePoint)

    fun appendMapping(index: Int, out: CodePoints) {
        for (i in offsets[index] until offsets[index + 1]) out.add(values[i])
    }

    companion object {
        fun parse(chunks: Array<String>): CodePointMap {
            val parsed = entries(chunks).map { entry ->
                val colon = entry.indexOf(':')
                hex(entry.substring(0, colon)) to codePointsOf(entry.substring(colon + 1))
            }.toList()
            val offsets = IntArray(parsed.size + 1)
            parsed.forEachIndexed { i, (_, mapping) -> offsets[i + 1] = offsets[i] + mapping.size }
            val values = IntArray(offsets[parsed.size])
            parsed.forEachIndexed { i, (_, mapping) -> mapping.copyInto(values, offsets[i]) }
            return CodePointMap(IntArray(parsed.size) { parsed[it].first }, offsets, values)
        }
    }
}

/** Code point ranges with a small value each; 0 outside every range. */
private class RankedRanges(private val starts: IntArray, private val ends: IntArray, private val ranks: IntArray) {
    operator fun get(codePoint: Int): Int {
        var low = 0
        var high = starts.size
        while (low < high) {
            val middle = (low + high) ushr 1
            if (ends[middle] < codePoint) low = middle + 1 else high = middle
        }
        return if (low < starts.size && starts[low] <= codePoint) ranks[low] else 0
    }

    companion object {
        fun parse(chunks: Array<String>): RankedRanges {
            val parsed = entries(chunks).map { entry ->
                val (range, rank) = entry.split(':')
                val dash = range.indexOf('-')
                val start = hex(if (dash < 0) range else range.substring(0, dash))
                val end = if (dash < 0) start else hex(range.substring(dash + 1))
                Triple(start, end, hex(rank))
            }.toList()
            return RankedRanges(
                IntArray(parsed.size) { parsed[it].first },
                IntArray(parsed.size) { parsed[it].second },
                IntArray(parsed.size) { parsed[it].third },
            )
        }
    }
}

/** (first, second) → primary composite, as sorted 64-bit keys. */
private class Compositions(private val keys: LongArray, private val composites: IntArray) {
    operator fun get(first: Int, second: Int): Int {
        val index = keys.binarySearch(key(first, second))
        return if (index >= 0) composites[index] else -1
    }

    companion object {
        private fun key(first: Int, second: Int): Long = (first.toLong() shl 21) or second.toLong()

        fun parse(chunks: Array<String>): Compositions {
            val parsed = entries(chunks).map { entry ->
                val (pair, composite) = entry.split(':')
                val (first, second) = pair.split(',').map(::hex)
                key(first, second) to hex(composite)
            }.sortedBy { it.first }.toList()
            return Compositions(LongArray(parsed.size) { parsed[it].first }, IntArray(parsed.size) { parsed[it].second })
        }
    }
}

/** A growable list of code points. */
internal class CodePoints(capacity: Int = 16) {
    var array = IntArray(maxOf(capacity, 4))
        private set
    var size = 0
        private set

    operator fun get(index: Int): Int = array[index]

    operator fun set(index: Int, value: Int) {
        array[index] = value
    }

    fun add(codePoint: Int) {
        if (size == array.size) array = array.copyOf(size * 2)
        array[size++] = codePoint
    }

    fun last(): Int = array[size - 1]

    fun removeLast() {
        size--
    }

    override fun toString(): String {
        val builder = StringBuilder(size)
        for (i in 0 until size) builder.appendCodePoint(array[i])
        return builder.toString()
    }

    companion object {
        /** Code points of a string. A lone surrogate is one code point, as in JavaScript. */
        fun of(text: String): CodePoints {
            val points = CodePoints(text.length)
            var i = 0
            while (i < text.length) {
                val codePoint = text.codePointAt(i)
                points.add(codePoint)
                i += Character.charCount(codePoint)
            }
            return points
        }
    }
}
