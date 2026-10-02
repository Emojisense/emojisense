import CryptoKit
import Foundation

@testable import Emojisense

/// Resources/golden.json, written by sdks/swift/scripts/make-golden.ts from the TypeScript engine.
struct Golden: Decodable, Sendable {
  struct Normalization: Decodable, Sendable {
    struct Sweep: Decodable, Sendable {
      let blockSize: Int
      let ranges: [[Int]]
      let hashes: [String]
    }

    /// `[input, expected]` pairs.
    let cases: [[String]]
    let sweep: Sweep
  }

  struct EmbeddingText: Decodable, Sendable {
    let cases: [[String]]
  }

  struct Ranked: Decodable, Equatable, Sendable, CustomStringConvertible {
    let id: String
    let score: Double

    init(_ result: AliasResult) {
      id = result.id
      score = result.score
    }

    /// Stored as `[id, score]`.
    init(from decoder: any Decoder) throws {
      var container = try decoder.unkeyedContainer()
      id = try container.decode(String.self)
      score = try container.decode(Double.self)
    }

    var description: String { "\(id) \(score)" }
  }

  struct SearchCase: Decodable, Sendable {
    let id: String
    let q: String
    let locale: String
    let query: String
    let confidence: Double
    /// `AliasSearchOutput.coverage`, rounded to 3 decimals by the reference.
    let coverage: Double
    let top: [Ranked]
    let match: String?
    let field: String?
  }

  struct SearchConfig: Decodable, Sendable {
    let name: String
    let packs: [String]
    let cases: [SearchCase]
  }

  struct Keystrokes: Decodable, Sendable {
    struct Case: Decodable, Sendable {
      let q: String
      let locale: String
      let top: [Ranked]
    }

    let packs: [String]
    let cases: [Case]
  }

  /// `assess`, `semanticStrength` and `mergeConcept` (core/src/confidence.ts) on generated inputs.
  struct ConfidenceCase: Decodable, Sendable {
    struct Alias: Decodable, Sendable {
      let tokens: [String]
      let confidence: Double
      let coverage: Double
      let results: [Ranked]

      var output: AliasSearchOutput {
        AliasSearchOutput(
          query: tokens.joined(separator: " "), tokens: tokens,
          results: results.map {
            AliasResult(
              emoji: $0.id, id: $0.id, score: $0.score, label: $0.id, match: "a", field: .alias)
          },
          confidence: confidence, coverage: coverage)
      }
    }

    /// Stored as `[id, score, source]`.
    struct Sourced: Decodable, Sendable {
      let result: SearchResult

      init(from decoder: any Decoder) throws {
        var container = try decoder.unkeyedContainer()
        let id = try container.decode(String.self)
        let score = try container.decode(Double.self)
        let source = try container.decode(ResultSource.self)
        result = SearchResult(emoji: id, id: id, score: score, source: source)
      }
    }

    /// `nil`: no alias output given.
    let alias: Alias?
    /// `nil`: no semantic list given.
    let semantic: [Sourced]?
    let concept: [Ranked]
    let fused: [Sourced]
    let limit: Int
    /// Unrounded. `nil` (or, in files made before 2026-10-02 19:30, a value of a list not in the
    /// file) when the case gives no semantic list.
    let strength: Double?
    let confidence: Double
    let unsure: Bool
    let merged: [String]
  }

  let node: String
  let unicode: String
  let packVersion: String
  let packSha256: [String: String]
  let normalization: Normalization
  let embeddingText: EmbeddingText
  /// The reference function-word lists per locale (PACK_FORMAT.md §4).
  let functionWords: [String: [String]]
  let search: [SearchConfig]
  let keystrokes: Keystrokes
  /// Sentences of the other pack locales, typed keystroke by keystroke (en + that locale).
  let sentenceKeystrokes: [Keystrokes]
  /// `fuse` on recorded lists, with and without the reranker (PACK_FORMAT.md §10).
  let fusion: [FusionCase]

  struct FusionCase: Decodable, Sendable {
    struct Alias: Decodable, Sendable {
      let query: String
      let confidence: Double
      let results: [Ranked]
      /// The top result's match and field (null without results).
      let match: String?
      let field: String?
    }

    /// Stored as `[emoji, id, score]`.
    struct Semantic: Decodable, Sendable {
      let emoji: String
      let id: String
      let score: Double

      init(from decoder: any Decoder) throws {
        var container = try decoder.unkeyedContainer()
        emoji = try container.decode(String.self)
        id = try container.decode(String.self)
        score = try container.decode(Double.self)
      }
    }

    let q: String
    let alias: Alias
    let semantic: [Semantic]
    let popularity: [String: Double]
    let reranked: [String]
    let reciprocal: [String]
  }
  /// Entity queries per locale (en + that locale), then the guard queries with every locale.
  let entityKeystrokes: [Keystrokes]
  let confidence: [ConfidenceCase]

  static func load() throws -> Golden {
    guard let url = Bundle.module.url(forResource: "golden", withExtension: "json") else {
      throw GoldenError.missingResource
    }
    return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
  }
}

enum GoldenError: Error, CustomStringConvertible {
  case missingResource
  case packsNotBuilt(URL)
  case stalePack(String)

  var description: String {
    switch self {
    case .missingResource:
      "golden.json is missing from the test bundle"
    case .packsNotBuilt(let directory):
      "no packs in \(directory.path). Run `pnpm data:build` at the repository root, or set "
        + "EMOJISENSE_PACK_DIR."
    case .stalePack(let file):
      "\(file) is not the pack golden.json was made from. Rebuild the packs (`pnpm data:build`) "
        + "or, if the data or packages/core changed on purpose, regenerate golden.json "
        + "(`pnpm exec tsx sdks/swift/scripts/make-golden.ts`)."
    }
  }
}

/// The packs of the golden pack version, read from the monorepo build output.
struct GoldenPacks: Sendable {
  let byFile: [String: Pack]

  /// `EMOJISENSE_PACK_DIR`, else `packages/data/dist/packs/<version>` of this repository.
  static func directory(packVersion: String) -> URL {
    if let override = ProcessInfo.processInfo.environment["EMOJISENSE_PACK_DIR"] {
      return URL(fileURLWithPath: override, isDirectory: true)
    }
    var repositoryRoot = URL(fileURLWithPath: #filePath)
    // Support/Golden.swift → EmojisenseTests → Tests → swift → sdks → repository root
    for _ in 0..<6 { repositoryRoot.deleteLastPathComponent() }
    return repositoryRoot.appendingPathComponent("packages/data/dist/packs/\(packVersion)")
  }

  static func load(for golden: Golden) throws -> GoldenPacks {
    let directory = directory(packVersion: golden.packVersion)
    var byFile: [String: Pack] = [:]
    for (file, expectedHash) in golden.packSha256 {
      let url = directory.appendingPathComponent(file)
      guard FileManager.default.fileExists(atPath: url.path) else {
        throw GoldenError.packsNotBuilt(directory)
      }
      let data = try Data(contentsOf: url)
      let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      guard hash == expectedHash else { throw GoldenError.stalePack(file) }
      byFile[file] = try Pack(jsonData: data)
    }
    return GoldenPacks(byFile: byFile)
  }

  /// One engine per pack list, built on first use: several checks share a configuration.
  func engine(files: [String]) throws -> AliasEngine {
    try engines.engine(files: files) { try AliasEngine(packs: files.map { byFile[$0]! }) }
  }

  private let engines = EngineCache()
}

private final class EngineCache: @unchecked Sendable {
  private let lock = NSLock()
  private var byFiles: [[String]: AliasEngine] = [:]

  func engine(files: [String], make: () throws -> AliasEngine) rethrows -> AliasEngine {
    lock.lock()
    defer { lock.unlock() }
    if let engine = byFiles[files] { return engine }
    let engine = try make()
    byFiles[files] = engine
    return engine
  }
}
