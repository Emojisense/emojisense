import Foundation

public struct AliasSearchOptions: Sendable {
  /// Maximum number of results. Default 24.
  public var limit: Int
  /// Preferred locale. Matches that exist only in other loaded packs get a small penalty.
  public var locale: String?
  /// Treat the last token as a prefix while the user is still typing. Default true.
  public var prefix: Bool

  public init(limit: Int = 24, locale: String? = nil, prefix: Bool = true) {
    self.limit = limit
    self.locale = locale
    self.prefix = prefix
  }
}

/// Tier 0: offline alias search over one or more packs (PACK_FORMAT.md §4).
///
/// A port of `createEngine` in `packages/core/src/engine.ts` that gives the same ranking and the
/// same scores. Searching is thread-safe: concurrent calls share scratch buffers and run one at a
/// time, so a keystroke never allocates per-phrase state.
public final class AliasEngine: @unchecked Sendable {
  public static let defaultMinCoverage = 0.34

  public var entries: [EmojiEntry] { index.entries }
  public var locales: [String] { index.locales }
  public var packVersion: String { index.packVersion }

  private let index: AliasIndex
  private let minCoverage: Double
  private let lock = NSLock()
  /// Guarded by `lock`.
  private var scratch: SearchScratch

  /// Builds the index from packs in index order: the first pack is the primary one.
  public init(packs: [Pack], minCoverage: Double = defaultMinCoverage) throws {
    index = try AliasIndex(packs: packs)
    self.minCoverage = minCoverage
    scratch = SearchScratch(phraseCount: index.phraseCount, emojiCount: index.entries.count)
  }

  /// Builds the index in the order PACK_FORMAT.md §2 prescribes: every core part first
  /// (English first), then the extension parts.
  public convenience init(
    core: [Pack], extensions: [Pack] = [], minCoverage: Double = defaultMinCoverage
  ) throws {
    try self.init(packs: core + extensions, minCoverage: minCoverage)
  }

  public func entry(id: String) -> EmojiEntry? {
    index.entryIndexById[id].map { index.entries[$0] }
  }

  public func search(_ query: String, options: AliasSearchOptions = AliasSearchOptions())
    -> AliasSearchOutput
  {
    let normalized = Normalizer.normalize(query)
    let lastIsPrefix = options.prefix && !JavaScriptWhitespace.endsWithWhitespace(query)
    let tokens = queryTokens(normalized, lastIsPrefix: lastIsPrefix)
    if tokens.isEmpty {
      return AliasSearchOutput(query: normalized, tokens: tokens, results: [], confidence: 0)
    }

    lock.lock()
    defer { lock.unlock() }
    let ranked = rank(tokens: tokens, lastIsPrefix: lastIsPrefix, options: options)
    let results = ranked.prefix(max(0, options.limit)).map { candidate in
      makeResult(candidate, locale: options.locale)
    }
    return AliasSearchOutput(
      query: normalized, tokens: tokens, results: results, confidence: results.first?.score ?? 0)
  }

  // MARK: Ranking

  private struct RankedEmoji {
    let emoji: Int32
    let phrase: Int32
    var score: Double
  }

  /// Scores every phrase the query touches and keeps the best phrase per emoji. Caller holds
  /// `lock`.
  private func rank(tokens: [String], lastIsPrefix: Bool, options: AliasSearchOptions)
    -> [RankedEmoji]
  {
    let tokenCount = tokens.count
    let preferredMask = index.localeMasks[options.locale ?? index.primaryLocale] ?? 1
    let isPreferred = { (phrase: Int32) in
      self.index.phraseLocaleMask[Int(phrase)] & preferredMask != 0
    }
    scratch.startSearch()

    var weights: [Double] = []
    for (position, token) in tokens.enumerated() {
      let asPrefix = lastIsPrefix && position == tokenCount - 1
      let candidates = expand(token, asPrefix: asPrefix)
      var bestQuality = 0.0
      var weight = index.maxIdf
      for (id, quality) in zip(candidates.ids, candidates.qualities) {
        if quality > bestQuality {
          bestQuality = quality
          weight = index.idf[Int(id)]
        }
        for posting in Int(index.postingStart[Int(id)])..<Int(index.postingStart[Int(id) + 1]) {
          scratch.record(
            quality: quality, phrase: Int(index.postings[posting]), token: position,
            tokenCount: tokenCount)
        }
      }
      weights.append(
        Scoring.stopwords.contains(token) ? min(weight, Scoring.stopwordWeightCap) : weight)
    }
    let totalWeight = weights.reduce(0, +)

    for phrase in scratch.touchedPhrases {
      let qualities = scratch.qualities(phrase: Int(phrase), tokenCount: tokenCount)
      var covered = 0.0
      var matched = 0
      var allExact = true
      for (quality, weight) in zip(qualities, weights) {
        let value = Double(quality)
        if value > 0 { matched += 1 }
        if value != 1 { allExact = false }
        covered += value * weight
      }
      let coverage = covered / totalWeight
      if coverage < minCoverage { continue }

      let length = Int(index.phraseLength[Int(phrase)])
      let exact = allExact && length == tokenCount
      let exactFactor =
        exact ? (tokenCount >= 2 ? Scoring.exactPhraseBonus : 1) : Scoring.nonExactFactor
      let preferred = isPreferred(phrase)
      let localeFactor = preferred ? 1 : Scoring.foreignLocaleFactor
      let score =
        index.phraseFieldWeight[Int(phrase)] * coverage
        * (0.6 + 0.4 * min(1, Double(matched) / Double(length))) * exactFactor * localeFactor
      scratch.recordEmoji(
        Int(index.phraseEmoji[Int(phrase)]), phrase: phrase, score: score, preferred: preferred,
        exact: exact, strong: Scoring.strongFields.contains(index.phraseField[Int(phrase)]))
    }

    // Only phrases of the preferred locale add evidence (PACK_FORMAT.md §4).
    var ranked = scratch.touchedEmoji.map { emoji in
      let best = scratch.emojiPhrase[Int(emoji)]
      let support = Int(scratch.emojiPreferred[Int(emoji)]) - (isPreferred(best) ? 1 : 0)
      let bonus = min(Scoring.maxEvidenceBonus, Double(support) * Scoring.evidenceBonus)
      return RankedEmoji(
        emoji: emoji, phrase: best, score: min(1, scratch.emojiScore[Int(emoji)] + bonus))
    }
    // An exact name, shortcode, keyword or alias match in a preferred-locale pack beats an exact
    // name or shortcode match that only another pack has (PACK_FORMAT.md §4): such a
    // foreign-only match is capped just below the best preferred one.
    let topExactPreferred = ranked.reduce(0.0) { top, candidate in
      scratch.emojiExactPreferred[Int(candidate.emoji)] ? max(top, candidate.score) : top
    }
    if topExactPreferred > 0 {
      for position in ranked.indices {
        let emoji = Int(ranked[position].emoji)
        let phrase = ranked[position].phrase
        if !scratch.emojiExactPreferred[emoji] && scratch.emojiBestExact[emoji]
          && Scoring.dominantFields.contains(index.phraseField[Int(phrase)])
          && !isPreferred(phrase)
        {
          ranked[position].score = min(
            ranked[position].score, topExactPreferred - Scoring.foreignExactMargin)
        }
      }
    }
    ranked.sort { $0.score != $1.score ? $0.score > $1.score : $0.emoji < $1.emoji }
    return ranked
  }

  private func makeResult(_ candidate: RankedEmoji, locale: String?) -> AliasResult {
    let entry = index.entries[Int(candidate.emoji)]
    return AliasResult(
      emoji: entry.emoji, id: entry.id, score: (candidate.score * 1000).rounded() / 1000,
      label: entry.labels[locale ?? ""] ?? entry.labels[index.primaryLocale] ?? "",
      match: index.phraseText[Int(candidate.phrase)],
      field: index.phraseField[Int(candidate.phrase)])
  }

  // MARK: Query tokens

  /// Query tokens (PACK_FORMAT.md §4). A token of an unspaced script that is not in the
  /// vocabulary (and, while typing, is not the start of one) is split into the tokens it holds.
  private func queryTokens(_ normalized: String, lastIsPrefix: Bool) -> [String] {
    let tokens = Array(Normalizer.tokenize(normalized).prefix(Scoring.maxQueryTokens))
    var result: [String] = []
    for (position, token) in tokens.enumerated() {
      let units = UTF16Text(token.utf16)
      if index.tokenIds[units] != nil || !UnspacedScript.contains(token) {
        result.append(token)
      } else if lastIsPrefix && position == tokens.count - 1 && completes(units) {
        result.append(token)
      } else {
        result.append(contentsOf: segment(token))
      }
    }
    return Array(result.prefix(Scoring.maxQueryTokens))
  }

  /// Does a longer vocabulary token start with `prefix`?
  private func completes(_ prefix: UTF16Text) -> Bool {
    let position = lowerBound(prefix)
    return position < index.vocabulary.count && index.vocabulary[position].starts(with: prefix)
  }

  /// Splits a run into vocabulary tokens, longest match first from the left. Code points where no
  /// vocabulary token starts stay together as one unknown piece.
  private func segment(_ run: String) -> [String] {
    let scalars = Array(run.unicodeScalars)
    let text = { (range: Range<Int>) in
      var view = String.UnicodeScalarView()
      view.append(contentsOf: scalars[range])
      return String(view)
    }
    var pieces: [String] = []
    var unknownStart: Int?
    var start = 0
    while start < scalars.count {
      var length = min(Scoring.maxPieceLength, scalars.count - start)
      while length > 0 && index.tokenIds[UTF16Text(text(start..<start + length).utf16)] == nil {
        length -= 1
      }
      if length == 0 {
        unknownStart = unknownStart ?? start
        start += 1
        continue
      }
      if let unknown = unknownStart { pieces.append(text(unknown..<start)) }
      unknownStart = nil
      pieces.append(text(start..<start + length))
      start += length
    }
    if let unknown = unknownStart { pieces.append(text(unknown..<scalars.count)) }
    return pieces
  }

  // MARK: Query expansion

  /// Vocabulary tokens a query token may stand for, with a match quality in (0, 1], in the order
  /// the reference engine finds them (the order breaks ties for the token weight).
  private func expand(_ token: String, asPrefix: Bool) -> CandidateList {
    var candidates = CandidateList()
    let units = UTF16Text(token.utf16)
    let exact = index.tokenIds[units]
    if let exact { candidates.add(exact, quality: 1) }

    var prefixMatches = 0
    if asPrefix {
      let start = lowerBound(units)
      var position = start
      while position < index.vocabulary.count && position < start + Scoring.maxPrefixExpansion {
        let candidate = index.vocabulary[position]
        if !candidate.starts(with: units) { break }
        if candidate.count > units.count {
          candidates.add(
            Int32(position), quality: 0.6 + (0.35 * Double(units.count)) / Double(candidate.count))
          prefixMatches += 1
        }
        position += 1
      }
    }

    // While a word is still being typed and it already completes to real words, it is not a typo.
    guard exact == nil && prefixMatches == 0 else { return candidates }
    if let squeezed = Fuzzy.squeezingRepeatedEnding(units), let id = index.tokenIds[squeezed] {
      candidates.add(id, quality: 0.85)
    }
    let maxEdits = Fuzzy.maxEdits(forLength: units.count)
    // With no edits allowed only an exact match could qualify, and there is none.
    guard maxEdits > 0 else { return candidates }
    for length in (units.count - maxEdits)...(units.count + maxEdits) {
      for id in index.tokenIdsByLength[length] ?? [] {
        let candidate = index.vocabulary[Int(id)]
        guard Fuzzy.isPlausibleTypo(units, candidate) else { continue }
        let distance = scratch.editDistance.compute(units, candidate, max: maxEdits)
        if distance <= maxEdits { candidates.add(id, quality: distance == 1 ? 0.8 : 0.65) }
      }
    }
    return candidates
  }

  /// First vocabulary position whose UTF-16 units are not less than `prefix`.
  private func lowerBound(_ prefix: UTF16Text) -> Int {
    var low = 0
    var high = index.vocabulary.count
    while low < high {
      let middle = (low + high) / 2
      if index.vocabulary[middle].lexicographicallyPrecedes(prefix) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return low
  }
}

/// Constants of the reference algorithm (PACK_FORMAT.md §4).
enum Scoring {
  static let maxQueryTokens = 8
  static let maxPrefixExpansion = 400
  static let nonExactFactor = 0.9
  /// A multi-word query that equals a whole phrase ("ship it") beats one-word name hits ("ship").
  static let exactPhraseBonus = 1.1
  static let foreignLocaleFactor = 0.92
  /// How far below the best preferred-locale exact match a foreign-only exact match is capped.
  static let foreignExactMargin = 0.01
  /// Fields whose exact preferred-locale match outranks a foreign name or shortcode.
  static let strongFields: Set<Field> = [.name, .shortcode, .keyword, .alias]
  /// Fields whose weight beats a preferred alias even after the foreign factor.
  static let dominantFields: Set<Field> = [.name, .shortcode]
  static let evidenceBonus = 0.02
  static let maxEvidenceBonus = 0.06
  static let stopwordWeightCap = 0.3
  /// Longest piece (code points) tried when a run of an unspaced script is split.
  static let maxPieceLength = 16

  /// Function words that carry little meaning in a query (en + folded tr).
  static let stopwords: Set<String> = Set(
    ("a an the of to in on at for from by is are am be im i me my you your u it its this that "
      + "so and or with just very really too we our they them he she his her bir ve ile bu su cok "
      + "da de mi ben sen o icin gibi").split(separator: " ").map(String.init))
}

/// Scripts written without spaces between words: Thai, Lao, Myanmar, Khmer, kana, Han
/// (PACK_FORMAT.md §4, the same ranges as `UNSPACED_SCRIPT` in packages/core/src/engine.ts).
enum UnspacedScript {
  private static let ranges: [ClosedRange<UInt32>] = [
    0x0E00...0x0EFF, 0x1000...0x109F, 0x1780...0x17FF, 0x3040...0x30FF, 0x3400...0x4DBF,
    0x4E00...0x9FFF, 0xF900...0xFAFF, 0x20000...0x3134F,
  ]

  static func contains(_ text: String) -> Bool {
    text.unicodeScalars.contains { scalar in ranges.contains { $0.contains(scalar.value) } }
  }
}

/// Vocabulary candidates of one query token in insertion order; a better quality for a known id
/// updates it in place (JavaScript `Map` semantics).
private struct CandidateList {
  private(set) var ids: [Int32] = []
  private(set) var qualities: [Double] = []
  private var positions: [Int32: Int] = [:]

  mutating func add(_ id: Int32, quality: Double) {
    if let position = positions[id] {
      if quality > qualities[position] { qualities[position] = quality }
      return
    }
    guard quality > 0 else { return }
    positions[id] = ids.count
    ids.append(id)
    qualities.append(quality)
  }
}

/// JavaScript `/\s$/`: the code units of ECMAScript WhiteSpace and LineTerminator.
enum JavaScriptWhitespace {
  private static let units: Set<UInt32> = [
    0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
    0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
  ]

  static func endsWithWhitespace(_ text: String) -> Bool {
    text.unicodeScalars.last.map { units.contains($0.value) } ?? false
  }
}
