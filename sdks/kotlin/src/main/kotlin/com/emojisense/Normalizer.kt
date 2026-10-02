package com.emojisense

/**
 * The one text normalization of Emojisense (PACK_FORMAT.md §3), for queries and labels.
 *
 * Every step mirrors `packages/core/src/normalize.ts`, including what the spec leaves to
 * JavaScript: lowercasing applies Final_Sigma, lengths count UTF-16 units, and the Unicode data is
 * the reference runtime's ([UnicodeTables], Unicode 16.0), not the JVM's or Android's.
 */
public object Normalizer {
    public const val MAX_QUERY_LENGTH: Int = 64

    /**
     * NFKC → drop emoji → lowercase → NFD → drop optional accents → fold ı/đ/ł/ø/ß → NFC → drop
     * apostrophes → punctuation to spaces → collapse whitespace → cap at [maxLength] UTF-16 units.
     */
    @JvmStatic
    @JvmOverloads
    public fun normalize(input: String, maxLength: Int = MAX_QUERY_LENGTH): String {
        val compatible = UnicodeForms.nfkc(CodePoints.of(input))
        val lowercased = UnicodeForms.lowercase(replaceEmojiParts(compatible))
        val folded = UnicodeForms.nfc(foldAccents(UnicodeForms.nfd(lowercased)))
        val text = collapseSpaces(separateLonePluses(separateWords(folded)))
        return if (text.length <= maxLength) text else text.substring(0, maxOf(0, maxLength)).trimEnd(' ')
    }

    /**
     * The text the semantic tier embeds, like `embeddingText` in packages/core: NFKC, lowercase,
     * NFKC, every run of spacing characters (`\p{Cc}`, `\p{Z}`, U+FEFF) to one space, trimmed, at
     * most [maxLength] UTF-16 units, never half a surrogate pair. Accents, punctuation and emoji
     * stay, because the embedding model reads them. [SemanticClient] sends it as `q`.
     */
    @JvmStatic
    @JvmOverloads
    public fun embeddingText(input: String, maxLength: Int = MAX_QUERY_LENGTH): String {
        val folded = UnicodeForms.nfkc(UnicodeForms.lowercase(UnicodeForms.nfkc(CodePoints.of(input))))
        val spaced = CodePoints(folded.size)
        for (i in 0 until folded.size) {
            val codePoint = folded[i]
            if (codePoint !in UnicodeData.spacing) spaced.add(codePoint)
            else if (spaced.size == 0 || spaced.last() != SPACE) spaced.add(SPACE)
        }
        val text = spaced.toString().trim(' ')
        if (text.length <= maxLength) return text
        if (maxLength <= 0) return ""
        val end = if (Character.isHighSurrogate(text[maxLength - 1])) maxLength - 1 else maxLength
        return text.substring(0, end).trimEnd(' ')
    }

    /** Splits a normalized string into tokens (JavaScript `split(" ")`). */
    @JvmStatic
    public fun tokenize(normalized: String): List<String> =
        if (normalized.isEmpty()) emptyList() else normalized.split(' ')

    // Steps 2–3: emoji parts become a space; the invisible emoji glue disappears.
    private fun replaceEmojiParts(input: CodePoints): CodePoints {
        val out = CodePoints(input.size)
        for (i in 0 until input.size) {
            val codePoint = input[i]
            if (codePoint in UnicodeData.emojiParts) out.add(SPACE) else if (!isEmojiGlue(codePoint)) out.add(codePoint)
        }
        return out
    }

    // Steps 5–6, after NFD: drop the optional accents and fold the letters people type without
    // their stroke. Marks that are part of the spelling (Devanagari, Bengali, Thai, kana) stay.
    private fun foldAccents(input: CodePoints): CodePoints {
        val out = CodePoints(input.size)
        for (i in 0 until input.size) {
            val codePoint = input[i]
            when {
                isOptionalMark(codePoint) -> Unit
                codePoint == 0x0131 -> out.add('i'.code)
                codePoint == 0x0111 -> out.add('d'.code)
                codePoint == 0x0142 -> out.add('l'.code)
                codePoint == 0x00F8 -> out.add('o'.code)
                codePoint == 0x00DF -> {
                    out.add('s'.code)
                    out.add('s'.code)
                }
                else -> out.add(codePoint)
            }
        }
        return out
    }

    // Steps 8–9, after NFC: drop apostrophes, and turn every run of code points that are not a
    // letter, a mark, a number or `+` into one space.
    private fun separateWords(input: CodePoints): CodePoints {
        val out = CodePoints(input.size)
        var inSeparatorRun = false
        for (i in 0 until input.size) {
            val codePoint = input[i]
            if (isApostrophe(codePoint)) continue
            if (codePoint == PLUS || codePoint in UnicodeData.word) {
                out.add(codePoint)
                inSeparatorRun = false
            } else if (!inSeparatorRun) {
                out.add(SPACE)
                inSeparatorRun = true
            }
        }
        return out
    }

    // Step 10: a `+` that is not followed by an ASCII digit becomes a space ("+1" stays, "c++" not).
    private fun separateLonePluses(points: CodePoints): CodePoints {
        for (i in 0 until points.size) {
            if (points[i] != PLUS) continue
            val next = if (i + 1 < points.size) points[i + 1] else -1
            if (next !in '0'.code..'9'.code) points[i] = SPACE
        }
        return points
    }

    // Step 11: collapse runs of spaces and trim.
    private fun collapseSpaces(points: CodePoints): String {
        val builder = StringBuilder(points.size)
        for (i in 0 until points.size) {
            val codePoint = points[i]
            if (codePoint == SPACE && (builder.isEmpty() || builder[builder.length - 1] == ' ')) continue
            builder.appendCodePoint(codePoint)
        }
        if (builder.isNotEmpty() && builder[builder.length - 1] == ' ') builder.setLength(builder.length - 1)
        return builder.toString()
    }

    /** Extended_Pictographic, Emoji_Modifier, Regional_Indicator or a tag (U+E0020–E007F). */
    internal fun isEmojiPart(codePoint: Int): Boolean = codePoint in UnicodeData.emojiParts

    private fun isEmojiGlue(codePoint: Int): Boolean =
        codePoint == 0x200D || codePoint == 0xFE0E || codePoint == 0xFE0F || codePoint == 0x20E3

    /**
     * Accents people skip when typing: Latin, Greek and Cyrillic diacritics, Arabic harakat and
     * tatweel, Hebrew points. The ranges are literal, as in the spec.
     */
    private fun isOptionalMark(codePoint: Int): Boolean =
        codePoint in 0x0300..0x036F || codePoint in 0x064B..0x065F || codePoint == 0x0670 ||
            codePoint == 0x0640 || codePoint in 0x0591..0x05C7

    private fun isApostrophe(codePoint: Int): Boolean =
        codePoint == 0x27 || codePoint == 0x2019 || codePoint == 0x60 || codePoint == 0xB4

    private const val SPACE = 0x20
    private const val PLUS = 0x2B
}

/** JavaScript `/\s$/`: does the text end with ECMAScript WhiteSpace or a LineTerminator? */
internal fun endsWithJavaScriptWhitespace(text: String): Boolean =
    text.isNotEmpty() && isJavaScriptWhitespace(text[text.length - 1])

private fun isJavaScriptWhitespace(unit: Char): Boolean = when (unit.code) {
    0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF -> true
    in 0x2000..0x200A -> true
    else -> false
}

/** JavaScript `Math.round` for scores: halves round up. */
internal fun roundScore(value: Double): Double = Math.round(value * 1000).toDouble() / 1000
