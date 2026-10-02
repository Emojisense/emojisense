package com.emojisense

/**
 * Percent-encoding with the exact rules of the JavaScript APIs the TypeScript SDK uses, so both
 * SDKs send the same URLs (and hit the same CDN cache entries).
 */
internal object UrlEncoding {
    /**
     * `URLSearchParams` serialization (application/x-www-form-urlencoded): space → `+`, so a
     * literal `+` (as in "+1") is sent as `%2B`.
     */
    fun formEncoded(pairs: List<Pair<String, String>>): String =
        pairs.joinToString("&") { (name, value) -> "${encode(name, FORM_SAFE, spaceAsPlus = true)}=${encode(value, FORM_SAFE, spaceAsPlus = true)}" }

    /** `encodeURIComponent`. */
    fun uriComponent(value: String): String = encode(value, URI_COMPONENT_SAFE, spaceAsPlus = false)

    /** The base URL without trailing slashes (JavaScript `replace(/\/+$/, "")`). */
    fun trimTrailingSlashes(url: String): String = url.trimEnd('/')

    private const val FORM_SAFE = "*-._"
    private const val URI_COMPONENT_SAFE = "-_.!~*'()"
    private const val HEX = "0123456789ABCDEF"

    private fun encode(value: String, safe: String, spaceAsPlus: Boolean): String {
        val builder = StringBuilder(value.length)
        // A lone surrogate becomes U+FFFD, as in a USVString.
        for (byte in toWellFormed(value).encodeToByteArray()) {
            val unit = byte.toInt() and 0xFF
            val char = unit.toChar()
            when {
                unit < 0x80 && (char.isAsciiLetterOrDigit() || char in safe) -> builder.append(char)
                unit == 0x20 && spaceAsPlus -> builder.append('+')
                else -> builder.append('%').append(HEX[unit shr 4]).append(HEX[unit and 0xF])
            }
        }
        return builder.toString()
    }

    private fun Char.isAsciiLetterOrDigit(): Boolean = this in 'a'..'z' || this in 'A'..'Z' || this in '0'..'9'

    private fun toWellFormed(value: String): String {
        val builder = StringBuilder(value.length)
        var i = 0
        while (i < value.length) {
            val unit = value[i]
            when {
                Character.isHighSurrogate(unit) && i + 1 < value.length && Character.isLowSurrogate(value[i + 1]) -> {
                    builder.append(unit).append(value[i + 1])
                    i++
                }
                Character.isSurrogate(unit) -> builder.append('�')
                else -> builder.append(unit)
            }
            i++
        }
        return builder.toString()
    }
}
