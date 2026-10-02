package com.emojisense

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.security.MessageDigest

/**
 * The shared golden file of the SDK ports (sdks/swift/Tests/EmojisenseTests/Resources/golden.json),
 * written by sdks/swift/scripts/make-golden.ts from the TypeScript engine on Node 24.
 */
class Golden private constructor(root: JsonObject) {
    data class Ranked(val id: String, val score: Double) {
        override fun toString() = "$id $score"
    }

    data class SearchCase(
        val id: String,
        val q: String,
        val locale: String,
        val query: String,
        val confidence: Double,
        val coverage: Double,
        val top: List<Ranked>,
        val match: String?,
        val field: String?,
    )

    data class SearchConfig(val name: String, val packs: List<String>, val cases: List<SearchCase>)

    data class KeystrokeCase(val q: String, val locale: String, val top: List<Ranked>)

    /**
     * One input of `assessConfidence`, `semanticStrength` and `mergeConcept` (core/src/confidence.ts)
     * and the reference answers. [alias] / [semantic] null = not given. [strength] is unrounded,
     * null without a semantic list.
     */
    data class ConfidenceCase(
        val alias: AliasSearchOutput<AliasResult>?,
        val semantic: List<SearchResult>?,
        val concept: List<SearchResult>,
        val fused: List<SearchResult>,
        val limit: Int,
        val strength: Double?,
        val confidence: Double,
        val unsure: Boolean,
        val merged: List<String>,
    )

    val node: String = root.text("node")
    val unicode: String = root.text("unicode")
    val packVersion: String = root.text("packVersion")
    val packSha256: Map<String, String> = root.getValue("packSha256").jsonObject.mapValues { it.value.jsonPrimitive.content }
    val normalizationCases: List<Pair<String, String>> = pairs(root.getValue("normalization").jsonObject.getValue("cases").jsonArray)
    val sweepBlockSize: Int = root.getValue("normalization").jsonObject.getValue("sweep").jsonObject.getValue("blockSize").jsonPrimitive.int
    val sweepRanges: List<Pair<Int, Int>> = root.getValue("normalization").jsonObject.getValue("sweep").jsonObject
        .getValue("ranges").jsonArray.map { it.jsonArray[0].jsonPrimitive.int to it.jsonArray[1].jsonPrimitive.int }
    val sweepHashes: List<String> = root.getValue("normalization").jsonObject.getValue("sweep").jsonObject
        .getValue("hashes").jsonArray.map { it.jsonPrimitive.content }
    val embeddingTextCases: List<Pair<String, String>> = pairs(root.getValue("embeddingText").jsonObject.getValue("cases").jsonArray)
    val search: List<SearchConfig> = root.getValue("search").jsonArray.map { config ->
        val value = config.jsonObject
        SearchConfig(
            name = value.text("name"),
            packs = value.getValue("packs").jsonArray.map { it.jsonPrimitive.content },
            cases = value.getValue("cases").jsonArray.map { element ->
                val case = element.jsonObject
                SearchCase(
                    id = case.text("id"),
                    q = case.text("q"),
                    locale = case.text("locale"),
                    query = case.text("query"),
                    confidence = case.getValue("confidence").jsonPrimitive.double,
                    coverage = case.getValue("coverage").jsonPrimitive.double,
                    top = ranked(case.getValue("top").jsonArray),
                    match = (case["match"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
                    field = (case["field"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
                )
            },
        )
    }
    val keystrokePacks: List<String> = root.getValue("keystrokes").jsonObject.getValue("packs").jsonArray.map { it.jsonPrimitive.content }
    val keystrokes: List<KeystrokeCase> = keystrokeCases(root.getValue("keystrokes").jsonObject)

    /** Sentences of the other pack locales, typed keystroke by keystroke: (packs, cases) per locale. */
    val sentenceKeystrokes: List<Pair<List<String>, List<KeystrokeCase>>> =
        root.getValue("sentenceKeystrokes").jsonArray.map { element ->
            val value = element.jsonObject
            value.getValue("packs").jsonArray.map { it.jsonPrimitive.content } to keystrokeCases(value)
        }

    /** Names, titles and brands per locale, and the guard queries with every locale, typed keystroke by keystroke. */
    val entityKeystrokes: List<Pair<List<String>, List<KeystrokeCase>>> =
        root.getValue("entityKeystrokes").jsonArray.map { element ->
            val value = element.jsonObject
            value.getValue("packs").jsonArray.map { it.jsonPrimitive.content } to keystrokeCases(value)
        }

    /** The unsure verdict and the concept merge on generated inputs. */
    val confidence: List<ConfidenceCase> = root.getValue("confidence").jsonArray.map { element ->
        val case = element.jsonObject
        ConfidenceCase(
            alias = (case["alias"] as? JsonObject)?.let(::aliasOutput),
            semantic = (case["semantic"] as? JsonArray)?.let(::sourced),
            concept = case.getValue("concept").jsonArray.map {
                EmojiResult(it.jsonArray[0].jsonPrimitive.content, it.jsonArray[0].jsonPrimitive.content, it.jsonArray[1].jsonPrimitive.double, ResultSource.CONCEPT)
            },
            fused = sourced(case.getValue("fused").jsonArray),
            limit = case.getValue("limit").jsonPrimitive.int,
            strength = case["strength"]?.jsonPrimitive?.doubleOrNull,
            confidence = case.getValue("confidence").jsonPrimitive.double,
            unsure = case.getValue("unsure").jsonPrimitive.boolean,
            merged = case.getValue("merged").jsonArray.map { it.jsonPrimitive.content },
        )
    }

    /** The reference function-word lists per locale (PACK_FORMAT.md §4). */
    val functionWords: Map<String, List<String>> = root.getValue("functionWords").jsonObject.mapValues { (_, words) ->
        words.jsonArray.map { it.jsonPrimitive.content }
    }

    /** `fuse` on recorded lists, with (reranked) and without (reciprocal) the reranker (PACK_FORMAT.md §10). */
    data class FusionCase(
        val q: String,
        val aliasQuery: String,
        val aliasConfidence: Double,
        val alias: List<Ranked>,
        /** (emoji, id, score) */
        val semantic: List<Triple<String, String, Double>>,
        val popularity: Map<String, Double>,
        val reranked: List<String>,
        val reciprocal: List<String>,
    )

    val fusion: List<FusionCase> = root.getValue("fusion").jsonArray.map { element ->
        val case = element.jsonObject
        val alias = case.getValue("alias").jsonObject
        FusionCase(
            q = case.text("q"),
            aliasQuery = alias.text("query"),
            aliasConfidence = alias.getValue("confidence").jsonPrimitive.double,
            alias = ranked(alias.getValue("results").jsonArray),
            semantic = case.getValue("semantic").jsonArray.map {
                val row = it.jsonArray
                Triple(row[0].jsonPrimitive.content, row[1].jsonPrimitive.content, row[2].jsonPrimitive.double)
            },
            popularity = case.getValue("popularity").jsonObject.mapValues { it.value.jsonPrimitive.double },
            reranked = case.getValue("reranked").jsonArray.map { it.jsonPrimitive.content },
            reciprocal = case.getValue("reciprocal").jsonArray.map { it.jsonPrimitive.content },
        )
    }

    companion object {
        /** The repository root, passed by Gradle (build.gradle.kts), else found from the working directory. */
        val repositoryRoot: File by lazy {
            System.getProperty("emojisense.repositoryRoot")?.let(::File)
                ?: generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "pnpm-workspace.yaml").exists() }
        }

        val file: File by lazy {
            System.getenv("EMOJISENSE_GOLDEN")?.takeIf { it.isNotEmpty() }?.let(::File)
                ?: File(repositoryRoot, "sdks/swift/Tests/EmojisenseTests/Resources/golden.json")
        }

        val instance: Golden by lazy { Golden(Json.parseToJsonElement(file.readText()).jsonObject) }

        private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content

        private fun pairs(array: JsonArray) = array.map { it.jsonArray[0].jsonPrimitive.content to it.jsonArray[1].jsonPrimitive.content }

        private fun ranked(array: JsonArray) = array.map { Ranked(it.jsonArray[0].jsonPrimitive.content, it.jsonArray[1].jsonPrimitive.double) }

        /** `[[id, score, source]]` → results whose emoji is the id. */
        private fun sourced(array: JsonArray): List<SearchResult> = array.map {
            val item = it.jsonArray
            val id = item[0].jsonPrimitive.content
            EmojiResult(id, id, item[1].jsonPrimitive.double, ResultSource.fromKey(item[2].jsonPrimitive.content)!!)
        }

        /** The alias output of a confidence case, with results shaped as make-golden.ts builds them. */
        private fun aliasOutput(alias: JsonObject): AliasSearchOutput<AliasResult> {
            val tokens = alias.getValue("tokens").jsonArray.map { it.jsonPrimitive.content }
            val results = ranked(alias.getValue("results").jsonArray).map { (id, score) ->
                AliasResult(emoji = id, id = id, score = score, source = ResultSource.ALIAS, label = id, match = "a", field = Field.ALIAS)
            }
            return AliasSearchOutput(
                query = tokens.joinToString(" "),
                tokens = tokens,
                results = results,
                confidence = alias.getValue("confidence").jsonPrimitive.double,
                coverage = alias.getValue("coverage").jsonPrimitive.double,
            )
        }

        private fun keystrokeCases(keystrokes: JsonObject) = keystrokes.getValue("cases").jsonArray.map { element ->
            val case = element.jsonObject
            KeystrokeCase(case.text("q"), case.text("locale"), ranked(case.getValue("top").jsonArray))
        }
    }
}

/** The packs of the golden pack version, read from the monorepo build output and checked by sha256. */
class GoldenPacks private constructor(private val byFile: Map<String, Pack>) {
    fun engine(files: List<String>): AliasEngine = AliasEngine(files.map { byFile.getValue(it) })

    sealed class Problem(message: String) : Exception(message) {
        class NotBuilt(directory: File) :
            Problem("no packs in ${directory.path}. Run `pnpm data:build` at the repository root, or set EMOJISENSE_PACK_DIR.")

        class Stale(file: String) : Problem(
            "$file is not the pack golden.json was made from. Rebuild the packs (`pnpm data:build`) or, if the data or " +
                "packages/core changed on purpose, regenerate golden.json (`pnpm exec tsx sdks/swift/scripts/make-golden.ts`).",
        )
    }

    companion object {
        /** `EMOJISENSE_PACK_DIR`, else `packages/data/dist/packs/<version>` of this repository. */
        fun directory(packVersion: String): File =
            System.getenv("EMOJISENSE_PACK_DIR")?.takeIf { it.isNotEmpty() }?.let(::File)
                ?: File(Golden.repositoryRoot, "packages/data/dist/packs/$packVersion")

        val instance: Result<GoldenPacks> by lazy {
            runCatching {
                val golden = Golden.instance
                val directory = directory(golden.packVersion)
                GoldenPacks(
                    golden.packSha256.mapValues { (file, expected) ->
                        val path = File(directory, file)
                        if (!path.exists()) throw Problem.NotBuilt(directory)
                        val bytes = path.readBytes()
                        val actual = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
                        if (actual != expected) throw Problem.Stale(file)
                        Pack.fromJson(bytes)
                    },
                )
            }
        }
    }
}
