/// Per-phrase and per-emoji state of one search, reused by every search of an engine.
///
/// A generation stamp marks which slots belong to the current search, so starting a search costs
/// nothing even though common words touch thousands of phrases.
struct SearchScratch {
  /// `phrase * maxQueryTokens + token` → best match quality of that token in that phrase.
  /// Float32 like the reference engine's `Float32Array`: the rounding is part of the scores.
  private var quality: [Float]
  private var phraseStamp: [UInt32]
  private(set) var touchedPhrases: [Int32] = []

  private var emojiStamp: [UInt32]
  private(set) var emojiScore: [Double]
  private(set) var emojiPhrase: [Int32]
  /// Matching phrases from preferred-locale packs, the best phrase included.
  private(set) var emojiPreferred: [Int32]
  private(set) var touchedEmoji: [Int32] = []

  var editDistance = EditDistance()
  private var generation: UInt32 = 0

  init(phraseCount: Int, emojiCount: Int) {
    quality = Array(repeating: 0, count: phraseCount * Scoring.maxQueryTokens)
    phraseStamp = Array(repeating: 0, count: phraseCount)
    emojiStamp = Array(repeating: 0, count: emojiCount)
    emojiScore = Array(repeating: 0, count: emojiCount)
    emojiPhrase = Array(repeating: 0, count: emojiCount)
    emojiPreferred = Array(repeating: 0, count: emojiCount)
  }

  mutating func startSearch() {
    generation &+= 1
    if generation == 0 {
      // The stamps wrapped around: clear them so no slot looks current.
      phraseStamp = Array(repeating: 0, count: phraseStamp.count)
      emojiStamp = Array(repeating: 0, count: emojiStamp.count)
      generation = 1
    }
    touchedPhrases.removeAll(keepingCapacity: true)
    touchedEmoji.removeAll(keepingCapacity: true)
  }

  mutating func record(quality value: Double, phrase: Int, token: Int, tokenCount: Int) {
    let base = phrase * Scoring.maxQueryTokens
    if phraseStamp[phrase] != generation {
      phraseStamp[phrase] = generation
      for slot in base..<(base + tokenCount) { quality[slot] = 0 }
      touchedPhrases.append(Int32(phrase))
    }
    if value > Double(quality[base + token]) { quality[base + token] = Float(value) }
  }

  func qualities(phrase: Int, tokenCount: Int) -> ArraySlice<Float> {
    let base = phrase * Scoring.maxQueryTokens
    return quality[base..<(base + tokenCount)]
  }

  mutating func recordEmoji(_ emoji: Int, phrase: Int32, score: Double, preferred: Bool) {
    if emojiStamp[emoji] != generation {
      emojiStamp[emoji] = generation
      emojiScore[emoji] = score
      emojiPhrase[emoji] = phrase
      emojiPreferred[emoji] = 0
      touchedEmoji.append(Int32(emoji))
    } else if score > emojiScore[emoji] {
      emojiScore[emoji] = score
      emojiPhrase[emoji] = phrase
    }
    if preferred { emojiPreferred[emoji] += 1 }
  }
}
