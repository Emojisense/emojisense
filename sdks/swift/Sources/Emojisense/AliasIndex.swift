/// Text compared by UTF-16 code units, as JavaScript compares strings.
///
/// Swift's `String` equality is canonical equivalence: "e\u{301}" == "é". The reference engine
/// keys its maps by exact code units, so tokens and phrases are keyed by `UTF16Text` here.
typealias UTF16Text = [UInt16]

/// The immutable Tier 0 index (PACK_FORMAT.md §4 "Index"), built once from the loaded packs.
///
/// Built exactly like `createEngine` in `packages/core/src/engine.ts`: same phrase order, same
/// vocabulary order (UTF-16 code-unit order, as JavaScript sorts), same postings and IDF.
struct AliasIndex: Sendable {
  let entries: [EmojiEntry]
  let entryIndexById: [String: Int]
  /// Popularity percentile (0–100, 0 = unknown) per entry, from the packs' `popularity`.
  let entryPopularity: [UInt8]
  let locales: [String]
  let primaryLocale: String
  let packVersion: String
  /// Locale → bit mask of the packs of that locale (core and ext count as one locale).
  let localeMasks: [String: Int]

  /// Sorted vocabulary; a token id is a position in it.
  let vocabulary: [UTF16Text]
  let tokenIds: [UTF16Text: Int32]
  let tokenIdsByLength: [Int: [Int32]]
  /// Phrases of token `t` are `postings[postingStart[t]..<postingStart[t + 1]]`.
  let postingStart: [Int32]
  let postings: [Int32]
  let idf: [Double]
  let maxIdf: Double
  /// Bit i set = a phrase of `packs[i]` has the token.
  let tokenLocaleMask: [Int]

  let phraseText: [String]
  let phraseField: [Field]
  let phraseEmoji: [Int32]
  let phraseLength: [Int32]
  /// Bit mask of the packs that contain the phrase for this emoji.
  let phraseLocaleMask: [Int]
  /// Weight of the phrase field, from the first pack that contains the phrase.
  let phraseFieldWeight: [Double]

  var phraseCount: Int { phraseText.count }

  init(packs: [Pack], popularity usePopularity: Bool = true) throws {
    guard let primary = packs.first else { throw EmojisenseError.noPacks }
    primaryLocale = primary.locale
    packVersion = primary.packVersion

    var locales: [String] = []
    var localeMasks: [String: Int] = [:]
    for (packIndex, pack) in packs.enumerated() {
      if !locales.contains(pack.locale) { locales.append(pack.locale) }
      localeMasks[pack.locale, default: 0] |= 1 << packIndex
    }
    self.locales = locales
    self.localeMasks = localeMasks

    var entries: [EmojiEntry] = []
    var entryIndexById: [String: Int] = [:]
    for row in primary.emoji {
      entryIndexById[row.hexcode] = entries.count
      entries.append(
        EmojiEntry(
          emoji: row.emoji, id: row.hexcode,
          group: primary.groups.indices.contains(row.group) ? primary.groups[row.group] : "unknown",
          version: row.version, hasSkinTones: row.hasSkinTones, labels: [:]))
    }

    var phrases = PhraseCollector(emojiCount: entries.count)
    for (packIndex, pack) in packs.enumerated() {
      for row in pack.emoji {
        guard let emojiIndex = entryIndexById[row.hexcode] else { continue }
        if !row.label.isEmpty { entries[emojiIndex].labels[pack.locale] = row.label }
        for field in Field.allCases {
          let value = field == .name ? Normalizer.normalize(row.label) : row.phrases(for: field)
          if value.isEmpty || pack.weight(for: field) <= 0 { continue }
          for phrase in value.splitOnScalar("|", omittingEmpty: true) {
            phrases.add(phrase, emoji: emojiIndex, field: field, packIndex: packIndex)
          }
        }
      }
    }
    self.entries = entries
    self.entryIndexById = entryIndexById
    var entryPopularity = [UInt8](repeating: 0, count: entries.count)
    for pack in usePopularity ? packs : [] {
      for (row, value) in (pack.popularity ?? []).enumerated() where row < pack.emoji.count {
        if let index = entryIndexById[pack.emoji[row].hexcode] {
          entryPopularity[index] = UInt8(clamping: value)
        }
      }
    }
    self.entryPopularity = entryPopularity

    let sorted = phrases.sortedVocabulary()
    vocabulary = sorted.vocabulary
    tokenIds = Dictionary(
      uniqueKeysWithValues: sorted.vocabulary.enumerated().map { ($1, Int32($0)) })
    tokenIdsByLength = Dictionary(
      grouping: sorted.vocabulary.indices.map(Int32.init),
      by: { sorted.vocabulary[Int($0)].count })
    let phraseTokenIds = phrases.tokenIds.map { ids in ids.map { sorted.rank[Int($0)] } }

    phraseText = phrases.text
    phraseField = phrases.field
    phraseEmoji = phrases.emoji
    phraseLength = phraseTokenIds.map { Int32($0.count) }
    phraseLocaleMask = phrases.localeMask
    phraseFieldWeight = zip(phrases.field, phrases.localeMask).map { field, mask in
      packs[mask.trailingZeroBitCount].weight(for: field)
    }

    (postingStart, postings) = Self.buildPostings(
      phraseTokenIds: phraseTokenIds, vocabularyCount: sorted.vocabulary.count)
    (idf, maxIdf, tokenLocaleMask) = Self.computeIdf(
      postingStart: postingStart, postings: postings, phraseEmoji: phrases.emoji,
      phraseLocaleMask: phrases.localeMask, emojiCount: entries.count)
  }

  /// Token → phrases, in phrase order. A token repeated inside a phrase is posted twice.
  private static func buildPostings(phraseTokenIds: [[Int32]], vocabularyCount: Int)
    -> (start: [Int32], postings: [Int32])
  {
    var start = [Int32](repeating: 0, count: vocabularyCount + 1)
    for ids in phraseTokenIds {
      for id in ids { start[Int(id) + 1] += 1 }
    }
    for index in 1..<start.count { start[index] += start[index - 1] }
    var fill = Array(start.dropLast())
    var postings = [Int32](repeating: 0, count: Int(start[vocabularyCount]))
    for (phrase, ids) in phraseTokenIds.enumerated() {
      for id in ids {
        postings[Int(fill[Int(id)])] = Int32(phrase)
        fill[Int(id)] += 1
      }
    }
    return (start, postings)
  }

  /// `idf = ln(1 + E / df)` with `df` counted over emoji, not phrases, so a token repeated across
  /// one emoji's aliases stays specific. Also the packs whose phrases have each token.
  private static func computeIdf(
    postingStart: [Int32], postings: [Int32], phraseEmoji: [Int32], phraseLocaleMask: [Int],
    emojiCount: Int
  ) -> (idf: [Double], maxIdf: Double, tokenLocaleMask: [Int]) {
    let tokenCount = postingStart.count - 1
    var idf = [Double](repeating: 0, count: tokenCount)
    var tokenLocaleMask = [Int](repeating: 0, count: tokenCount)
    var lastSeen = [Int](repeating: -1, count: emojiCount)
    var maxIdf = 0.0
    for token in 0..<tokenCount {
      var documentFrequency = 0
      var mask = 0
      for posting in Int(postingStart[token])..<Int(postingStart[token + 1]) {
        let phrase = Int(postings[posting])
        mask |= phraseLocaleMask[phrase]
        let emoji = Int(phraseEmoji[phrase])
        if lastSeen[emoji] != token {
          lastSeen[emoji] = token
          documentFrequency += 1
        }
      }
      tokenLocaleMask[token] = mask
      idf[token] = ReferenceMath.log(1 + Double(emojiCount) / Double(documentFrequency))
      if idf[token] > maxIdf { maxIdf = idf[token] }
    }
    return (idf, maxIdf, tokenLocaleMask)
  }
}

/// Pass 1 of the index build: phrases deduplicated per emoji. The first pack that has a phrase
/// decides its field; later packs only add their locale bit.
private struct PhraseCollector {
  var text: [String] = []
  var field: [Field] = []
  var emoji: [Int32] = []
  var localeMask: [Int] = []
  /// Provisional token ids (first-seen order); remapped to sorted order later.
  var tokenIds: [[Int32]] = []

  private var seenByEmoji: [[UTF16Text: Int]]
  private var provisionalIds: [UTF16Text: Int32] = [:]
  private var provisionalTokens: [UTF16Text] = []

  init(emojiCount: Int) {
    seenByEmoji = Array(repeating: [:], count: emojiCount)
  }

  mutating func add(_ phrase: String, emoji emojiIndex: Int, field: Field, packIndex: Int) {
    let key = UTF16Text(phrase.utf16)
    if let existing = seenByEmoji[emojiIndex][key] {
      localeMask[existing] |= 1 << packIndex
      return
    }
    seenByEmoji[emojiIndex][key] = text.count
    text.append(phrase)
    self.field.append(field)
    emoji.append(Int32(emojiIndex))
    localeMask.append(1 << packIndex)
    var ids: [Int32] = []
    for token in Normalizer.tokenize(phrase) { ids.append(intern(UTF16Text(token.utf16))) }
    tokenIds.append(ids)
  }

  private mutating func intern(_ token: UTF16Text) -> Int32 {
    if let id = provisionalIds[token] { return id }
    let id = Int32(provisionalTokens.count)
    provisionalIds[token] = id
    provisionalTokens.append(token)
    return id
  }

  /// The vocabulary in JavaScript's default sort order (UTF-16 code units), and the sorted
  /// position of each provisional id.
  func sortedVocabulary() -> (vocabulary: [UTF16Text], rank: [Int32]) {
    let tokens = provisionalTokens
    let order = tokens.indices.sorted { tokens[$0].lexicographicallyPrecedes(tokens[$1]) }
    var rank = [Int32](repeating: 0, count: tokens.count)
    for (position, provisional) in order.enumerated() { rank[provisional] = Int32(position) }
    return (order.map { tokens[$0] }, rank)
  }
}
