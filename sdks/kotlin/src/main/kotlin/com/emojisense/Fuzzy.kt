package com.emojisense

/**
 * Typo tolerance for the alias engine (PACK_FORMAT.md §4). Tokens are compared in UTF-16 code
 * units, as in `packages/core/src/fuzzy.ts`, so lengths and edits count the same everywhere.
 */
public object Fuzzy {
    /** Edits tolerated for a token of this UTF-16 length: none below 4, 1 up to 7, then 2. */
    @JvmStatic
    public fun maxEdits(length: Int): Int = when {
        length < 4 -> 0
        length < 8 -> 1
        else -> 2
    }

    /**
     * Optimal-string-alignment distance (Levenshtein + adjacent transposition), bounded: returns
     * `max + 1` as soon as a row shows that the distance must exceed `max`.
     */
    @JvmStatic
    public fun boundedEditDistance(a: String, b: String, max: Int): Int = EditDistance().compute(a, b, max)

    /**
     * Cheap gate before the edit distance: people rarely mistype the first letter, so the tokens
     * must agree on it, or on a swap of the first two letters.
     */
    internal fun isPlausibleTypo(typed: String, candidate: String): Boolean {
        if (typed.isEmpty() || candidate.isEmpty()) return false
        if (typed[0] == candidate[0]) return true
        return typed.length > 1 && candidate.length > 1 && typed[0] == candidate[1] && candidate[0] == typed[1]
    }

    /**
     * "upp" → "up": the token without the repetition of its final unit, or null when it does not
     * end in a repeated unit (JavaScript `token.replace(/(.)\1+$/, "$1")`).
     */
    internal fun squeezeRepeatedEnding(token: String): String? {
        if (token.isEmpty()) return null
        val last = token[token.length - 1]
        if (last == '\n' || last == '\r' || last == ' ' || last == ' ') return null
        var runStart = token.length - 1
        while (runStart > 0 && token[runStart - 1] == last) runStart--
        return if (runStart < token.length - 1) token.substring(0, runStart + 1) else null
    }
}

/** Row buffers for the bounded edit distance, reused across calls of one search. */
internal class EditDistance {
    private var beforePrevious = IntArray(32)
    private var previous = IntArray(32)
    private var current = IntArray(32)

    fun compute(a: String, b: String, max: Int): Int {
        if (Math.abs(a.length - b.length) > max) return max + 1
        if (a == b) return 0

        val width = b.length + 1
        if (previous.size < width) {
            beforePrevious = IntArray(width * 2)
            previous = IntArray(width * 2)
            current = IntArray(width * 2)
        }
        for (column in 0 until width) previous[column] = column

        for (row in 1..a.length) {
            current[0] = row
            var rowMinimum = row
            for (column in 1 until width) {
                val cost = if (a[row - 1] == b[column - 1]) 0 else 1
                var value = minOf(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost)
                if (row > 1 && column > 1 && a[row - 1] == b[column - 2] && a[row - 2] == b[column - 1]) {
                    value = minOf(value, beforePrevious[column - 2] + 1)
                }
                current[column] = value
                if (value < rowMinimum) rowMinimum = value
            }
            if (rowMinimum > max) return max + 1
            val recycled = beforePrevious
            beforePrevious = previous
            previous = current
            current = recycled
        }
        return previous[b.length]
    }
}
