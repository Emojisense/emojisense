package com.emojisense

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

/** The JSON settings of every Emojisense file and API answer: unknown keys are newer fields. */
internal val EmojisenseJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

internal fun parseJsonObject(text: String, what: String): JsonObject {
    val element = try {
        EmojisenseJson.parseToJsonElement(text)
    } catch (error: SerializationException) {
        throw EmojisenseException.InvalidData("$what is not valid JSON", error)
    }
    return element as? JsonObject ?: throw EmojisenseException.InvalidData("$what is not a JSON object")
}

/** Checks `format` and `formatVersion` before anything else is read. */
internal fun JsonObject.requireFormat(format: String, version: Int) {
    val found = (this["format"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    if (found != format) throw EmojisenseException.InvalidFormat(format, found)
    val foundVersion = (this["formatVersion"] as? JsonPrimitive)?.intOrNull
    if (foundVersion != version) throw EmojisenseException.UnsupportedFormatVersion(format, foundVersion)
}

internal fun JsonElement?.stringOrNull(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

internal fun JsonObject.string(key: String): String =
    this[key].stringOrNull() ?: throw EmojisenseException.InvalidData("\"$key\" must be a string")

internal fun JsonObject.optionalString(key: String): String? = this[key].stringOrNull()

internal fun JsonObject.int(key: String): Int =
    (this[key] as? JsonPrimitive)?.intOrNull ?: throw EmojisenseException.InvalidData("\"$key\" must be an integer")

internal fun JsonObject.optionalDouble(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

internal fun JsonObject.optionalBoolean(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

internal fun JsonObject.array(key: String): JsonArray =
    this[key] as? JsonArray ?: throw EmojisenseException.InvalidData("\"$key\" must be an array")

internal fun JsonObject.optionalArray(key: String): JsonArray? = this[key]?.takeIf { it !is JsonNull } as? JsonArray

internal fun JsonObject.optionalObject(key: String): JsonObject? = this[key] as? JsonObject

internal fun JsonArray.strings(what: String): List<String> =
    map { it.stringOrNull() ?: throw EmojisenseException.InvalidData("$what must hold strings") }
