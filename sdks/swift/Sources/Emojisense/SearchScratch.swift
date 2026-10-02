/// Per-phrase and per-emoji state of one search, reused by every search of an engine.
///
/// A generation stamp marks which slots belong to the current search, so starting a search costs
/// nothing even though common words touch thousands of phrases.
struct SearchScratch {
  /// `phrase * maxQueryTokens + token` → best match quality of that token in that phrase.
  /// Float32 like the reference engine's `Float32Array`: the rounding is part of the scores.
  private var quality: [Float]
  /// Bit i set = query token i matches the phrase by a whole-token candidate, not a partial one.
  private var phraseWhole: [UInt8]
  private var phraseStamp: [UInt32]
  private(set) var touchedPhrases: [Int32] = []

  private var emojiStamp: [UInt32]
  private(set) var emojiScore: [Double]
  private(set) var emojiPhrase: [Int32]
  /// Matching phrases from preferred-locale packs, the best phrase included.
  private(set) var emojiPreferred: [Int32]
  /// The emoji has an exact whole-query name, shortcode, keyword or alias match in a
  /// preferred-locale pack.
  private(set) var emojiExactPreferred: [Bool]
  /// The emoji's best phrase is an exact whole-query match.
  private(set) var emojiBestExact: [Bool]
  /// The emoji's best phrase needs a partial match (a prefix completion into another locale's
  /// word).
  private(set) var emojiBestPartial: [Bool]
  private(set) var touchedEmoji: [Int32] = []

  var editDistance = EditDistance()
  private var generation: UInt32 = 0

  init(phraseCount: Int, emojiCount: Int) {
    quality = Array(repeating: 0, count: phraseCount * Scoring.maxQueryTokens)
    phraseWhole = Array(repeating: 0, count: phraseCount)
    phraseStamp = Array(repeating: 0, count: phraseCount)
    emojiStamp = Array(repeating: 0, count: emojiCount)
    emojiScore = Array(repeating: 0, count: emojiCount)
    emojiPhrase = Array(repeating: 0, count: emojiCount)
    emojiPreferred = Array(repeating: 0, count: emojiCount)
    emojiExactPreferred = Array(repeating: false, count: emojiCount)
    emojiBestExact = Array(repeating: false, count: emojiCount)
    emojiBestPartial = Array(repeating: false, count: emojiCount)
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

  /// `whole`: the candidate is the token, a typo of it or a completion into a preferred-locale
  /// word, not a partial match.
  mutating func record(
    quality value: Double, phrase: Int, token: Int, tokenCount: Int, whole: Bool
  ) {
    let base = phrase * Scoring.maxQueryTokens
    if phraseStamp[phrase] != generation {
      phraseStamp[phrase] = generation
      for slot in base..<(base + tokenCount) { quality[slot] = 0 }
      phraseWhole[phrase] = 0
      touchedPhrases.append(Int32(phrase))
    }
    if value > Double(quality[base + token]) { quality[base + token] = Float(value) }
    if whole { phraseWhole[phrase] |= 1 << token }
  }

  func qualities(phrase: Int, tokenCount: Int) -> ArraySlice<Float> {
    let base = phrase * Scoring.maxQueryTokens
    return quality[base..<(base + tokenCount)]
  }

  func wholeTokens(phrase: Int) -> UInt8 {
    phraseWhole[phrase]
  }

  /// `exact`: the phrase matches the whole query. `partial`: it needs a partial match.
  /// `strong`: its field is name, shortcode, keyword or alias.
  mutating func recordEmoji(
    _ emoji: Int, phrase: Int32, score: Double, preferred: Bool, exact: Bool, partial: Bool,
    strong: Bool
  ) {
    if emojiStamp[emoji] != generation {
      emojiStamp[emoji] = generation
      emojiScore[emoji] = score
      emojiPhrase[emoji] = phrase
      emojiPreferred[emoji] = 0
      emojiExactPreferred[emoji] = false
      emojiBestExact[emoji] = exact
      emojiBestPartial[emoji] = partial
      touchedEmoji.append(Int32(emoji))
    } else if score > emojiScore[emoji] {
      emojiScore[emoji] = score
      emojiPhrase[emoji] = phrase
      emojiBestExact[emoji] = exact
      emojiBestPartial[emoji] = partial
    }
    if preferred {
      emojiPreferred[emoji] += 1
      if exact && strong { emojiExactPreferred[emoji] = true }
    }
  }
}
