package com.emojisense

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Ports packages/core/test/normalize.test.ts and the Swift NormalizerTests. */
class NormalizerTest {
    @Test
    fun `matches the reference examples`() {
        val cases = listOf(
            "  Thumbs   UP " to "thumbs up",
            "doğum günü" to "dogum gunu",
            "İYİ Kİ DOĞDUN" to "iyi ki dogdun",
            "IŞIK" to "isik",
            "Pokémon" to "pokemon",
            "i'm exhausted" to "im exhausted",
            "ship-it!!!" to "ship it",
            ":rocket:" to "rocket",
            "+1" to "+1",
            "c++ rocks" to "c rocks",
            "🚀 launch 👍🏽" to "launch",
            "👩‍🚀" to "",
            "ｆｕｌｌｗｉｄｔｈ" to "fullwidth",
            "¡Feliz cumpleaños!" to "feliz cumpleanos",
            "Joyeux Noël" to "joyeux noel",
            "Straße" to "strasse",
            "Ёлка" to "елка",
            "Chúc mừng sinh nhật" to "chuc mung sinh nhat",
            "Đà Lạt" to "da lat",
            "مَرْحَبًا" to "مرحبا",
            "नमस्ते" to "नमस्ते",
            "শুভ জন্মদিন" to "শুভ জন্মদিন",
            "がんばって" to "がんばって",
            "축하해요" to "축하해요",
            "生日快乐" to "生日快乐",
            "สุขสันต์วันเกิด" to "สุขสันต์วันเกิด",
        )
        for ((input, expected) in cases) assertEquals(expected, Normalizer.normalize(input), "normalize($input)")
    }

    @Test
    fun `keeps marks that are part of the spelling`() {
        // NFC recomposes kana and Hangul after the optional accents are gone.
        assertEquals("ガンバレ", Normalizer.normalize("ｶﾞﾝﾊﾞﾚ"))
        assertEquals("한", Normalizer.normalize("한"))
        assertEquals("lodz oresund", Normalizer.normalize("Łódź Øresund"))
    }

    @Test
    fun `applies final sigma like JavaScript`() {
        assertEquals("οδος σας", Normalizer.normalize("ΟΔΟΣ ΣΑΣ"))
        assertEquals("σ", Normalizer.normalize("Σ"))
    }

    @Test
    fun `keeps plus only before an ASCII digit`() {
        assertEquals("+1 a b +1 1+1 ٣", Normalizer.normalize("+1 a+b ++1 1+1 +٣"))
    }

    @Test
    fun `caps the length in UTF-16 units`() {
        assertTrue(Normalizer.normalize("a ".repeat(100)).length <= Normalizer.MAX_QUERY_LENGTH)
        assertEquals(64, Normalizer.normalize("x".repeat(62) + "𝔞𝔟").length)
        // JavaScript cuts a surrogate pair at the cap and keeps the high half; so does this port.
        assertEquals("x".repeat(63) + "\uD840", Normalizer.normalize("x".repeat(63) + "\uD840\uDC00"))
    }

    @Test
    fun `is idempotent`() {
        for (input in listOf("Doğum Günü!", "i'm so tired", "T-Rex", "ΟΔΟΣ", "안녕하세요")) {
            val once = Normalizer.normalize(input)
            assertEquals(once, Normalizer.normalize(once))
        }
    }

    @Test
    fun `tokenizes on single spaces`() {
        assertEquals(emptyList(), Normalizer.tokenize(""))
        assertEquals(listOf("ship", "it"), Normalizer.tokenize("ship it"))
    }

    @Test
    fun `keeps accents punctuation and emoji in the embedding text`() {
        assertEquals("doğum günü!!", Normalizer.embeddingText("  Doğum GÜNÜ!! "))
        assertEquals("🚀 launch 👍🏽", Normalizer.embeddingText("🚀\tLaunch　 👍🏽"))
        // Never half a surrogate pair at the cap.
        assertEquals("x".repeat(63), Normalizer.embeddingText("x".repeat(63) + "\uD840\uDC00"))
    }

    @Test
    fun `recognizes emoji parts`() {
        assertTrue(Normalizer.isEmojiPart("🚀".codePointAt(0)))
        assertTrue(Normalizer.isEmojiPart(0x1F3FD))
        assertTrue(Normalizer.isEmojiPart(0x1F1F9))
        assertTrue(Normalizer.isEmojiPart(0xE0067))
        assertFalse(Normalizer.isEmojiPart('#'.code))
        assertFalse(Normalizer.isEmojiPart('a'.code))
    }
}
