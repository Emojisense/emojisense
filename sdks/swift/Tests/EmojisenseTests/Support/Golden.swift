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

  let node: String
  let unicode: String
  let packVersion: String
  let packSha256: [String: String]
  let normalization: Normalization
  let search: [SearchConfig]
  let keystrokes: Keystrokes

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

  func engine(files: [String]) throws -> AliasEngine {
    try AliasEngine(packs: files.map { byFile[$0]! })
  }
}
