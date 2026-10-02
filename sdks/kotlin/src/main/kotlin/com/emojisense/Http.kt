package com.emojisense

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI

/** An HTTP answer: the status and the raw body. */
public class HttpResponse(public val status: Int, public val body: ByteArray) {
    public val isSuccess: Boolean get() = status in 200..299
}

/**
 * The one network operation the SDK needs: a GET. Inject your own to use OkHttp or Ktor, to add
 * headers or logging, or to stub the network in tests. Throw for network failures.
 */
public fun interface HttpTransport {
    public suspend fun get(url: String): HttpResponse
}

/**
 * [HttpTransport] on `java.net.HttpURLConnection`, available on every JVM and on Android. Runs on
 * [Dispatchers.IO], so it is safe to call from the main thread.
 */
public class UrlConnectionTransport @JvmOverloads constructor(
    private val connectTimeoutMillis: Int = 10_000,
    private val readTimeoutMillis: Int = 10_000,
    /** Extra request headers, e.g. a `User-Agent`. */
    private val headers: Map<String, String> = emptyMap(),
) : HttpTransport {
    override suspend fun get(url: String): HttpResponse = withContext(Dispatchers.IO) {
        val connection = URI.create(url).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = connectTimeoutMillis
            connection.readTimeout = readTimeoutMillis
            connection.setRequestProperty("Accept", "application/json")
            headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            val status = connection.responseCode
            val stream: InputStream? = if (status in 200..299) connection.inputStream else connection.errorStream
            HttpResponse(status, stream?.use { it.readBytes() } ?: ByteArray(0))
        } finally {
            connection.disconnect()
        }
    }
}
