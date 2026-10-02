package com.emojisense

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FuzzyTest {
    @Test
    fun `bounded edit distance`() {
        val cases = listOf(
            listOf("pizza", "pizza", 2, 0),
            listOf("pizaa", "pizza", 2, 1),
            listOf("rockt", "rocket", 2, 1),
            listOf("hallowelen", "halloween", 2, 1),
            listOf("teh", "the", 1, 1),
            listOf("dinosuar", "dinosaur", 2, 1),
            listOf("cat", "dog", 1, 2),
            listOf("a", "abcdef", 2, 3),
        )
        for ((a, b, max, expected) in cases) {
            assertEquals(expected, Fuzzy.boundedEditDistance(a as String, b as String, max as Int), "$a ↔ $b")
        }
    }

    @Test
    fun `allows edits only for longer tokens`() {
        assertEquals(0, Fuzzy.maxEdits(3))
        assertEquals(1, Fuzzy.maxEdits(5))
        assertEquals(2, Fuzzy.maxEdits(10))
    }

    @Test
    fun `squeezes a repeated final letter`() {
        assertEquals("up", Fuzzy.squeezeRepeatedEnding("upp"))
        assertEquals("a", Fuzzy.squeezeRepeatedEnding("aaa"))
        assertNull(Fuzzy.squeezeRepeatedEnding("happy"))
    }

    @Test
    fun `gates typos on the first letters`() {
        assertTrue(Fuzzy.isPlausibleTypo("rockt", "rocket"))
        assertTrue(Fuzzy.isPlausibleTypo("teh", "eth"))
        assertFalse(Fuzzy.isPlausibleTypo("pizza", "lizza"))
    }
}

class ReferenceMathTest {
    /** Bit patterns of `Math.log(1 + 1914 / df)` printed by Node 24 on arm64 (the Swift SDK's test values). */
    @Test
    fun `log matches V8 bit for bit`() {
        val expected = listOf(
            1 + 1914.0 / 85 to 0x4009_4312_ff47_b24aL,
            1 + 1914.0 / 92 to 0x4008_a828_f7f8_9000L,
            1 + 1914.0 / 443 to 0x3ffa_bec5_9109_2dcaL,
            1 + 1914.0 / 1088 to 0x3ff0_3d2f_3161_9c5cL,
            1 + 1913.0 / 418 to 0x3ffb_7f44_857c_fe00L,
        )
        for ((input, bits) in expected) assertEquals(bits, ReferenceMath.log(input).toRawBits(), "log($input)")
        assertEquals(0.0, ReferenceMath.log(1.0))
        assertEquals(Double.NEGATIVE_INFINITY, ReferenceMath.log(0.0))
        assertTrue(ReferenceMath.log(-1.0).isNaN())
    }

    @Test
    fun `the exact fallback rounds like Math fma`() {
        val random = Random(7)
        repeat(20_000) {
            val a = random.nextDouble(-4.0, 4.0)
            val b = random.nextDouble(-4.0, 4.0) * Math.pow(2.0, random.nextInt(-40, 40).toDouble())
            val c = random.nextDouble(-4.0, 4.0) * Math.pow(2.0, random.nextInt(-40, 40).toDouble())
            assertEquals(Math.fma(a, b, c).toRawBits(), ReferenceMath.exactFma(a, b, c).toRawBits(), "fma($a, $b, $c)")
        }
    }
}
