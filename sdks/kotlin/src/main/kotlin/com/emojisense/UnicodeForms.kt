package com.emojisense

/**
 * Unicode normalization forms (UAX #15) and the default lowercase mapping, from the tables of the
 * reference runtime ([UnicodeTables]), so every JVM and Android release gives the same result.
 */
internal object UnicodeForms {
    fun nfd(input: CodePoints): CodePoints = if (isAscii(input)) input else decompose(input, compatibility = false)

    fun nfkd(input: CodePoints): CodePoints = if (isAscii(input)) input else decompose(input, compatibility = true)

    fun nfc(input: CodePoints): CodePoints = if (isAscii(input)) input else compose(decompose(input, compatibility = false))

    fun nfkc(input: CodePoints): CodePoints = if (isAscii(input)) input else compose(decompose(input, compatibility = true))

    /**
     * JavaScript `toLowerCase()`: the full default lowercase mapping, plus Final_Sigma as ICU
     * evaluates it (preceded by a cased letter and not followed by one; case-ignorable code points
     * are skipped, even cased ones).
     */
    fun lowercase(input: CodePoints): CodePoints {
        val out = CodePoints(input.size)
        for (i in 0 until input.size) {
            val codePoint = input[i]
            when {
                codePoint < 0x80 -> out.add(if (codePoint in 'A'.code..'Z'.code) codePoint + 32 else codePoint)
                codePoint == CAPITAL_SIGMA && isFinalSigma(input, i) -> out.add(SMALL_FINAL_SIGMA)
                else -> {
                    val index = UnicodeData.lowercase.indexOf(codePoint)
                    if (index >= 0) UnicodeData.lowercase.appendMapping(index, out) else out.add(codePoint)
                }
            }
        }
        return out
    }

    private fun isAscii(input: CodePoints): Boolean {
        for (i in 0 until input.size) if (input[i] >= 0x80) return false
        return true
    }

    /** Full decomposition of every code point, then the canonical ordering of the marks. */
    private fun decompose(input: CodePoints, compatibility: Boolean): CodePoints {
        val out = CodePoints(input.size + 8)
        for (i in 0 until input.size) {
            val codePoint = input[i]
            if (Hangul.isSyllable(codePoint)) {
                Hangul.decompose(codePoint, out)
                continue
            }
            val compatibilityIndex = if (compatibility) UnicodeData.compatibility.indexOf(codePoint) else -1
            if (compatibilityIndex >= 0) {
                UnicodeData.compatibility.appendMapping(compatibilityIndex, out)
                continue
            }
            val canonicalIndex = UnicodeData.canonical.indexOf(codePoint)
            if (canonicalIndex >= 0) UnicodeData.canonical.appendMapping(canonicalIndex, out) else out.add(codePoint)
        }
        reorder(out)
        return out
    }

    /** Stable sort of each run of non-starters by combining class. */
    private fun reorder(points: CodePoints) {
        for (i in 1 until points.size) {
            val codePoint = points[i]
            val rank = UnicodeData.combiningClassRank(codePoint)
            if (rank == 0) continue
            var j = i
            while (j > 0 && UnicodeData.combiningClassRank(points[j - 1]) > rank) {
                points[j] = points[j - 1]
                j--
            }
            points[j] = codePoint
        }
    }

    /** Canonical composition (UAX #15 D117) of a decomposed, canonically ordered sequence. */
    private fun compose(input: CodePoints): CodePoints {
        val out = CodePoints(input.size)
        var starter = -1
        // Rank of the last code point kept after the starter; -1 = none since the starter.
        var lastRank = -1
        for (i in 0 until input.size) {
            val codePoint = input[i]
            val rank = UnicodeData.combiningClassRank(codePoint)
            if (starter >= 0 && (lastRank == -1 || lastRank < rank)) {
                val composite = composePair(out[starter], codePoint)
                if (composite >= 0) {
                    out[starter] = composite
                    continue
                }
            }
            if (rank == 0) {
                starter = out.size
                lastRank = -1
            } else {
                lastRank = rank
            }
            out.add(codePoint)
        }
        return out
    }

    private fun composePair(first: Int, second: Int): Int =
        Hangul.compose(first, second).takeIf { it >= 0 } ?: UnicodeData.composite(first, second)

    private fun isFinalSigma(points: CodePoints, index: Int): Boolean =
        hasCasedNeighbor(points, index, step = -1) && !hasCasedNeighbor(points, index, step = 1)

    private fun hasCasedNeighbor(points: CodePoints, index: Int, step: Int): Boolean {
        var position = index + step
        while (position >= 0 && position < points.size) {
            val codePoint = points[position]
            if (codePoint !in UnicodeData.caseIgnorable) return codePoint in UnicodeData.cased
            position += step
        }
        return false
    }

    private const val CAPITAL_SIGMA = 0x03A3
    private const val SMALL_FINAL_SIGMA = 0x03C2
}

/** Hangul syllables decompose and compose by arithmetic (Unicode §3.12). */
private object Hangul {
    private const val S_BASE = 0xAC00
    private const val L_BASE = 0x1100
    private const val V_BASE = 0x1161
    private const val T_BASE = 0x11A7
    private const val L_COUNT = 19
    private const val V_COUNT = 21
    private const val T_COUNT = 28
    private const val N_COUNT = V_COUNT * T_COUNT
    private const val S_COUNT = L_COUNT * N_COUNT

    fun isSyllable(codePoint: Int): Boolean = codePoint >= S_BASE && codePoint < S_BASE + S_COUNT

    fun decompose(syllable: Int, out: CodePoints) {
        val index = syllable - S_BASE
        out.add(L_BASE + index / N_COUNT)
        out.add(V_BASE + (index % N_COUNT) / T_COUNT)
        if (index % T_COUNT != 0) out.add(T_BASE + index % T_COUNT)
    }

    /** The syllable of `<L, V>` or `<LV, T>`, or -1. */
    fun compose(first: Int, second: Int): Int {
        if (first >= L_BASE && first < L_BASE + L_COUNT && second >= V_BASE && second < V_BASE + V_COUNT) {
            return S_BASE + ((first - L_BASE) * V_COUNT + (second - V_BASE)) * T_COUNT
        }
        if (isSyllable(first) && (first - S_BASE) % T_COUNT == 0 && second > T_BASE && second < T_BASE + T_COUNT) {
            return first + (second - T_BASE)
        }
        return -1
    }
}
