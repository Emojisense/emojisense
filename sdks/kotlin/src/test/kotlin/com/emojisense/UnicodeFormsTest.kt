package com.emojisense

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * NFC, NFD, NFKC, NFKD and lowercase of random sequences (marks in every order, Hangul jamo,
 * compatibility characters, final sigma contexts), compared with Node 24
 * (src/test/resources/normalization-forms.json, written by scripts/make-unicode-tables.ts).
 */
class UnicodeFormsTest {
    private val cases = run {
        val text = checkNotNull(javaClass.getResource("/normalization-forms.json")).readText()
        Json.parseToJsonElement(text).jsonObject.getValue("cases").jsonArray.map { case ->
            case.jsonArray.map { it.jsonPrimitive.content }
        }
    }

    private fun decode(hex: String, input: String): String =
        if (hex == "=") input else hex.split(' ').joinToString("") { String(Character.toChars(it.toInt(16))) }

    private fun encode(text: String): String = CodePoints.of(text).let { points ->
        (0 until points.size).joinToString(" ") { points[it].toString(16).uppercase() }
    }

    @Test
    fun `every operation matches Node on the fixture`() {
        val operations = listOf<Pair<String, (CodePoints) -> CodePoints>>(
            "NFC" to UnicodeForms::nfc,
            "NFD" to UnicodeForms::nfd,
            "NFKC" to UnicodeForms::nfkc,
            "NFKD" to UnicodeForms::nfkd,
            "lowercase" to UnicodeForms::lowercase,
        )
        val differences = mutableListOf<String>()
        for (case in cases) {
            val input = decode(case[0], "")
            operations.forEachIndexed { i, (name, operation) ->
                val expected = decode(case[i + 1], input)
                val actual = operation(CodePoints.of(input)).toString()
                if (actual != expected) differences.add("$name(${case[0]}): kotlin ${encode(actual)}, node ${encode(expected)}")
            }
        }
        println("conformance: normalization forms and lowercase (fixture): ${cases.size * operations.size - differences.size}/${cases.size * operations.size}")
        assertEquals(emptyList(), differences)
    }

    @Test
    fun `composes and decomposes Hangul by arithmetic`() {
        assertEquals("한", UnicodeForms.nfd(CodePoints.of("한")).toString())
        assertEquals("한", UnicodeForms.nfc(CodePoints.of("한")).toString())
        assertEquals("하", UnicodeForms.nfc(CodePoints.of("하")).toString())
    }

    @Test
    fun `reorders marks by combining class and composes across a lower class`() {
        // U+0323 (class 220) before U+0307 (class 230): ṩ, whatever order they were typed in.
        assertEquals("ṩ", UnicodeForms.nfc(CodePoints.of("ṩ")).toString())
        assertEquals("ṩ", UnicodeForms.nfd(CodePoints.of("ṩ")).toString())
    }
}
