/// Typo tolerance for the alias engine (PACK_FORMAT.md §4). Tokens are UTF-16 code units, as in
/// `packages/core/src/fuzzy.ts`, so lengths and edits count the same way on every platform.
public enum Fuzzy {
  /// Edits tolerated for a token of this UTF-16 length: none below 4, 1 up to 7, then 2.
  public static func maxEdits(forLength length: Int) -> Int {
    if length < 4 { return 0 }
    return length < 8 ? 1 : 2
  }

  /// Optimal-string-alignment distance (Levenshtein + adjacent transposition), bounded: returns
  /// `max + 1` as soon as a row shows that the distance must exceed `max`.
  public static func boundedEditDistance(_ a: String, _ b: String, max: Int) -> Int {
    var distance = EditDistance()
    return distance.compute(Array(a.utf16), Array(b.utf16), max: max)
  }

  /// Cheap gate before the edit distance: people rarely mistype the first letter, so the tokens
  /// must agree on it, or on a swap of the first two letters.
  static func isPlausibleTypo(_ typed: [UInt16], _ candidate: [UInt16]) -> Bool {
    guard let typedFirst = typed.first, let candidateFirst = candidate.first else { return false }
    if typedFirst == candidateFirst { return true }
    guard typed.count > 1, candidate.count > 1 else { return false }
    return typedFirst == candidate[1] && candidateFirst == typed[1]
  }

  /// "upp" → "up", "happpy" stays: removes the repetition of the final unit, or returns nil
  /// when the token does not end in a repeated unit (JavaScript `/(.)\1+$/` → "$1").
  static func squeezingRepeatedEnding(_ units: [UInt16]) -> [UInt16]? {
    guard let last = units.last, !lineTerminators.contains(last) else { return nil }
    var runStart = units.count - 1
    while runStart > 0 && units[runStart - 1] == last { runStart -= 1 }
    return runStart < units.count - 1 ? Array(units[...runStart]) : nil
  }

  /// JavaScript's `.` does not match these.
  private static let lineTerminators: Set<UInt16> = [0x0A, 0x0D, 0x2028, 0x2029]
}

/// Row buffers for the bounded edit distance, reused across calls: the fuzzy scan compares
/// thousands of tokens per keystroke.
struct EditDistance {
  private var beforePrevious = [Int32](repeating: 0, count: 32)
  private var previous = [Int32](repeating: 0, count: 32)
  private var current = [Int32](repeating: 0, count: 32)

  mutating func compute(_ a: [UInt16], _ b: [UInt16], max: Int) -> Int {
    if abs(a.count - b.count) > max { return max + 1 }
    if a == b { return 0 }

    let width = b.count + 1
    if previous.count < width {
      beforePrevious = [Int32](repeating: 0, count: width * 2)
      previous = [Int32](repeating: 0, count: width * 2)
      current = [Int32](repeating: 0, count: width * 2)
    }
    for column in 0..<width { previous[column] = Int32(column) }

    for row in stride(from: 1, through: a.count, by: 1) {
      current[0] = Int32(row)
      var rowMinimum = Int32(row)
      for column in 1..<width {
        let cost: Int32 = a[row - 1] == b[column - 1] ? 0 : 1
        var value = Swift.min(
          previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost)
        if row > 1 && column > 1 && a[row - 1] == b[column - 2] && a[row - 2] == b[column - 1] {
          value = Swift.min(value, beforePrevious[column - 2] + 1)
        }
        current[column] = value
        if value < rowMinimum { rowMinimum = value }
      }
      if Int(rowMinimum) > max { return max + 1 }
      swap(&beforePrevious, &previous)
      swap(&previous, &current)
    }
    return Int(previous[b.count])
  }
}
