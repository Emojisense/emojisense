import XCTest

@testable import Emojisense

final class NormalizerTests: XCTestCase {
  func testMatchesTheReferenceExamples() {
    let cases = [
      ("  Thumbs   UP ", "thumbs up"),
      ("doğum günü", "dogum gunu"),
      ("İYİ Kİ DOĞDUN", "iyi ki dogdun"),
      ("IŞIK", "isik"),
      ("Pokémon", "pokemon"),
      ("i'm exhausted", "im exhausted"),
      ("ship-it!!!", "ship it"),
      (":rocket:", "rocket"),
      ("+1", "+1"),
      ("c++ rocks", "c rocks"),
      ("🚀 launch 👍🏽", "launch"),
      ("👩‍🚀", ""),
      ("ｆｕｌｌｗｉｄｔｈ", "fullwidth"),
      ("¡Feliz cumpleaños!", "feliz cumpleanos"),
      ("Joyeux Noël", "joyeux noel"),
      ("Straße", "strasse"),
      ("Ёлка", "елка"),
      ("Chúc mừng sinh nhật", "chuc mung sinh nhat"),
      ("Đà Lạt", "da lat"),
      ("مَرْحَبًا", "مرحبا"),
      ("नमस्ते", "नमस्ते"),
      ("শুভ জন্মদিন", "শুভ জন্মদিন"),
      ("がんばって", "がんばって"),
      ("축하해요", "축하해요"),
      ("生日快乐", "生日快乐"),
      ("สุขสันต์วันเกิด", "สุขสันต์วันเกิด"),
    ]
    for (input, expected) in cases {
      XCTAssertEqual(Normalizer.normalize(input), expected, "normalize(\(input))")
    }
  }

  func testKeepsMarksThatArePartOfTheSpelling() {
    // NFC recomposes kana and Hangul after the optional accents are gone.
    XCTAssertEqual(Normalizer.normalize("ｶﾞﾝﾊﾞﾚ"), "ガンバレ")
    XCTAssertEqual(Normalizer.normalize("\u{1112}\u{1161}\u{11AB}"), "한")
    XCTAssertEqual(Normalizer.normalize("Łódź Øresund"), "lodz oresund")
  }

  func testAppliesFinalSigmaLikeJavaScript() {
    XCTAssertEqual(Normalizer.normalize("ΟΔΟΣ ΣΑΣ"), "οδος σας")
    XCTAssertEqual(Normalizer.normalize("Σ"), "σ")
  }

  func testKeepsPlusOnlyBeforeAnASCIIDigit() {
    XCTAssertEqual(Normalizer.normalize("+1 a+b ++1 1+1 +٣"), "+1 a b +1 1+1 ٣")
  }

  func testCapsLengthInUTF16Units() {
    XCTAssertLessThanOrEqual(
      Normalizer.normalize(String(repeating: "a ", count: 100)).utf16.count,
      Normalizer.maxQueryLength)
    let astral = String(repeating: "x", count: 62) + "𝔞𝔟"
    XCTAssertEqual(Normalizer.normalize(astral).utf16.count, 64)
  }

  func testIsIdempotent() {
    for input in ["Doğum Günü!", "i'm so tired", "T-Rex", "ΟΔΟΣ", "안녕하세요"] {
      let once = Normalizer.normalize(input)
      XCTAssertEqual(Normalizer.normalize(once), once)
    }
  }

  func testTokenizesOnSingleSpaces() {
    XCTAssertEqual(Normalizer.tokenize(""), [])
    XCTAssertEqual(Normalizer.tokenize("ship it"), ["ship", "it"])
  }

  func testRecognizesEmojiParts() {
    XCTAssertTrue(Normalizer.isEmojiPart("🚀"))
    XCTAssertTrue(Normalizer.isEmojiPart("\u{1F3FD}"))
    XCTAssertTrue(Normalizer.isEmojiPart("\u{1F1F9}"))
    XCTAssertTrue(Normalizer.isEmojiPart("\u{E0067}"))
    XCTAssertFalse(Normalizer.isEmojiPart("#"))
    XCTAssertFalse(Normalizer.isEmojiPart("a"))
  }
}
