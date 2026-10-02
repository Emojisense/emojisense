import Foundation
import XCTest

@testable import Emojisense

/// Compares the Swift port with the TypeScript reference engine (golden.json).
///
/// Run `pnpm data:build` at the repository root first: the packs are read from
/// `packages/data/dist/packs/<version>` (or `EMOJISENSE_PACK_DIR`), not copied into the SDK.
final class ConformanceTests: XCTestCase {
  /// Share of queries whose top 5 ids must equal the reference.
  private static let requiredTopFiveAgreement = 0.98
  private static let golden = Result { try Golden.load() }
  private static let packs = Result { try GoldenPacks.load(for: golden.get()) }

  private func loadPacks() throws -> GoldenPacks {
    do {
      return try Self.packs.get()
    } catch let error as GoldenError {
      if case .packsNotBuilt = error { throw XCTSkip(error.description) }
      throw error
    }
  }

  // MARK: Normalization

  func testNormalizationMatchesTheReferenceCases() throws {
    let cases = try Self.golden.get().normalization.cases
    var differences: [String] = []
    for pair in cases {
      let (input, expected) = (pair[0], pair[1])
      let actual = Normalizer.normalize(input)
      if actual != expected {
        differences.append("  \(debug(input)): swift \(debug(actual)), ts \(debug(expected))")
      }
    }
    report(
      "normalization cases", agreed: cases.count - differences.count, of: cases.count, differences)
    XCTAssertEqual(differences, [])
  }

  func testEmbeddingTextMatchesTheReferenceCases() throws {
    let cases = try Self.golden.get().embeddingText.cases
    var differences: [String] = []
    for pair in cases {
      let (input, expected) = (pair[0], pair[1])
      let actual = Normalizer.embeddingText(input)
      if actual != expected {
        differences.append("  \(debug(input)): swift \(debug(actual)), ts \(debug(expected))")
      }
    }
    report(
      "embedding text cases", agreed: cases.count - differences.count, of: cases.count, differences)
    XCTAssertEqual(differences, [])
  }

  /// Normalizes every code point of planes 0–3 and 14 on its own and compares a hash per block
  /// of 1,024 code points with the reference.
  func testNormalizationMatchesTheReferenceOnEveryCodePoint() throws {
    let golden = try Self.golden.get()
    let sweep = golden.normalization.sweep
    var expected = sweep.hashes.makeIterator()
    var differentBlocks: [String] = []
    var blockCount = 0
    for range in sweep.ranges {
      for blockStart in stride(from: range[0], through: range[1], by: sweep.blockSize) {
        blockCount += 1
        var hash: UInt32 = 0x811c_9dc5
        for value in blockStart..<(blockStart + sweep.blockSize) {
          guard let scalar = Unicode.Scalar(UInt32(value)) else { continue }
          for unit in Normalizer.normalize(String(Character(scalar))).utf16 {
            hash = fnv1a(hash, unit)
          }
          hash = fnv1a(hash, 0xFFFF)
        }
        if String(format: "%08x", hash) != expected.next() {
          differentBlocks.append(
            String(format: "  U+%04X–U+%04X", blockStart, blockStart + sweep.blockSize - 1))
        }
      }
    }
    report(
      "normalization sweep (Unicode \(golden.unicode) reference), blocks",
      agreed: blockCount - differentBlocks.count,
      of: blockCount, differentBlocks)
    XCTAssertEqual(differentBlocks, [])
  }

  // MARK: Search

  func testSearchMatchesTheReference() throws {
    let golden = try Self.golden.get()
    let packs = try loadPacks()
    for config in golden.search {
      let engine = try packs.engine(files: config.packs)
      var topFiveDifferences: [String] = []
      var detailDifferences: [String] = []
      var coverageDifferences: [String] = []
      for testCase in config.cases {
        let options = AliasSearchOptions(limit: 10, locale: testCase.locale)
        let output = engine.search(testCase.q, options: options)
        let actual = output.results.map(Golden.Ranked.init)
        if actual.prefix(5).map(\.id) != testCase.top.prefix(5).map(\.id) {
          topFiveDifferences.append(
            "  \(testCase.id) \(debug(testCase.q)):\n"
              + "    swift \(actual.prefix(5))\n    ts    \(testCase.top.prefix(5))")
        }
        let best = output.results.first
        if output.query != testCase.query || actual != testCase.top
          || output.confidence != testCase.confidence || best?.match != testCase.match
          || best?.field.rawValue != testCase.field
        {
          detailDifferences.append(
            "  \(testCase.id) \(debug(testCase.q)): swift \(debug(output.query)) \(actual) "
              + "\(best?.match ?? "-")/\(best?.field.rawValue ?? "-"), ts \(debug(testCase.query)) "
              + "\(testCase.top) \(testCase.match ?? "-")/\(testCase.field ?? "-")")
        }
        if output.coverage != testCase.coverage {
          coverageDifferences.append(
            "  \(testCase.id) \(debug(testCase.q)): swift \(output.coverage), "
              + "ts \(testCase.coverage)")
        }
      }
      let count = config.cases.count
      report(
        "[\(config.name)] identical top-5 ids", agreed: count - topFiveDifferences.count, of: count,
        topFiveDifferences)
      report(
        "[\(config.name)] identical query, top-10 ids + scores, confidence, match",
        agreed: count - detailDifferences.count, of: count, detailDifferences)
      report(
        "[\(config.name)] identical coverage", agreed: count - coverageDifferences.count, of: count,
        coverageDifferences)
      XCTAssertGreaterThanOrEqual(
        Double(count - topFiveDifferences.count) / Double(count), Self.requiredTopFiveAgreement,
        "[\(config.name)] top-5 agreement with the TypeScript engine")
      // Coverage decides the unsure verdict at a threshold: it must be the reference value.
      XCTAssertEqual(coverageDifferences, [], "[\(config.name)] coverage")
    }
  }

  /// Every prefix of a sample of queries, as typed: exercises prefix completion.
  func testKeystrokesMatchTheReference() throws {
    let golden = try Self.golden.get()
    let packs = try loadPacks()
    let groups =
      [("keystrokes", golden.keystrokes)]
      + golden.sentenceKeystrokes.map { ("sentence keystrokes", $0) }
      + golden.entityKeystrokes.map { ("entity keystrokes", $0) }
    for (kind, keystrokes) in groups {
      let engine = try packs.engine(files: keystrokes.packs)
      var differences: [String] = []
      for testCase in keystrokes.cases {
        let options = AliasSearchOptions(limit: 5, locale: testCase.locale)
        let actual = engine.search(testCase.q, options: options).results.map(Golden.Ranked.init)
        if actual != testCase.top {
          differences.append(
            "  \(debug(testCase.q)):\n    swift \(actual)\n    ts    \(testCase.top)")
        }
      }
      let count = keystrokes.cases.count
      report(
        "[\(kind) \(locales(keystrokes.packs))] identical top-5 ids + scores",
        agreed: count - differences.count, of: count, differences)
      XCTAssertGreaterThanOrEqual(
        Double(count - differences.count) / Double(count), Self.requiredTopFiveAgreement)
    }
  }

  // MARK: Fusion

  /// `Fusion.fuse` on the reference's alias and semantic lists, with and without the reranker.
  func testFusionMatchesTheReference() throws {
    let cases = try Self.golden.get().fusion
    var differences: [String] = []
    for testCase in cases {
      let alias = AliasSearchOutput(
        query: testCase.alias.query, tokens: [],
        results: testCase.alias.results.map {
          AliasResult(emoji: $0.id, id: $0.id, score: $0.score, label: "", match: "", field: .alias)
        },
        confidence: testCase.alias.confidence)
      let semantic = testCase.semantic.map {
        SearchResult(emoji: $0.emoji, id: $0.id, score: $0.score, source: .semantic)
      }
      let popularity = testCase.popularity
      for (rerank, expected) in [(true, testCase.reranked), (false, testCase.reciprocal)] {
        let ranking = Fusion.Ranking(popularity: { popularity[$0] ?? 0 }, rerank: rerank)
        let actual = Fusion.fuse(alias: alias, semantic: semantic, limit: 10, ranking: ranking)
          .map(\.id)
        if actual != expected {
          differences.append(
            "  \(debug(testCase.q)) rerank \(rerank):\n    swift \(actual)\n    ts    \(expected)")
        }
      }
    }
    let count = cases.count * 2
    report("fusion, identical top-10 ids", agreed: count - differences.count, of: count, differences)
    XCTAssertEqual(differences, [])
  }

  // MARK: Confidence

  /// The unsure verdict and the concept merge (core/src/confidence.ts) on generated inputs.
  func testConfidenceMatchesTheReference() throws {
    let cases = try Self.golden.get().confidence
    var differences: [String] = []
    var largestStrengthDifference = 0.0
    for (number, testCase) in cases.enumerated() {
      let alias = testCase.alias?.output
      let semantic = testCase.semantic?.map(\.result)
      let verdict = Confidence.assess(alias: alias, semantic: semantic)
      // Strength is checked only for a case with a semantic list.
      let strength = semantic.map { Confidence.semanticStrength($0) }
      let concept = testCase.concept.map {
        SearchResult(emoji: $0.id, id: $0.id, score: $0.score, source: .concept)
      }
      let merged = Confidence.mergeConcept(
        testCase.fused.map(\.result), concept: concept, alias: alias, limit: testCase.limit
      ).map(\.id)
      var sameStrength = true
      if let strength {
        let difference = testCase.strength.map { abs(strength - $0) } ?? .infinity
        largestStrengthDifference = max(largestStrengthDifference, difference)
        sameStrength = difference <= 1e-12
      }
      if !sameStrength || verdict.confidence != testCase.confidence
        || verdict.unsure != testCase.unsure || merged != testCase.merged
      {
        let swiftStrength = strength.map { "\($0)" } ?? "-"
        let referenceStrength = testCase.strength.map { "\($0)" } ?? "-"
        differences.append(
          "  case \(number): swift \(swiftStrength) \(verdict) \(merged), ts \(referenceStrength) "
            + "\(testCase.confidence) \(testCase.unsure) \(testCase.merged)")
      }
    }
    let withSemantic = cases.filter { $0.semantic != nil }.count
    report(
      "confidence cases: confidence, unsure, concept merge, strength (\(withSemantic) lists, "
        + "largest difference \(largestStrengthDifference))",
      agreed: cases.count - differences.count, of: cases.count, differences)
    XCTAssertEqual(differences, [])
  }

  // MARK: Function words

  /// The Swift copy (FunctionWords.swift, generated) holds exactly the reference lists.
  func testFunctionWordsMatchTheReference() throws {
    let expected = try Self.golden.get().functionWords
    var differences: [String] = []
    for locale in Set(expected.keys).union(FunctionWords.lists.keys).sorted() {
      if FunctionWords.lists[locale] != expected[locale] {
        differences.append("  \(locale): regenerate with sdks/swift/scripts/make-function-words.ts")
      }
    }
    report(
      "function-word lists", agreed: expected.count - differences.count, of: expected.count,
      differences)
    XCTAssertEqual(differences, [])
  }

  // MARK: Helpers

  private func fnv1a(_ hash: UInt32, _ unit: UInt16) -> UInt32 {
    (hash ^ UInt32(unit)) &* 0x0100_0193
  }

  /// "en tr" for the pack files of en and tr; "all 22 packs" for every locale.
  private func locales(_ files: [String]) -> String {
    if files.count > 4 { return "all \(files.count) packs" }
    var locales: [String] = []
    for file in files {
      let locale = String(file.split(separator: ".")[1])
      if !locales.contains(locale) { locales.append(locale) }
    }
    return locales.joined(separator: " ")
  }

  private func debug(_ text: String) -> String {
    text.debugDescription
  }

  private func report(_ title: String, agreed: Int, of total: Int, _ differences: [String]) {
    let share = total == 0 ? 100 : Double(agreed) * 100 / Double(total)
    print(String(format: "conformance: %@: %d/%d (%.1f%%)", title, agreed, total, share))
    for line in differences { print(line) }
  }
}
