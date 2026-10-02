import Foundation
import XCTest

@testable import Emojisense

/// The API merges an app's custom emoji into search results (docs/API.md, `source: "custom"`).
final class CustomEmojiResultTests: XCTestCase {
  func testDecodesTheImageAndShortcodeOfACustomResult() throws {
    let json = """
      [{"emoji":":party_parrot:","id":"C-e1","score":0.9,"source":"custom",
        "imageUrl":"https://api.test/v1/custom/app1/e1","shortcode":"party_parrot"},
       {"emoji":"🎉","id":"1F389","score":0.7,"source":"semantic"}]
      """
    let results = try JSONDecoder().decode([SearchResult].self, from: Data(json.utf8))
    XCTAssertEqual(results[0].source, .custom)
    XCTAssertEqual(results[0].imageUrl, "https://api.test/v1/custom/app1/e1")
    XCTAssertEqual(results[0].shortcode, "party_parrot")
    XCTAssertNil(results[1].imageUrl)
    XCTAssertNil(results[1].shortcode)
  }

  func testCatalogResultsKeepTheirShape() {
    let result = SearchResult(emoji: "🚀", id: "1F680", score: 0.8, source: .alias)
    XCTAssertNil(result.imageUrl)
    XCTAssertNil(result.shortcode)
  }
}
