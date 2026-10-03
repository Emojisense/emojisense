import Foundation

/// Culture layer: editorial associations that add emoji next to the canonical answer ("greatest
/// of all time" keeps 🐐 first and also shows ⚽ 🇦🇷 🇵🇹). PACK_FORMAT.md §9; a port of
/// packages/core/src/culture.ts.
///
/// Strings are compared by UTF-16 code units, as the reference compares them.
///
/// A `day` is "YYYY-MM-DD" and wins over `now`. Another `day` value is a programming error: the
/// functions stop with a precondition failure. Check a value first with
/// ``scopeDay(day:now:)``, which throws instead.
public enum CultureLayer {
  /// The `region` value for the device's region (``deviceRegion(zones:locale:timeZone:)``); also
  /// what `nil` means in ``resolveRegion(_:culture:)``.
  public static let deviceRegionValue = "device"

  /// Longest message (UTF-16 units) that ``matchCultureInText(_:text:region:now:day:limit:)``
  /// reads, as the reactions API.
  static let maxTextLength = 256
  /// A typed prefix completes a trigger only when it is this long and covers half of the trigger.
  static let minPrefixLength = 3

  // MARK: Files

  /// Fetches one locale's culture file, `<baseURL>/culture.<locale>.json`, e.g. from
  /// `https://api.emojisense.com/v1/culture/0.1.0` (``cultureURL(forPackURL:)``). It holds the
  /// windows of the next 12 months and changes only when a deploy brings new entries: cache it for
  /// an hour, not forever.
  ///
  /// Throws ``EmojisenseError/invalidLocale(_:)`` before any request when `locale` is not a plain
  /// locale tag ("en", "pt-BR"), and ``EmojisenseError/httpStatus(_:url:)`` for HTTP errors.
  public static func loadCulture(
    baseURL: URL, locale: String, transport: any HTTPTransport = URLSessionTransport()
  ) async throws -> Culture {
    guard isLocaleTag(locale) else { throw EmojisenseError.invalidLocale(locale) }
    let file = URLEncoding.uriComponent("culture.\(locale).json")
    let url = try URLEncoding.url("\(URLEncoding.trimmingTrailingSlashes(baseURL))/\(file)")
    let response = try await transport.get(url)
    guard response.isSuccess else { throw EmojisenseError.httpStatus(response.status, url: url) }
    return try Culture(jsonData: response.body)
  }

  /// The culture directory next to a pack directory on the same host:
  /// `.../v1/pack/0.1.0` → `.../v1/culture/0.1.0`. `nil` when the URL does not end in
  /// `pack/<version>`.
  public static func cultureURL(forPackURL packURL: URL) -> URL? {
    // The reference: /^(.*\/)pack\/([^/?#]+)\/*$/ on the URL string.
    var units = Array(packURL.absoluteString.utf16)
    let slash = codeUnit("/")
    while units.last == slash { units.removeLast() }
    guard let versionStart = units.lastIndex(of: slash).map({ $0 + 1 }) else { return nil }
    let version = units[versionStart...]
    let head = units[..<versionStart]
    let packDirectory = Array("/pack/".utf16)
    guard !version.isEmpty, !version.contains(codeUnit("?")),
      !version.contains(codeUnit("#")), head.count >= packDirectory.count,
      head.suffix(packDirectory.count).elementsEqual(packDirectory)
    else { return nil }
    let base = head.dropLast(packDirectory.count - 1)
    return URL(
      string: String(decoding: base, as: UTF16.self) + "culture/"
        + String(decoding: version, as: UTF16.self))
  }

  /// A BCP 47-style locale tag, `^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$`: nothing that can change
  /// a URL path.
  static func isLocaleTag(_ value: String) -> Bool {
    let parts = value.utf8.split(separator: UInt8(ascii: "-"), omittingEmptySubsequences: false)
    guard let language = parts.first, parts.count <= 3, (2...3).contains(language.count),
      language.allSatisfy({ (UInt8(ascii: "a")...UInt8(ascii: "z")).contains($0) })
    else { return false }
    return parts.dropFirst().allSatisfy { part in
      (2...8).contains(part.count) && part.allSatisfy(isASCIIAlphanumeric)
    }
  }

  // MARK: Regions

  /// The ISO 3166-1 alpha-2 region of a BCP 47 locale tag: "pt-BR" → "BR", "zh-Hant-TW" → "TW".
  /// `nil` when the tag has no such region ("en", "es-419") or is not a well-formed tag.
  public static func regionOf(_ locale: String) -> String? {
    LanguageTag.region(of: locale).flatMap { isISORegion($0) ? $0 : nil }
  }

  /// The device's region, the default region for culture entries when an app gives none: the
  /// region of `locale` (the user's region setting), else the region of `timeZone` in `zones` (a
  /// culture file's ``Culture/zones``: "Asia/Tokyo" → "JP"). It is read on the device and never
  /// sent anywhere.
  public static func deviceRegion(
    zones: [String: String]? = nil, locale: Locale = .current, timeZone: TimeZone = .current
  ) -> String? {
    if let region = locale.region?.identifier, isISORegion(region) { return region }
    return zones?[timeZone.identifier]
  }

  /// The region that an app's `region` option stands for: `nil` or "device" → the device's region
  /// (``deviceRegion(zones:locale:timeZone:)`` with the culture file's time zones), "" → none
  /// (only the entries for every region), anything else as given: a code, or "auto", which a
  /// ``SearchSession`` learns from the API.
  public static func resolveRegion(_ region: String?, culture: Culture? = nil) -> String? {
    guard let region, region.lowercased() != deviceRegionValue else {
      return deviceRegion(zones: culture?.zones)
    }
    return region.isEmpty ? nil : region
  }

  // MARK: Days

  /// The local calendar day of `now` as "YYYY-MM-DD", in the Gregorian calendar and the device's
  /// time zone (whatever calendar the user picked).
  public static func localDay(now: Date = Date()) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    let parts = calendar.dateComponents([.year, .month, .day], from: now)
    let pad = { (value: Int?) in
      let text = String(value ?? 0)
      return text.count < 2 ? "0" + text : text
    }
    return "\(parts.year ?? 0)-\(pad(parts.month))-\(pad(parts.day))"
  }

  /// The day windows are checked against: `day` when given (it must be "YYYY-MM-DD"), else the
  /// local calendar day of `now` (default: now). Throws ``EmojisenseError/invalidData(_:)`` for
  /// another `day`.
  public static func scopeDay(day: String? = nil, now: Date? = nil) throws -> String {
    guard let day else { return localDay(now: now ?? Date()) }
    guard isDay(day) else {
      throw EmojisenseError.invalidData("culture day must be YYYY-MM-DD, got \"\(day)\"")
    }
    return day
  }

  /// Is a window active on `day` ("YYYY-MM-DD")? `nil` = always. Yearly windows may wrap the year
  /// end (12-26 → 01-02).
  public static func isActiveOn(_ when: CultureWindow?, day: String) -> Bool {
    guard let when else { return true }
    let (from, to) = (when.from.utf16, when.to.utf16)
    if !when.isYearly {
      return precedesOrEquals(from, day.utf16) && precedesOrEquals(day.utf16, to)
    }
    let monthDay = day.utf16.dropFirst(5)
    return precedesOrEquals(from, to)
      ? precedesOrEquals(from, monthDay) && precedesOrEquals(monthDay, to)
      : precedesOrEquals(from, monthDay) || precedesOrEquals(monthDay, to)
  }

  // MARK: Matching

  /// Culture results for a query (active window and region only), best per emoji, strongest
  /// first, at most `limit`. An exact trigger scores the entry's weights; while the user types
  /// (`prefix`, and no whitespace at the end), a prefix of at least 3 code units that covers half
  /// of a trigger scores less. Without a `region`, only the entries for every region apply.
  public static func matchCulture(
    _ culture: Culture, query: String, region: String? = nil, now: Date? = nil,
    day: String? = nil, prefix: Bool = true, limit: Int = 5
  ) -> [CultureResult] {
    let normalized = Normalizer.normalize(query)
    if normalized.isEmpty { return [] }
    let typing = prefix && !JavaScriptWhitespace.endsWithWhitespace(query)
    let units = Array(normalized.utf16)
    return collectMatches(culture, region: region, day: resolvedDay(day, now), limit: limit) {
      _, trigger in triggerQuality(trigger, query: units, typing: typing)
    }
  }

  /// Culture results for a whole message (reaction suggestions): every in-scope entry with a
  /// trigger inside the text as whole words ("thanks so much!" holds "thanks"). A trigger of a
  /// script written without spaces (Han, kana, Thai) matches anywhere in the text. Strongest
  /// first.
  public static func matchCultureInText(
    _ culture: Culture, text: String, region: String? = nil, now: Date? = nil,
    day: String? = nil, limit: Int = 5
  ) -> [CultureResult] {
    let normalized = Normalizer.normalize(text, maxLength: maxTextLength)
    if normalized.isEmpty { return [] }
    let space = codeUnit(" ")
    let units = Array(normalized.utf16)
    let padded = [space] + units + [space]
    return collectMatches(culture, region: region, day: resolvedDay(day, now), limit: limit) {
      triggerText, trigger in
      let inside =
        UnspacedScript.contains(triggerText)
        ? contains(units, trigger) : contains(padded, [space] + trigger + [space])
      return inside ? 1 : 0
    }
  }

  /// The regional sense that leads the list, if any. All of these must hold:
  /// - the entry is ``CultureKind/regional`` and the app named a region in its scope (no region,
  ///   no lead);
  /// - the normalized query equals one of its triggers (a prefix being typed is not enough);
  /// - the canonical top result is one of its `outranks` hexcodes, the reading the editor saw.
  ///
  /// The lead is the entry's strongest emoji. When several entries qualify, the strongest wins.
  public static func matchRegionalLead(
    _ culture: Culture, query: String, canonicalTopId: String?, region: String? = nil,
    now: Date? = nil, day: String? = nil
  ) -> CultureResult? {
    guard let region, !region.isEmpty, let canonicalTopId else { return nil }
    let normalized = Normalizer.normalize(query)
    let day = resolvedDay(day, now)
    var lead: CultureResult?
    for entry in culture.entries {
      guard entry.kind == .regional, includes(entry.outranks, canonicalTopId),
        includes(entry.triggers, normalized), inScope(entry, region: region, day: day)
      else { continue }
      var strongest: CultureEmoji?
      for item in entry.emoji where item.weight > strongest?.weight ?? -.infinity {
        strongest = item
      }
      guard let strongest, !same(strongest.hexcode, canonicalTopId),
        lead.map({ $0.score < strongest.weight }) ?? true
      else { continue }
      lead = CultureResult(
        emoji: strongest.emoji, id: strongest.hexcode, score: strongest.weight,
        context: entry.context, cultureId: entry.id, match: normalized)
    }
    return lead
  }

  /// Adds culture results right after the canonical top result. They never go above it, unless
  /// the canonical list is empty or a regional `lead`
  /// (``matchRegionalLead(_:query:canonicalTopId:region:now:day:)``) is given: the lead goes first
  /// and the canonical top result second. An emoji that is already lower in the list moves up and
  /// carries its cultural context. `limit` defaults to the length of both lists plus one.
  public static func insertCulture<Element: CultureInsertable>(
    _ results: [Element], matches: [CultureResult], limit: Int? = nil,
    lead: CultureResult? = nil
  ) -> [Element] {
    let limit = max(0, limit ?? results.count + matches.count + 1)
    guard let top = results.first else {
      return matches.prefix(limit).map(Element.init(culture:))
    }
    let head = lead.flatMap { $0.id == top.id ? nil : [Element(culture: $0), top] } ?? [top]
    var ids = Set(head.map(\.id))
    let added = matches.filter { !ids.contains($0.id) }
    for match in added { ids.insert(match.id) }
    let rest = results.dropFirst().filter { !ids.contains($0.id) }
    return Array((head + added.map(Element.init(culture:)) + rest).prefix(limit))
  }

  /// ``matchCulture(_:query:region:now:day:prefix:limit:)`` (or, with `text`,
  /// ``matchCultureInText(_:text:region:now:day:limit:)``, and then no regional lead),
  /// ``matchRegionalLead(_:query:canonicalTopId:region:now:day:)`` and
  /// ``insertCulture(_:matches:limit:lead:)`` in one step. With an `engine`, only the emoji it
  /// knows are added, with its glyph and its label in `locale` (else English, else its first
  /// locale).
  public static func applyCulture<Element: CultureInsertable>(
    _ results: [Element], culture: Culture, query: String, region: String? = nil,
    now: Date? = nil, day: String? = nil, prefix: Bool = true, text: Bool = false,
    limit: Int? = nil, engine: AliasEngine? = nil, locale: String? = nil
  ) -> [Element] {
    func labeled(_ match: CultureResult) -> CultureResult? {
      guard let engine else { return match }
      guard let entry = engine.entry(id: match.id) else { return nil }
      var labeled = match
      labeled.emoji = entry.emoji
      labeled.label =
        entry.labels[locale ?? ""] ?? entry.labels["en"]
        ?? engine.locales.lazy.compactMap { entry.labels[$0] }.first ?? ""
      return labeled
    }
    let day = resolvedDay(day, now)
    let matches =
      text
      ? matchCultureInText(culture, text: query, region: region, day: day)
      : matchCulture(culture, query: query, region: region, day: day, prefix: prefix)
    let lead =
      text
      ? nil
      : matchRegionalLead(
        culture, query: query, canonicalTopId: results.first?.id, region: region, day: day)
    return insertCulture(
      results, matches: matches.compactMap(labeled), limit: limit, lead: lead.flatMap(labeled))
  }

  /// Emoji for an optional "relevant now" shelf: featured seasonal and event entries that are
  /// active today, one emoji per entry in turn (so two festivals share the shelf), in file order.
  /// `locale` picks the file of that locale; without it, the first file.
  public static func relevantNow(
    _ cultures: [Culture], locale: String? = nil, region: String? = nil, now: Date? = nil,
    day: String? = nil, limit: Int = 8
  ) -> [RelevantEmoji] {
    let file =
      if let locale, !locale.isEmpty {
        cultures.first { $0.locale == locale }
      } else {
        cultures.first
      }
    guard let file else { return [] }
    let day = resolvedDay(day, now)
    let entries = file.entries.filter { entry in
      entry.featured && (entry.kind == .seasonal || entry.kind == .event)
        && inScope(entry, region: region, day: day)
    }
    var shelf: [RelevantEmoji] = []
    var seen: Set<String> = []
    let depth = entries.map(\.emoji.count).max() ?? 0
    var position = 0
    while position < depth && shelf.count < limit {
      for entry in entries where position < entry.emoji.count {
        let item = entry.emoji[position]
        guard seen.insert(item.hexcode).inserted else { continue }
        shelf.append(
          RelevantEmoji(
            emoji: item.emoji, hexcode: item.hexcode, context: entry.context, cultureId: entry.id))
        if shelf.count == limit { break }
      }
      position += 1
    }
    return shelf
  }

  public static func relevantNow(
    _ culture: Culture, region: String? = nil, now: Date? = nil, day: String? = nil,
    limit: Int = 8
  ) -> [RelevantEmoji] {
    relevantNow([culture], region: region, now: now, day: day, limit: limit)
  }

  // MARK: Helpers

  /// In-scope entries whose best trigger has a quality above 0 (the longest trigger wins a tie),
  /// as culture results, best per emoji, strongest first. Equal scores keep the order in which
  /// the emoji first appeared (a JavaScript `Map` and a stable sort in the reference).
  private static func collectMatches(
    _ culture: Culture, region: String?, day: String, limit: Int,
    quality qualityOf: (String, [UInt16]) -> Double
  ) -> [CultureResult] {
    var best: [CultureResult] = []
    var positionById: [String: Int] = [:]
    for entry in culture.entries where inScope(entry, region: region, day: day) {
      var quality = 0.0
      var match = ""
      var matchLength = 0
      for trigger in entry.triggers {
        let units = Array(trigger.utf16)
        let value = qualityOf(trigger, units)
        if value > quality || (value > 0 && value == quality && units.count > matchLength) {
          (quality, match, matchLength) = (value, trigger, units.count)
        }
      }
      if quality == 0 { continue }
      for item in entry.emoji {
        let score = (item.weight * quality * 1000).rounded() / 1000
        let position = positionById[item.hexcode]
        if score <= position.map({ best[$0].score }) ?? 0 { continue }
        let result = CultureResult(
          emoji: item.emoji, id: item.hexcode, score: score, context: entry.context,
          cultureId: entry.id, match: match)
        if let position {
          best[position] = result
        } else {
          positionById[item.hexcode] = best.count
          best.append(result)
        }
      }
    }
    return best.indices
      .sorted { best[$0].score != best[$1].score ? best[$0].score > best[$1].score : $0 < $1 }
      .prefix(max(0, limit))
      .map { best[$0] }
  }

  /// How well a normalized query hits a trigger: 1 exact, < 1 a prefix being typed, 0 no match.
  private static func triggerQuality(_ trigger: [UInt16], query: [UInt16], typing: Bool)
    -> Double
  {
    if trigger == query { return 1 }
    if typing && query.count >= minPrefixLength && 2 * query.count >= trigger.count
      && trigger.starts(with: query)
    {
      return 0.6 + (0.4 * Double(query.count)) / Double(trigger.count)
    }
    return 0
  }

  private static func inScope(_ entry: CultureEntry, region: String?, day: String) -> Bool {
    let code = region?.uppercased()
    let listed = includes(entry.regions, "*") || code.map { includes(entry.regions, $0) } ?? false
    let excepted = code.map { includes(entry.exceptRegions, $0) } ?? false
    return listed && !excepted && isActiveOn(entry.when, day: day)
  }

  private static func resolvedDay(_ day: String?, _ now: Date?) -> String {
    do {
      return try scopeDay(day: day, now: now)
    } catch {
      preconditionFailure("\(error)")
    }
  }

  private static func isDay(_ value: String) -> Bool {
    let units = Array(value.utf16)
    guard units.count == 10 else { return false }
    return units.indices.allSatisfy { position in
      position == 4 || position == 7
        ? units[position] == codeUnit("-")
        : (codeUnit("0")...codeUnit("9")).contains(units[position])
    }
  }

  private static func isISORegion(_ value: String) -> Bool {
    value.utf8.count == 2
      && value.utf8.allSatisfy { (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains($0) }
  }

  private static func isASCIIAlphanumeric(_ byte: UInt8) -> Bool {
    (UInt8(ascii: "a")...UInt8(ascii: "z")).contains(byte)
      || (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains(byte)
      || (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte)
  }

  private static func codeUnit(_ scalar: Unicode.Scalar) -> UInt16 {
    UInt16(scalar.value)
  }

  private static func same(_ left: String, _ right: String) -> Bool {
    left.utf16.elementsEqual(right.utf16)
  }

  private static func includes(_ list: [String], _ value: String) -> Bool {
    list.contains { same($0, value) }
  }

  /// JavaScript `<=` on strings: UTF-16 code-unit order.
  private static func precedesOrEquals<Left: Sequence<UInt16>, Right: Sequence<UInt16>>(
    _ left: Left, _ right: Right
  ) -> Bool {
    !right.lexicographicallyPrecedes(left)
  }

  /// JavaScript `String.prototype.includes` on UTF-16 code units.
  private static func contains(_ text: [UInt16], _ part: [UInt16]) -> Bool {
    if part.isEmpty { return true }
    guard part.count <= text.count else { return false }
    return (0...(text.count - part.count)).contains { start in
      text[start..<start + part.count].elementsEqual(part)
    }
  }
}

/// The region subtag of a BCP 47 language tag, parsed like `Intl.Locale` (well-formed tags only).
enum LanguageTag {
  /// The region subtag, uppercase, or `nil` when there is none or the tag is not well formed.
  static func region(of tag: String) -> String? {
    let subtags = tag.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
    guard let language = subtags.first,
      isAlpha(language)
        && ((2...3).contains(language.utf8.count) || (5...8).contains(language.utf8.count))
    else { return nil }
    var position = 1
    if position < subtags.count, isAlpha(subtags[position]), subtags[position].utf8.count == 4 {
      position += 1
    }
    var region: String?
    if position < subtags.count, isRegion(subtags[position]) {
      region = subtags[position].uppercased()
      position += 1
    }
    while position < subtags.count, isVariant(subtags[position]) { position += 1 }
    // Extensions ("u-ca-gregory") and private use ("x-…"): a singleton, then one or more subtags.
    while position < subtags.count {
      let singleton = subtags[position]
      guard singleton.utf8.count == 1, isAlphanumeric(singleton) else { return nil }
      position += 1
      let lengths = singleton.lowercased() == "x" ? 1...8 : 2...8
      let start = position
      while position < subtags.count, isAlphanumeric(subtags[position]),
        lengths.contains(subtags[position].utf8.count)
      {
        position += 1
      }
      if position == start { return nil }
    }
    return region
  }

  private static func isRegion(_ subtag: String) -> Bool {
    (subtag.utf8.count == 2 && isAlpha(subtag)) || (subtag.utf8.count == 3 && isDigits(subtag))
  }

  private static func isVariant(_ subtag: String) -> Bool {
    guard isAlphanumeric(subtag) else { return false }
    let count = subtag.utf8.count
    return (5...8).contains(count) || (count == 4 && isDigits(String(subtag.prefix(1))))
  }

  private static func isAlpha(_ text: String) -> Bool {
    !text.isEmpty
      && text.utf8.allSatisfy {
        ($0 | 0x20) >= UInt8(ascii: "a") && ($0 | 0x20) <= UInt8(ascii: "z")
      }
  }

  private static func isDigits(_ text: String) -> Bool {
    !text.isEmpty && text.utf8.allSatisfy { $0 >= UInt8(ascii: "0") && $0 <= UInt8(ascii: "9") }
  }

  private static func isAlphanumeric(_ text: String) -> Bool {
    !text.isEmpty
      && text.utf8.allSatisfy { byte in
        (byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "9"))
          || ((byte | 0x20) >= UInt8(ascii: "a") && (byte | 0x20) <= UInt8(ascii: "z"))
      }
  }
}
