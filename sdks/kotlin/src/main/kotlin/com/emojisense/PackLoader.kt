package com.emojisense

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonObject
import java.security.MessageDigest

/** `manifest.json` of a pack version (PACK_FORMAT.md §1). */
public data class Manifest(
    val packVersion: String,
    val emojiVersion: String,
    val emojiCount: Int,
    val files: Map<String, File>,
) {
    public data class File(
        /** Lowercase hex SHA-256 of the raw file bytes. */
        val sha256: String,
        val bytes: Long,
        val gzipBytes: Long,
        val locale: String? = null,
        val model: String? = null,
        val dims: Int? = null,
        /** The exact string to embed for a query; `{q}` stands for the query's embedding text. */
        val queryTemplate: String? = null,
    )

    public companion object {
        public const val FORMAT: String = "emojisense-manifest"

        @JvmStatic
        public fun fromJson(json: String): Manifest {
            val root = parseJsonObject(json, "manifest")
            root.requireFormat(FORMAT, 1)
            val files = root.optionalObject("files") ?: throw EmojisenseException.InvalidData("manifest has no files")
            return Manifest(
                packVersion = root.string("packVersion"),
                emojiVersion = root.optionalString("emojiVersion") ?: "",
                emojiCount = root.int("emojiCount"),
                files = files.mapNotNull { (name, value) ->
                    val file = value as? JsonObject ?: return@mapNotNull null
                    name to File(
                        sha256 = file.string("sha256"),
                        bytes = file.optionalDouble("bytes")?.toLong() ?: 0,
                        gzipBytes = file.optionalDouble("gzipBytes")?.toLong() ?: 0,
                        locale = file.optionalString("locale"),
                        model = file.optionalString("model"),
                        dims = file.optionalDouble("dims")?.toInt(),
                        queryTemplate = file.optionalString("queryTemplate"),
                    )
                }.toMap(),
            )
        }
    }
}

/**
 * Downloads the packs of one pack version, e.g. `https://api.emojisense.com/v1/pack/0.1.0`. Files
 * are immutable, so the HTTP cache (or your own disk cache) does the rest.
 */
public class PackLoader @JvmOverloads constructor(
    public val baseUrl: String,
    private val transport: HttpTransport = UrlConnectionTransport(),
) {
    public suspend fun loadManifest(): Manifest = Manifest.fromJson(download(MANIFEST).decodeToString())

    /**
     * Loads one part of the given locales, English first (it carries the shortcodes), in parallel.
     * With a [manifest], each file must match its `sha256`.
     */
    @JvmOverloads
    public suspend fun loadPacks(
        locales: List<String> = listOf("en"),
        part: PackPart = PackPart.CORE,
        manifest: Manifest? = null,
    ): List<Pack> = coroutineScope {
        val ordered = listOf("en") + locales.filter { it != "en" }
        ordered.map { locale ->
            async {
                val file = fileName(locale, part)
                val bytes = download(file)
                manifest?.files?.get(file)?.sha256?.let { verify(bytes, it, file) }
                Pack.fromJson(bytes)
            }
        }.awaitAll()
    }

    private suspend fun download(file: String): ByteArray {
        val url = "${UrlEncoding.trimTrailingSlashes(baseUrl)}/$file"
        val response = transport.get(url)
        if (!response.isSuccess) throw EmojisenseException.HttpStatus(response.status, url)
        return response.body
    }

    public companion object {
        private const val MANIFEST = "manifest.json"

        @JvmStatic
        public fun fileName(locale: String, part: PackPart): String =
            if (part == PackPart.EXT) "pack.$locale.ext.json" else "pack.$locale.json"

        /**
         * Fetches the app's custom emoji as a pack (`GET /v1/custom-pack`). Pass it to [AliasEngine]
         * after the locale packs, so custom emoji are searched on the device too.
         *
         * @param tenant the app owner's id for one of their customers: adds that tenant's emoji.
         */
        @JvmStatic
        @JvmOverloads
        public suspend fun loadCustomPack(
            endpoint: String,
            key: String,
            tenant: String? = null,
            transport: HttpTransport = UrlConnectionTransport(),
        ): Pack {
            val parameters = listOf("key" to key) + listOfNotNull(tenant?.takeIf { it.isNotEmpty() }?.let { "tenant" to it })
            val url = "${UrlEncoding.trimTrailingSlashes(endpoint)}/v1/custom-pack?${UrlEncoding.formEncoded(parameters)}"
            val response = transport.get(url)
            if (!response.isSuccess) throw EmojisenseException.HttpStatus(response.status, url)
            val pack = Pack.fromJson(response.body)
            if (!pack.isCustom) throw EmojisenseException.InvalidData("not a custom emoji pack")
            return pack
        }

        internal fun verify(bytes: ByteArray, sha256: String, file: String) {
            val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            if (digest != sha256.lowercase()) throw EmojisenseException.ChecksumMismatch(file)
        }
    }
}
