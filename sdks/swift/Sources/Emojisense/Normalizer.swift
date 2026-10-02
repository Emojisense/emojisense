import Foundation

/// The one text normalization of Emojisense (PACK_FORMAT.md §3).
///
/// Queries and labels go through it before search. Pack phrases are stored already normalized.
/// Every step mirrors `packages/core/src/normalize.ts`, including the JavaScript details that the
/// spec leaves implicit: lowercasing applies the Final_Sigma rule, lengths count UTF-16 units, and
/// the Unicode version is the one of the reference runtime (``UnicodeReference/version``).
public enum Normalizer {
  public static let maxQueryLength = 64

  public static func normalize(_ input: String, maxLength: Int = maxQueryLength) -> String {
    let known = replaceScalarsNewerThanReference(in: input)
    let compatible = UnicodeForms.nfkc(known)
    let withoutEmoji = replaceEmojiParts(in: compatible.unicodeScalars)
    let lowercased = string(from: lowercase(withoutEmoji))
    let folded = string(from: foldAccents(UnicodeForms.nfd(lowercased).unicodeScalars))
    let words = separateWords(UnicodeForms.nfc(folded).unicodeScalars)
    let collapsed = collapseSpaces(separateLonePluses(words))
    return string(from: truncate(collapsed, maxUTF16Length: maxLength))
  }

  /// The text the semantic tier embeds, like `embeddingText` in packages/core/src/normalize.ts:
  /// NFKC, lowercase, every run of spacing characters (controls, separators, U+FEFF) to one
  /// space, trimmed, at most `maxLength` UTF-16 units. Accents, punctuation and emoji stay,
  /// because the embedding model reads them. ``SemanticClient`` sends it as `q`.
  public static func embeddingText(_ input: String, maxLength: Int = maxQueryLength) -> String {
    let lowercased = string(from: lowercase(Array(UnicodeForms.nfkc(input).unicodeScalars)))
    let spaced = UnicodeForms.nfkc(lowercased).unicodeScalars.map { isSpacing($0) ? " " : $0 }
    return string(from: truncate(collapseSpaces(spaced), maxUTF16Length: maxLength))
  }

  /// Splits a normalized string into tokens (JavaScript `split(" ")` semantics).
  public static func tokenize(_ normalized: String) -> [String] {
    normalized.isEmpty ? [] : normalized.splitOnScalar(" ", omittingEmpty: false)
  }

  // MARK: Steps

  /// Code points assigned after the reference Unicode version are unassigned for the reference
  /// engine, so its step 9 turns them into separators. Make them separators up front: a newer OS
  /// must not change the tokens.
  private static func replaceScalarsNewerThanReference(in input: String) -> String {
    guard input.unicodeScalars.contains(where: isNewerThanReference) else { return input }
    var result = String.UnicodeScalarView()
    for scalar in input.unicodeScalars {
      result.append(isNewerThanReference(scalar) ? " " : scalar)
    }
    return String(result)
  }

  /// Steps 2–3: emoji parts become a space; invisible emoji glue disappears.
  private static func replaceEmojiParts(in scalars: String.UnicodeScalarView) -> [Unicode.Scalar] {
    var result: [Unicode.Scalar] = []
    result.reserveCapacity(scalars.count)
    for scalar in scalars {
      if isEmojiPart(scalar) {
        result.append(" ")
      } else if !emojiGlue.contains(scalar.value) {
        result.append(scalar)
      }
    }
    return result
  }

  /// Step 4: locale-independent full lowercase mapping, with the conditional Final_Sigma rule.
  private static func lowercase(_ scalars: [Unicode.Scalar]) -> [Unicode.Scalar] {
    var result: [Unicode.Scalar] = []
    result.reserveCapacity(scalars.count)
    for (index, scalar) in scalars.enumerated() {
      if scalar.isASCII {
        result.append(Unicode.Scalar(UInt8(ascii: scalar).lowercasedASCII))
      } else if scalar == capitalSigma && isFinalSigma(in: scalars, at: index) {
        result.append(smallFinalSigma)
      } else {
        result.append(contentsOf: scalar.properties.lowercaseMapping.unicodeScalars)
      }
    }
    return result
  }

  /// Steps 5–6 (after NFD): drop the optional accents and fold the letters people type without
  /// their stroke. Marks that are part of the spelling (Devanagari, Bengali, Thai, kana) stay.
  private static func foldAccents(_ scalars: String.UnicodeScalarView) -> [Unicode.Scalar] {
    var result: [Unicode.Scalar] = []
    result.reserveCapacity(scalars.count)
    for scalar in scalars where !isOptionalMark(scalar) {
      if let folded = letterFolds[scalar] {
        result.append(contentsOf: folded.unicodeScalars)
      } else {
        result.append(scalar)
      }
    }
    return result
  }

  /// Steps 8–9 (after NFC): drop apostrophes and turn every run of characters that are not a
  /// letter, a mark, a number or `+` into one space.
  private static func separateWords(_ scalars: String.UnicodeScalarView) -> [Unicode.Scalar] {
    var result: [Unicode.Scalar] = []
    result.reserveCapacity(scalars.count)
    var inSeparatorRun = false
    for scalar in scalars where !apostrophes.contains(scalar.value) {
      if scalar.properties.generalCategory.isWordCharacter || scalar == "+" {
        result.append(scalar)
        inSeparatorRun = false
      } else if !inSeparatorRun {
        result.append(" ")
        inSeparatorRun = true
      }
    }
    return result
  }

  /// Step 10: a `+` that is not followed by an ASCII digit becomes a space ("+1" stays, "c++" does
  /// not).
  private static func separateLonePluses(_ scalars: [Unicode.Scalar]) -> [Unicode.Scalar] {
    var result = scalars
    for index in result.indices where result[index] == "+" {
      let next = index + 1 < result.count ? result[index + 1] : nil
      if !(next.map(isASCIIDigit) ?? false) { result[index] = " " }
    }
    return result
  }

  /// Step 11: collapse runs of spaces and trim.
  private static func collapseSpaces(_ scalars: [Unicode.Scalar]) -> [Unicode.Scalar] {
    var result: [Unicode.Scalar] = []
    result.reserveCapacity(scalars.count)
    for scalar in scalars {
      if scalar == " " && (result.isEmpty || result.last == " ") { continue }
      result.append(scalar)
    }
    if result.last == " " { result.removeLast() }
    return result
  }

  /// Step 12: keep at most `maxUTF16Length` UTF-16 code units, then trim the end.
  ///
  /// JavaScript can cut a surrogate pair in half here and keep a lone high surrogate. A Swift
  /// string cannot hold one, so a pair that does not fit is dropped as a whole.
  private static func truncate(_ scalars: [Unicode.Scalar], maxUTF16Length: Int) -> [Unicode.Scalar]
  {
    let totalLength = scalars.reduce(0) { $0 + utf16Length(of: $1) }
    if totalLength <= maxUTF16Length { return scalars }
    var result: [Unicode.Scalar] = []
    var length = 0
    for scalar in scalars {
      length += utf16Length(of: scalar)
      if length > maxUTF16Length { break }
      result.append(scalar)
    }
    while result.last == " " { result.removeLast() }
    return result
  }

  // MARK: Character classes

  private static let emojiGlue: Set<UInt32> = [0x200D, 0xFE0E, 0xFE0F, 0x20E3]
  private static let apostrophes: Set<UInt32> = [0x27, 0x2019, 0x60, 0xB4]
  /// Letters with no decomposition that people still type without the stroke.
  private static let letterFolds: [Unicode.Scalar: String] = [
    "ı": "i", "đ": "d", "ł": "l", "ø": "o", "ß": "ss",
  ]
  private static let capitalSigma: Unicode.Scalar = "\u{03A3}"
  private static let smallFinalSigma: Unicode.Scalar = "\u{03C2}"

  /// Accents people skip when typing: Latin, Greek and Cyrillic diacritics, Arabic harakat and
  /// tatweel, Hebrew points. The ranges are literal, as in the spec (U+05BE, U+05C0, U+05C3 and
  /// U+05C6 are Hebrew punctuation inside the range and go too).
  private static func isOptionalMark(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x0300...0x036F, 0x064B...0x065F, 0x0670, 0x0640, 0x0591...0x05C7: true
    default: false
    }
  }

  /// `[\p{Cc}\p{Z}\uFEFF]`: what `embeddingText` turns into a space.
  private static func isSpacing(_ scalar: Unicode.Scalar) -> Bool {
    if scalar.value == 0xFEFF { return true }
    switch scalar.properties.generalCategory {
    case .control, .spaceSeparator, .lineSeparator, .paragraphSeparator: return true
    default: return false
    }
  }

  private static func isNewerThanReference(_ scalar: Unicode.Scalar) -> Bool {
    guard !scalar.isASCII, let age = scalar.properties.age else { return false }
    let reference = UnicodeReference.version
    return age.major > reference.major
      || (age.major == reference.major && age.minor > reference.minor)
  }

  static func isEmojiPart(_ scalar: Unicode.Scalar) -> Bool {
    let ranges = UnicodeReference.emojiPartRanges
    var low = 0
    var high = ranges.count
    while low < high {
      let middle = (low + high) / 2
      if ranges[middle].upperBound < scalar.value {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return low < ranges.count && ranges[low].contains(scalar.value)
  }

  /// Final_Sigma as ICU evaluates it, and with it every JavaScript engine: preceded by a cased
  /// letter and not followed by one, skipping case-ignorable characters even when they are cased.
  private static func isFinalSigma(in scalars: [Unicode.Scalar], at index: Int) -> Bool {
    hasCasedNeighbor(in: scalars, from: index, step: -1)
      && !hasCasedNeighbor(in: scalars, from: index, step: 1)
  }

  private static func hasCasedNeighbor(in scalars: [Unicode.Scalar], from index: Int, step: Int)
    -> Bool
  {
    var position = index + step
    while scalars.indices.contains(position) {
      let properties = scalars[position].properties
      if !properties.isCaseIgnorable { return properties.isCased }
      position += step
    }
    return false
  }

  private static func isASCIIDigit(_ scalar: Unicode.Scalar) -> Bool {
    ("0"..."9").contains(scalar)
  }

  private static func utf16Length(of scalar: Unicode.Scalar) -> Int {
    scalar.value > 0xFFFF ? 2 : 1
  }

  private static func string(from scalars: [Unicode.Scalar]) -> String {
    var result = String.UnicodeScalarView()
    result.append(contentsOf: scalars)
    return String(result)
  }
}

extension Unicode.GeneralCategory {
  /// Letter (`L`), mark (`M`) or number (`N`).
  fileprivate var isWordCharacter: Bool {
    switch self {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
      .nonspacingMark, .spacingMark, .enclosingMark,
      .decimalNumber, .letterNumber, .otherNumber:
      true
    default: false
    }
  }
}

extension UInt8 {
  fileprivate var lowercasedASCII: UInt8 {
    (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains(self) ? self + 32 : self
  }
}

extension String {
  /// JavaScript `split` on one separator scalar. Unlike `split(separator:)` on a `String`, it does
  /// not treat a separator followed by a combining mark as a different character.
  func splitOnScalar(_ separator: Unicode.Scalar, omittingEmpty: Bool) -> [String] {
    unicodeScalars
      .split(separator: separator, omittingEmptySubsequences: omittingEmpty)
      .map { String(Substring($0)) }
  }
}
