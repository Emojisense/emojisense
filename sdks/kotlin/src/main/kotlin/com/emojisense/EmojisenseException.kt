package com.emojisense

/** Every error the SDK throws. Network failures of the transport itself pass through unchanged. */
public sealed class EmojisenseException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** The data is not an Emojisense file of the expected kind (`format` differs). */
    public class InvalidFormat(public val expected: String, public val found: String?) :
        EmojisenseException("emojisense: expected a $expected file, found format ${found?.let { "\"$it\"" } ?: "none"}")

    /** The file uses a `formatVersion` this SDK does not support. */
    public class UnsupportedFormatVersion(public val format: String, public val version: Int?) :
        EmojisenseException("emojisense: $format format v$version is not supported (expected v1)")

    /** The file has the right format but a field is missing or has the wrong type. */
    public class InvalidData(message: String, cause: Throwable? = null) : EmojisenseException("emojisense: $message", cause)

    /** An engine needs at least one pack. */
    public class NoPacks : EmojisenseException("emojisense: an engine needs at least one pack")

    /** The server answered with a status outside 200–299. */
    public class HttpStatus(public val status: Int, public val url: String) :
        EmojisenseException("emojisense: request to $url failed with HTTP $status")

    /** A downloaded file does not match the `sha256` in the manifest. */
    public class ChecksumMismatch(public val file: String) :
        EmojisenseException("emojisense: $file does not match the sha256 in the manifest")

    /** A culture locale that is not a plain locale tag (it would change the URL path). */
    public class InvalidLocale(public val locale: String) : EmojisenseException("emojisense: \"$locale\" is not a locale tag")
}
