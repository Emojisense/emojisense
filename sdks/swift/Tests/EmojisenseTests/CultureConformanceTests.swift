import Foundation
import XCTest

@testable import Emojisense

/// Resources/culture-golden.json, written by sdks/swift/scripts/make-golden.ts: one English
/// culture file and what the reference culture layer adds to searches and messages for fixed
/// regions and days.
struct CultureGolden: Decodable, Sendable {
  struct Ranked: Decodable, Equatable, Sendable, CustomStringConvertible {
    let id: String
    let source: String
    let cultureId: String?
    let score: Double

    init(_ result: AliasResult) {
      id = result.id
      source = result.source.rawValue
      cultureId = result.cultureId
      score = result.score
    }

    /// Stored as `[id, source, cultureId or null, score]`.
    init(from decoder: any Decoder) throws {
      var container = try decoder.unkeyedContainer()
      id = try container.decode(String.self)
      source = try container.decode(String.self)
      cultureId = try container.decodeNil() ? nil : container.decode(String.self)
      score = try container.decode(Double.self)
    }

    var description: String { "\(id) \(source) \(cultureId ?? "-") \(score)" }
  }

  struct Case: Decodable, Sendable {
    let q: String
    /// "" = no region.
    let region: String
    let day: String
    /// Matched as a message (reaction suggestions): `applyCulture(text: true)`.
    let text: Bool
    let results: [Ranked]
  }

  let packVersion: String
  let packs: [String]
  let culture: Culture
  let cases: [Case]

  static func load() throws -> CultureGolden {
    guard let url = Bundle.module.url(forResource: "culture-golden", withExtension: "json") else {
      throw GoldenError.missingResource
    }
    return try JSONDecoder().decode(CultureGolden.self, from: Data(contentsOf: url))
  }
}

/// Compares the Swift culture layer with the TypeScript reference (culture-golden.json).
final class CultureConformanceTests: XCTestCase {
  private static let limit = 6

  func testCultureMatchesTheReference() throws {
    let golden = try CultureGolden.load()
    let reference = try Golden.load()
    XCTAssertEqual(golden.packVersion, reference.packVersion)
    let packs: GoldenPacks
    do {
      packs = try GoldenPacks.load(for: reference, files: golden.packs)
    } catch let error as GoldenError {
      if case .packsNotBuilt = error { throw XCTSkip(error.description) }
      throw error
    }
    let engine = try AliasEngine(
      packs: golden.packs.map { packs.byFile[$0]! }, culture: golden.culture)

    var differences: [String] = []
    for testCase in golden.cases {
      let actual = results(of: testCase, engine: engine, culture: golden.culture)
        .map(CultureGolden.Ranked.init)
      if actual != testCase.results {
        differences.append(
          "  \(testCase.q.debugDescription) region \(testCase.region.debugDescription) "
            + "\(testCase.day) text \(testCase.text):\n    swift \(actual)\n    ts    "
            + "\(testCase.results)")
      }
    }
    let count = golden.cases.count
    let withCulture = golden.cases.filter { $0.results.contains { $0.source == "culture" } }.count
    print(
      String(
        format: "conformance: culture cases (%d with culture results): %d/%d (%.1f%%)",
        withCulture, count - differences.count, count,
        Double(count - differences.count) * 100 / Double(max(1, count))))
    for line in differences { print(line) }
    XCTAssertGreaterThan(withCulture, 0)
    XCTAssertEqual(differences, [])
  }

  /// What make-golden.ts records: `engine.search` for a query, or the canonical results with
  /// `applyCulture(text: true)` for a message. "" is no region, never the device's.
  private func results(of testCase: CultureGolden.Case, engine: AliasEngine, culture: Culture)
    -> [AliasResult]
  {
    let options = AliasSearchOptions(
      limit: Self.limit, locale: "en", region: testCase.region, day: testCase.day)
    guard testCase.text else { return engine.search(testCase.q, options: options).results }
    return CultureLayer.applyCulture(
      engine.canonicalSearch(testCase.q, options: options).results, culture: culture,
      query: testCase.q, region: testCase.region.isEmpty ? nil : testCase.region,
      day: testCase.day, text: true, limit: Self.limit, engine: engine, locale: "en")
  }
}
