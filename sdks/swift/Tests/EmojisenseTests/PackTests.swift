import XCTest

@testable import Emojisense

final class PackTests: XCTestCase {
  private func packJSON(format: String = Pack.format, formatVersion: Int = 1, extra: String = "")
    -> Data
  {
    Data(
      """
      {"format":"\(format)","formatVersion":\(formatVersion),"packVersion":"0.1.0","locale":"en",
       "emojiVersion":"17.0","groups":["smileys-emotion"]\(extra),
       "emoji":[["🦖","1F996",0,5,1,"T-Rex","t rex","dinosaur|rex","jurassic park","dinasour",""]]}
      """.utf8)
  }

  func testDecodesHeterogeneousRows() throws {
    let pack = try Pack(jsonData: packJSON())
    XCTAssertEqual(pack.part, .core)
    XCTAssertEqual(
      pack.emoji.first,
      PackRow(
        emoji: "🦖", hexcode: "1F996", group: 0, version: 5, hasSkinTones: true, label: "T-Rex",
        shortcode: "t rex", keyword: "dinosaur|rex", alias: "jurassic park", typo: "dinasour",
        low: ""))
  }

  func testReadsThePartAndWeightOverrides() throws {
    let pack = try Pack(jsonData: packJSON(extra: #","part":"ext","weights":{"alias":0.7,"x":1}"#))
    XCTAssertEqual(pack.part, .ext)
    XCTAssertEqual(pack.weight(for: .alias), 0.7)
    XCTAssertEqual(pack.weight(for: .keyword), 0.85)
  }

  func testRejectsOtherFormats() {
    XCTAssertThrowsError(try Pack(jsonData: packJSON(format: "something-else"))) { error in
      XCTAssertEqual(
        error as? EmojisenseError,
        .invalidFormat(expected: "emojisense-pack", found: "something-else"))
    }
    XCTAssertThrowsError(try Pack(jsonData: packJSON(formatVersion: 2))) { error in
      XCTAssertEqual(
        error as? EmojisenseError, .unsupportedFormatVersion(format: "emojisense-pack", version: 2))
    }
  }

  func testLoadsCorePacksEnglishFirst() async throws {
    let english = String(decoding: packJSON(), as: UTF8.self)
    let turkish = english.replacingOccurrences(of: #""locale":"en""#, with: #""locale":"tr""#)
    let transport = StubTransport(files: ["pack.en.json": english, "pack.tr.json": turkish])
    let loader = PackLoader(
      baseURL: URL(string: "https://x.test/v1/pack/0.1.0/")!, transport: transport)
    let packs = try await loader.loadPacks(locales: ["tr", "en"])
    XCTAssertEqual(packs.map(\.locale), ["en", "tr"])
  }

  func testRejectsAFileThatDoesNotMatchTheManifest() async throws {
    let manifest = """
      {"format":"emojisense-manifest","formatVersion":1,"packVersion":"0.1.0","emojiVersion":"17.0",
       "emojiCount":1,"files":{"pack.en.json":{"sha256":"00","bytes":1,"gzipBytes":1,"locale":"en"}}}
      """
    let transport = StubTransport(files: [
      "manifest.json": manifest, "pack.en.json": String(decoding: packJSON(), as: UTF8.self),
    ])
    let loader = PackLoader(
      baseURL: URL(string: "https://x.test/v1/pack/0.1.0")!, transport: transport)
    let loaded = try await loader.loadManifest()
    do {
      _ = try await loader.loadPacks(manifest: loaded)
      XCTFail("expected a checksum error")
    } catch {
      XCTAssertEqual(error as? EmojisenseError, .checksumMismatch(file: "pack.en.json"))
    }
  }
}
