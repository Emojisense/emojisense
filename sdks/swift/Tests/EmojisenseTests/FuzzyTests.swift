import XCTest

@testable import Emojisense

final class FuzzyTests: XCTestCase {
  func testBoundedEditDistance() {
    let cases: [(String, String, Int, Int)] = [
      ("pizza", "pizza", 2, 0),
      ("pizaa", "pizza", 2, 1),
      ("rockt", "rocket", 2, 1),
      ("hallowelen", "halloween", 2, 1),
      ("teh", "the", 1, 1),
      ("dinosuar", "dinosaur", 2, 1),
      ("cat", "dog", 1, 2),
      ("a", "abcdef", 2, 3),
    ]
    for (a, b, max, expected) in cases {
      XCTAssertEqual(Fuzzy.boundedEditDistance(a, b, max: max), expected, "\(a) ↔ \(b)")
    }
  }

  func testAllowsEditsOnlyForLongerTokens() {
    XCTAssertEqual(Fuzzy.maxEdits(forLength: 3), 0)
    XCTAssertEqual(Fuzzy.maxEdits(forLength: 5), 1)
    XCTAssertEqual(Fuzzy.maxEdits(forLength: 10), 2)
  }

  func testSqueezesARepeatedFinalLetter() {
    let squeeze = { (token: String) in
      Fuzzy.squeezingRepeatedEnding(Array(token.utf16)).map { String(decoding: $0, as: UTF16.self) }
    }
    XCTAssertEqual(squeeze("upp"), "up")
    XCTAssertEqual(squeeze("aaa"), "a")
    XCTAssertNil(squeeze("happy"))
  }

  func testGatesTyposOnTheFirstLetters() {
    let gate = { (a: String, b: String) in Fuzzy.isPlausibleTypo(Array(a.utf16), Array(b.utf16)) }
    XCTAssertTrue(gate("rockt", "rocket"))
    XCTAssertTrue(gate("teh", "eth"))
    XCTAssertFalse(gate("pizza", "lizza"))
  }
}

final class ReferenceMathTests: XCTestCase {
  /// Bit patterns of `Math.log(1 + 1914 / df)` printed by Node 24 on arm64. Darwin's `log`
  /// differs from them in the last bit.
  func testLogMatchesV8BitForBit() {
    let expected: [(Double, UInt64)] = [
      (1 + 1914.0 / 85, 0x4009_4312_ff47_b24a),
      (1 + 1914.0 / 92, 0x4008_a828_f7f8_9000),
      (1 + 1914.0 / 443, 0x3ffa_bec5_9109_2dca),
      (1 + 1914.0 / 1088, 0x3ff0_3d2f_3161_9c5c),
      (1 + 1913.0 / 418, 0x3ffb_7f44_857c_fe00),
    ]
    for (input, bits) in expected {
      XCTAssertEqual(ReferenceMath.log(input).bitPattern, bits, "log(\(input))")
    }
    XCTAssertEqual(ReferenceMath.log(1), 0)
    XCTAssertEqual(ReferenceMath.log(0), -.infinity)
    XCTAssertTrue(ReferenceMath.log(-1).isNaN)
  }
}
