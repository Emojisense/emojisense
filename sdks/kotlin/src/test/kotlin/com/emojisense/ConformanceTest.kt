package com.emojisense

import org.junit.jupiter.api.Assumptions.assumeTrue
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Compares the Kotlin port with the TypeScript reference engine (the shared golden.json).
 *
 * Run `pnpm data:build` at the repository root first: the packs are read from
 * `packages/data/dist/packs/<version>` (or `EMOJISENSE_PACK_DIR`), not copied into the SDK.
 * Without them the search tests are skipped; with other packs they fail.
 */
class ConformanceTest {
    private val golden = Golden.instance

    private fun packs(): GoldenPacks {
        val packs = GoldenPacks.instance
        val problem = packs.exceptionOrNull()
        assumeTrue(problem !is GoldenPacks.Problem.NotBuilt, problem?.message)
        return packs.getOrThrow()
    }

    @Test
    fun `the tables have the Unicode version of the reference`() {
        assertEquals(golden.unicode, UnicodeTables.UNICODE_VERSION)
    }

    @Test
    fun `normalization matches the reference cases`() {
        val differences = golden.normalizationCases.mapNotNull { (input, expected) ->
            val actual = Normalizer.normalize(input)
            if (actual == expected) null else "  ${debug(input)}: kotlin ${debug(actual)}, ts ${debug(expected)}"
        }
        report("normalization cases", golden.normalizationCases.size, differences)
        assertEquals(emptyList(), differences)
    }

    @Test
    fun `embedding text matches the reference cases`() {
        val differences = golden.embeddingTextCases.mapNotNull { (input, expected) ->
            val actual = Normalizer.embeddingText(input)
            if (actual == expected) null else "  ${debug(input)}: kotlin ${debug(actual)}, ts ${debug(expected)}"
        }
        report("embedding text cases", golden.embeddingTextCases.size, differences)
        assertEquals(emptyList(), differences)
    }

    /** Normalizes every code point of planes 0–3 and 14 on its own; one hash per block of 1,024. */
    @Test
    fun `normalization matches the reference on every code point`() {
        val expected = golden.sweepHashes.iterator()
        val differentBlocks = mutableListOf<String>()
        var blocks = 0
        for ((start, end) in golden.sweepRanges) {
            for (blockStart in start..end step golden.sweepBlockSize) {
                blocks++
                var hash = FNV_OFFSET
                for (codePoint in blockStart until blockStart + golden.sweepBlockSize) {
                    if (codePoint in 0xD800..0xDFFF) continue
                    for (unit in Normalizer.normalize(String(Character.toChars(codePoint)))) hash = fnv1a(hash, unit.code)
                    hash = fnv1a(hash, 0xFFFF)
                }
                if ("%08x".format(hash) != expected.next()) {
                    differentBlocks.add("  U+%04X–U+%04X".format(blockStart, blockStart + golden.sweepBlockSize - 1))
                }
            }
        }
        report("normalization sweep (Unicode ${golden.unicode} reference), blocks", blocks, differentBlocks)
        assertEquals(emptyList(), differentBlocks)
    }

    @Test
    fun `search matches the reference`() {
        val packs = packs()
        for (config in golden.search) {
            val engine = packs.engine(config.packs)
            val topFive = mutableListOf<String>()
            val details = mutableListOf<String>()
            for (case in config.cases) {
                val output = engine.canonicalSearch(case.q, AliasSearchOptions(limit = 10, locale = case.locale))
                val actual = output.results.map { Golden.Ranked(it.id, it.score) }
                if (actual.take(5).map { it.id } != case.top.take(5).map { it.id }) {
                    topFive.add("  ${case.id} ${debug(case.q)}:\n    kotlin ${actual.take(5)}\n    ts     ${case.top.take(5)}")
                }
                val best = output.results.firstOrNull()
                if (output.query != case.query || actual != case.top || output.confidence != case.confidence ||
                    best?.match != case.match || best?.field?.key != case.field
                ) {
                    details.add(
                        "  ${case.id} ${debug(case.q)}: kotlin ${debug(output.query)} $actual ${best?.match}/${best?.field?.key}, " +
                            "ts ${debug(case.query)} ${case.top} ${case.match}/${case.field}",
                    )
                }
            }
            report("[${config.name}] identical top-5 ids", config.cases.size, topFive)
            report("[${config.name}] identical query, top-10 ids + scores, confidence, match", config.cases.size, details)
            assertEquals(emptyList(), topFive, "[${config.name}] top 5")
            assertEquals(emptyList(), details, "[${config.name}] details")
        }
    }

    /** Every prefix of a sample of queries and sentences, as typed: exercises prefix completion. */
    @Test
    fun `keystrokes match the reference`() {
        val packs = packs()
        for ((files, cases) in listOf(golden.keystrokePacks to golden.keystrokes) + golden.sentenceKeystrokes) {
            val engine = packs.engine(files)
            val differences = cases.mapNotNull { case ->
                val actual = engine.canonicalSearch(case.q, AliasSearchOptions(limit = 5, locale = case.locale))
                    .results.map { Golden.Ranked(it.id, it.score) }
                if (actual == case.top) null else "  ${debug(case.q)}:\n    kotlin $actual\n    ts     ${case.top}"
            }
            report("[keystrokes ${files.joinToString(" ")}] identical top-5 ids + scores", cases.size, differences)
            assertEquals(emptyList(), differences)
        }
    }

    /** The Kotlin copy (FunctionWords.kt, generated) holds exactly the reference lists. */
    @Test
    fun `function words match the reference`() {
        val locales = (golden.functionWords.keys + FunctionWords.lists.keys).sorted()
        val differences = locales.filter { FunctionWords.lists[it] != golden.functionWords[it] }
            .map { "  $it: regenerate with sdks/swift/scripts/make-function-words.ts" }
        report("function-word lists", golden.functionWords.size, differences)
        assertEquals(emptyList(), differences)
    }

    private fun fnv1a(hash: Int, unit: Int): Int = (hash xor unit) * FNV_PRIME

    private fun debug(text: String): String = buildString {
        append('"')
        for (char in text) {
            if (char.code in 0x20..0x7E) append(char) else append("\\u%04X".format(char.code))
        }
        append('"')
    }

    private fun report(title: String, total: Int, differences: List<String>) {
        val agreed = total - differences.size
        val share = if (total == 0) 100.0 else agreed * 100.0 / total
        println("conformance: $title: $agreed/$total (${"%.1f".format(share)}%)")
        differences.forEach(::println)
    }

    private companion object {
        const val FNV_OFFSET = 0x811c9dc5.toInt()
        const val FNV_PRIME = 0x01000193
    }
}
