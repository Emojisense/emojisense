import XCTest

@testable import Emojisense

final class EmojiSetTests: XCTestCase {
  func testHexcodesMatchEmojibase() {
    let cases: [(String, String)] = [
      ("👍", "1F44D"),
      ("👍🏽", "1F44D-1F3FD"),
      ("❤️", "2764"),
      ("❤️‍🔥", "2764-FE0F-200D-1F525"),
      ("🏌🏿‍♂️", "1F3CC-1F3FF-200D-2642-FE0F"),
      ("🧑🏾‍🤝‍🧑🏾", "1F9D1-1F3FE-200D-1F91D-200D-1F9D1-1F3FE"),
      ("#️⃣", "0023-FE0F-20E3"),
      ("🇺🇸", "1F1FA-1F1F8"),
      ("🏴󠁧󠁢󠁥󠁮󠁧󠁿", "1F3F4-E0067-E0062-E0065-E006E-E0067-E007F"),
    ]
    for (emoji, hexcode) in cases {
      XCTAssertEqual(Hexcode.of(emoji), hexcode, emoji)
    }
  }

  func testHostedSetsPointAtTheSetsRoute() throws {
    let endpoint = try XCTUnwrap(URL(string: "https://api.emojisense.com/"))
    XCTAssertEqual(
      EmojiSet.twemoji.imageURL(for: "👍🏽", endpoint: endpoint)?.absoluteString,
      "https://api.emojisense.com/v1/sets/twemoji/1F44D-1F3FD.svg")
    XCTAssertEqual(
      EmojiSet.fluent.imageURL(for: "#️⃣", endpoint: endpoint)?.absoluteString,
      "https://api.emojisense.com/v1/sets/fluent/0023-FE0F-20E3.svg")
    XCTAssertNil(EmojiSet.native.imageURL(for: "👍", endpoint: endpoint))
  }

  func testHostedSetsSendThePublishableKey() throws {
    let endpoint = try XCTUnwrap(URL(string: "https://api.emojisense.com"))
    XCTAssertEqual(
      EmojiSet.noto.imageURL(for: "👍", endpoint: endpoint, key: "pk_live_a+b")?.absoluteString,
      "https://api.emojisense.com/v1/sets/noto/1F44D.svg?key=pk_live_a%2Bb")
    XCTAssertEqual(
      EmojiSet.noto.imageURL(for: "👍", endpoint: endpoint, key: "")?.absoluteString,
      "https://api.emojisense.com/v1/sets/noto/1F44D.svg")
  }

  func testMatchesTheTypeScriptSetList() throws {
    XCTAssertEqual(EmojiSet.allCases.map(\.rawValue), ["native", "twemoji", "noto", "fluent"])
    XCTAssertEqual(EmojiSet.allCases.filter(\.isHosted), [.twemoji, .noto, .fluent])
    let decoded = try JSONDecoder().decode([EmojiSet].self, from: Data(#"["noto"]"#.utf8))
    XCTAssertEqual(decoded, [.noto])
  }
}
