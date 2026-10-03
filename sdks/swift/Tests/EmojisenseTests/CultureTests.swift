import Foundation
import XCTest

@testable import Emojisense

/// Fixtures of packages/core/test/culture.test.ts.
enum CultureFixtures {
  static let pack: Pack = {
    var pack = Fixtures.english
    pack.emoji += [
      PackRow(emoji: "⚽", hexcode: "26BD", label: "soccer ball", keyword: "football"),
      PackRow(emoji: "🇦🇷", hexcode: "1F1E6-1F1F7", label: "flag: Argentina"),
      PackRow(emoji: "🇵🇹", hexcode: "1F1F5-1F1F9", label: "flag: Portugal"),
      PackRow(emoji: "👻", hexcode: "1F47B", label: "ghost"),
      PackRow(emoji: "🙇", hexcode: "1F647", label: "person bowing", keyword: "apology|bow"),
      PackRow(emoji: "🏈", hexcode: "1F3C8", label: "american football", shortcode: "football"),
    ]
    return pack
  }()

  static let goat = CultureEntry(
    id: "goat-football", context: "Football's greatest-of-all-time debate",
    triggers: ["goat", "greatest of all time"],
    emoji: [
      CultureEmoji(emoji: "🐐", hexcode: "1F410", weight: 0.7),
      CultureEmoji(emoji: "⚽", hexcode: "26BD", weight: 0.6),
      CultureEmoji(emoji: "🇦🇷", hexcode: "1F1E6-1F1F7", weight: 0.45),
      CultureEmoji(emoji: "🇵🇹", hexcode: "1F1F5-1F1F9", weight: 0.45),
    ])
  static let halloween = CultureEntry(
    id: "halloween", kind: .seasonal, context: "Halloween, 31 October",
    when: CultureWindow(from: "10-15", to: "10-31", recurs: "yearly"),
    triggers: ["halloween", "spooky season"],
    emoji: [
      CultureEmoji(emoji: "🎃", hexcode: "1F383", weight: 0.9),
      CultureEmoji(emoji: "👻", hexcode: "1F47B", weight: 0.8),
    ],
    featured: true)
  static let bowJapan = CultureEntry(
    id: "thanks-bow-jp", context: "Thanks and apologies with a bow, as in Japan", regions: ["JP"],
    triggers: ["thank you"], emoji: [CultureEmoji(emoji: "🙇", hexcode: "1F647", weight: 0.7)])
  static let newYear = CultureEntry(
    id: "new-year", kind: .seasonal, context: "New Year",
    when: CultureWindow(from: "12-26", to: "01-02", recurs: "yearly"), triggers: ["new year"],
    emoji: [
      CultureEmoji(emoji: "🎆", hexcode: "1F386", weight: 0.8),
      CultureEmoji(emoji: "🥂", hexcode: "1F942", weight: 0.7),
    ],
    featured: true)
  static let footballSoccer = CultureEntry(
    id: "football-soccer", kind: .regional,
    context: "Outside North America, football means soccer", regions: ["*"],
    exceptRegions: ["US", "CA"], triggers: ["football"],
    emoji: [CultureEmoji(emoji: "⚽", hexcode: "26BD", weight: 0.9)], outranks: ["1F3C8"])
  static let pantsUK = CultureEntry(
    id: "pants-underwear", kind: .regional, context: "In Britain, pants are underwear",
    regions: ["GB"], triggers: ["pants"],
    emoji: [CultureEmoji(emoji: "👻", hexcode: "1F47B", weight: 0.8)], outranks: ["1F410"])

  static func culture(_ entries: [CultureEntry], locale: String = "en") -> Culture {
    Culture(
      packVersion: "test", locale: locale, from: "2026-10-02", until: "2026-10-16",
      entries: entries)
  }

  /// A moment on a local calendar day, like `new Date(year, month - 1, day, hour, minute)`.
  static func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0)
    -> Date
  {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    return calendar.date(
      from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
  }

  static let october20 = date(2026, 10, 20, 12)
}

/// Ports packages/core/test/culture.test.ts (the session parts are in SearchSessionTests).
final class CultureTests: XCTestCase {
  private typealias F = CultureFixtures

  private func glyphs(_ results: [CultureResult]) -> [String] {
    results.map(\.emoji)
  }

  // MARK: Windows

  func testTreatsLastingEntriesAsAlwaysActive() {
    XCTAssertTrue(CultureLayer.isActiveOn(nil, day: "2026-01-01"))
  }

  func testChecksDatedWindowsInclusively() {
    let window = CultureWindow(from: "2027-01-07", to: "2027-02-05")
    XCTAssertFalse(CultureLayer.isActiveOn(window, day: "2027-01-06"))
    XCTAssertTrue(CultureLayer.isActiveOn(window, day: "2027-01-07"))
    XCTAssertTrue(CultureLayer.isActiveOn(window, day: "2027-02-05"))
    XCTAssertFalse(CultureLayer.isActiveOn(window, day: "2027-02-06"))
  }

  func testRepeatsYearlyWindowsAndWrapsThemAcrossTheYearEnd() {
    let october = CultureWindow(from: "10-15", to: "10-31", recurs: "yearly")
    XCTAssertTrue(CultureLayer.isActiveOn(october, day: "2026-10-31"))
    XCTAssertTrue(CultureLayer.isActiveOn(october, day: "2031-10-15"))
    XCTAssertFalse(CultureLayer.isActiveOn(october, day: "2026-11-01"))
    let newYear = CultureWindow(from: "12-26", to: "01-02", recurs: "yearly")
    XCTAssertFalse(CultureLayer.isActiveOn(newYear, day: "2026-12-25"))
    XCTAssertTrue(CultureLayer.isActiveOn(newYear, day: "2026-12-26"))
    XCTAssertTrue(CultureLayer.isActiveOn(newYear, day: "2026-12-31"))
    XCTAssertTrue(CultureLayer.isActiveOn(newYear, day: "2027-01-01"))
    XCTAssertTrue(CultureLayer.isActiveOn(newYear, day: "2027-01-02"))
    XCTAssertFalse(CultureLayer.isActiveOn(newYear, day: "2027-01-03"))
    XCTAssertFalse(CultureLayer.isActiveOn(newYear, day: "2027-06-15"))
    let crossing = CultureWindow(from: "2027-12-24", to: "2028-01-01")
    XCTAssertTrue(CultureLayer.isActiveOn(crossing, day: "2027-12-31"))
    XCTAssertTrue(CultureLayer.isActiveOn(crossing, day: "2028-01-01"))
    XCTAssertFalse(CultureLayer.isActiveOn(crossing, day: "2026-12-31"))
  }

  func testUsesTheLocalGregorianCalendarDay() {
    XCTAssertEqual(CultureLayer.localDay(now: F.date(2026, 12, 31, 23, 59)), "2026-12-31")
    XCTAssertEqual(CultureLayer.localDay(now: F.date(2027, 1, 1, 0, 1)), "2027-01-01")
  }

  func testHandlesLeapDaysInYearlyAndDatedWindows() {
    XCTAssertEqual(CultureLayer.localDay(now: F.date(2028, 2, 29, 12)), "2028-02-29")
    let aroundMarch = CultureWindow(from: "02-25", to: "03-03", recurs: "yearly")
    XCTAssertTrue(CultureLayer.isActiveOn(aroundMarch, day: "2028-02-29"))
    XCTAssertTrue(CultureLayer.isActiveOn(aroundMarch, day: "2027-02-28"))
    XCTAssertTrue(CultureLayer.isActiveOn(aroundMarch, day: "2027-03-01"))
    let toFebruary28 = CultureWindow(from: "02-20", to: "02-28", recurs: "yearly")
    XCTAssertTrue(CultureLayer.isActiveOn(toFebruary28, day: "2028-02-28"))
    XCTAssertFalse(CultureLayer.isActiveOn(toFebruary28, day: "2028-02-29"))
    let fromMarch = CultureWindow(from: "03-01", to: "03-08", recurs: "yearly")
    XCTAssertFalse(CultureLayer.isActiveOn(fromMarch, day: "2028-02-29"))
    XCTAssertTrue(CultureLayer.isActiveOn(fromMarch, day: "2028-03-01"))
    let leapEvent = CultureWindow(from: "2028-02-28", to: "2028-03-01")
    XCTAssertTrue(CultureLayer.isActiveOn(leapEvent, day: "2028-02-29"))
    XCTAssertFalse(CultureLayer.isActiveOn(leapEvent, day: "2028-03-02"))
  }

  func testChecksAnExplicitDayBeforeNowAndOnlyAYearMonthDayDay() throws {
    XCTAssertEqual(try CultureLayer.scopeDay(now: F.october20), "2026-10-20")
    XCTAssertEqual(try CultureLayer.scopeDay(day: "2026-11-01", now: F.october20), "2026-11-01")
    for day in ["2026-11-1", "2026/11/01", "２０２６-11-01", "2026-11-01\n"] {
      XCTAssertThrowsError(try CultureLayer.scopeDay(day: day), day) { error in
        XCTAssertTrue("\(error)".contains("YYYY-MM-DD"))
      }
    }
    let file = F.culture([F.halloween])
    XCTAssertEqual(
      CultureLayer.matchCulture(file, query: "halloween", now: F.october20, day: "2026-11-01"), [])
    XCTAssertEqual(
      CultureLayer.matchCulture(
        file, query: "halloween", now: F.date(2026, 5, 1), day: "2026-10-31"
      ).count, 2)
  }

  // MARK: One culture file for twelve months

  private static let diwali = CultureEntry(
    id: "diwali-2026", kind: .event, context: "Diwali 2026",
    when: CultureWindow(from: "2026-10-30", to: "2026-11-11"), triggers: ["diwali"],
    emoji: [CultureEmoji(emoji: "🪔", hexcode: "1FA94", weight: 0.9)], featured: true)

  /// Built on 2026-10-02 for 366 days: every yearly entry, the events of the next 12 months, no
  /// snapshot.
  private static let yearFile: Culture = {
    var file = F.culture([diwali, F.halloween, F.newYear, F.goat])
    file.until = "2027-10-03"
    return file
  }()

  private func on(_ now: Date) -> [String] {
    Self.yearFile.entries
      .filter { entry in
        !CultureLayer.matchCulture(
          Self.yearFile, query: entry.triggers.first ?? "", now: now, prefix: false
        ).isEmpty
      }
      .map(\.id)
  }

  private func shelf(_ now: Date) -> [String] {
    var ids: [String] = []
    for item in CultureLayer.relevantNow(Self.yearFile, now: now)
    where !ids.contains(item.cultureId) {
      ids.append(item.cultureId)
    }
    return ids
  }

  func testSwitchesASeasonalEntryOnTheDayItStartsWithTheSameFile() {
    XCTAssertEqual(on(F.date(2026, 10, 14, 12)), ["goat-football"])
    XCTAssertEqual(on(F.date(2026, 10, 15, 12)), ["halloween", "goat-football"])
    XCTAssertEqual(shelf(F.date(2026, 10, 14, 12)), [])
    XCTAssertEqual(shelf(F.date(2026, 10, 15, 12)), ["halloween"])
    XCTAssertEqual(on(F.date(2026, 11, 1, 12)), ["diwali-2026", "goat-football"])
  }

  func testFollowsTheLocalDayNotTheHourAndDropsAnEventTheDayAfterItEnds() {
    XCTAssertFalse(on(F.date(2026, 10, 14, 23)).contains("halloween"))
    XCTAssertTrue(on(F.date(2026, 10, 15, 0, 1)).contains("halloween"))
    XCTAssertTrue(on(F.date(2026, 11, 11, 12)).contains("diwali-2026"))
    XCTAssertEqual(shelf(F.date(2026, 11, 11, 12)), ["diwali-2026"])
    XCTAssertFalse(on(F.date(2026, 11, 12, 12)).contains("diwali-2026"))
    XCTAssertEqual(shelf(F.date(2026, 11, 12, 12)), [])
  }

  func testCrossesTheYearEndAndStartsTheNextSeasonAgain() {
    XCTAssertEqual(on(F.date(2026, 12, 25, 12)), ["goat-football"])
    XCTAssertEqual(on(F.date(2026, 12, 31, 23, 59)), ["new-year", "goat-football"])
    XCTAssertEqual(on(F.date(2027, 1, 2, 12)), ["new-year", "goat-football"])
    XCTAssertEqual(on(F.date(2027, 1, 3, 12)), ["goat-football"])
    XCTAssertEqual(on(F.date(2027, 10, 15, 12)), ["halloween", "goat-football"])
  }

  func testChecksTheWindowsOfAFileBuiltTheOldWayAndIgnoresItsRelevantNowList() {
    var oldStyle = F.culture([F.halloween])
    oldStyle.from = "2026-10-20"
    oldStyle.until = "2026-11-03"
    oldStyle.relevantNow = ["halloween"]
    XCTAssertEqual(CultureLayer.relevantNow(oldStyle, now: F.date(2026, 10, 20, 12)).count, 2)
    XCTAssertEqual(CultureLayer.relevantNow(oldStyle, now: F.date(2026, 11, 5, 12)), [])
  }

  // MARK: matchCulture

  func testMatchesExactTriggersOnTheNormalizedQuery() throws {
    let results = CultureLayer.matchCulture(F.culture([F.goat]), query: "  Greatest of ALL time! ")
    XCTAssertEqual(glyphs(results), ["🐐", "⚽", "🇦🇷", "🇵🇹"])
    let first = try XCTUnwrap(results.first)
    XCTAssertEqual(first.source, .culture)
    XCTAssertEqual(first.cultureId, "goat-football")
    XCTAssertEqual(first.context, "Football's greatest-of-all-time debate")
    XCTAssertEqual(first.match, "greatest of all time")
    XCTAssertEqual(first.score, 0.7)
  }

  func testCompletesATriggerWhileTypingButNotFromShortOrTinyPrefixes() {
    let file = F.culture([F.halloween])
    let atHalloween = { (query: String, prefix: Bool) in
      CultureLayer.matchCulture(file, query: query, now: F.october20, prefix: prefix)
    }
    XCTAssertEqual(glyphs(atHalloween("hallo", true)), ["🎃", "👻"])
    XCTAssertLessThan(atHalloween("hallo", true).first?.score ?? 1, 0.9)
    XCTAssertEqual(atHalloween("hal", true), [])
    XCTAssertEqual(CultureLayer.matchCulture(F.culture([F.goat]), query: "go"), [])
    XCTAssertEqual(atHalloween("hallo ", true), [])
    XCTAssertEqual(atHalloween("hallo\u{3000}", true), [])
    XCTAssertEqual(atHalloween("hallo", false), [])
  }

  func testAppliesSeasonalEntriesOnlyInsideTheirWindow() {
    let halloween = F.culture([F.halloween])
    XCTAssertEqual(
      CultureLayer.matchCulture(halloween, query: "halloween", now: F.date(2026, 10, 1)), [])
    XCTAssertEqual(
      CultureLayer.matchCulture(halloween, query: "halloween", now: F.october20).count, 2)
    XCTAssertEqual(
      CultureLayer.matchCulture(
        F.culture([F.newYear]), query: "new year", now: F.date(2027, 1, 1, 10)
      ).count, 2)
  }

  func testAppliesRegionalEntriesOnlyWithAMatchingRegion() {
    let file = F.culture([F.bowJapan])
    XCTAssertEqual(CultureLayer.matchCulture(file, query: "thank you"), [])
    XCTAssertEqual(CultureLayer.matchCulture(file, query: "thank you", region: ""), [])
    XCTAssertEqual(CultureLayer.matchCulture(file, query: "thank you", region: "US"), [])
    XCTAssertEqual(
      glyphs(CultureLayer.matchCulture(file, query: "thank you", region: "jp")), ["🙇"])
  }

  func testKeepsTheStrongestEntryPerEmojiAndCapsTheCount() {
    let other = CultureEntry(
      id: "a", triggers: ["goat"], emoji: [CultureEmoji(emoji: "⚽", hexcode: "26BD", weight: 0.9)])
    let results = CultureLayer.matchCulture(F.culture([F.goat, other]), query: "goat", limit: 2)
    XCTAssertEqual(results.map(\.emoji), ["⚽", "🐐"])
    XCTAssertEqual(results.map(\.cultureId), ["a", "goat-football"])
  }

  func testKeepsTheFirstSeenOrderForEqualScores() {
    let results = CultureLayer.matchCulture(F.culture([F.goat]), query: "goat")
    // 🇦🇷 and 🇵🇹 weigh the same: the file's order stays.
    XCTAssertEqual(glyphs(results).suffix(2), ["🇦🇷", "🇵🇹"])
  }

  // MARK: matchCultureInText

  private static let thanks: CultureEntry = {
    var entry = F.bowJapan
    entry.triggers = ["thank you", "thanks"]
    return entry
  }()
  private static let midAutumn = CultureEntry(
    id: "mid-autumn", context: "Mid-Autumn Festival", triggers: ["中秋节"],
    emoji: [CultureEmoji(emoji: "🥮", hexcode: "1F96E", weight: 0.9)])

  func testFindsATriggerAsWholeWordsInsideAMessage() {
    let file = F.culture([Self.thanks, F.goat])
    XCTAssertEqual(
      glyphs(
        CultureLayer.matchCultureInText(file, text: "Thanks so much for the help!", region: "JP")),
      ["🙇"])
    XCTAssertEqual(
      glyphs(CultureLayer.matchCultureInText(file, text: "he is the goat, no debate")),
      ["🐐", "⚽", "🇦🇷", "🇵🇹"])
  }

  func testNeverMatchesPartOfAWord() {
    XCTAssertEqual(
      CultureLayer.matchCultureInText(
        F.culture([Self.thanks]), text: "happy thanksgiving", region: "JP"), [])
  }

  func testKeepsTheRegionAndTheWindowInText() {
    let file = F.culture([Self.thanks, F.halloween])
    XCTAssertEqual(CultureLayer.matchCultureInText(file, text: "thanks a lot"), [])
    XCTAssertEqual(
      CultureLayer.matchCultureInText(file, text: "ready for halloween?", day: "2026-10-01"), [])
    XCTAssertEqual(
      CultureLayer.matchCultureInText(file, text: "ready for halloween?", day: "2026-10-20").first?
        .emoji, "🎃")
  }

  func testMatchesTriggersOfAScriptWithoutSpacesAnywhereInTheText() {
    let file = F.culture([Self.midAutumn], locale: "zh")
    XCTAssertEqual(
      CultureLayer.matchCultureInText(file, text: "祝大家中秋节快乐").first?.match, "中秋节")
  }

  func testNamesTheLongestTriggerThatMatched() {
    XCTAssertEqual(
      CultureLayer.matchCultureInText(
        F.culture([Self.thanks]), text: "thank you, thanks!", region: "JP"
      ).first?.match, "thank you")
  }

  func testAddsAfterTheTopReactionInTextModeWithNoRegionalLead() {
    let top = SearchResult(emoji: "🙏", id: "1F64F", score: 0.9, source: .semantic)
    let merged = CultureLayer.applyCulture(
      [top], culture: F.culture([Self.thanks]), query: "thanks so much!", region: "JP", text: true)
    XCTAssertEqual(merged.map(\.emoji), ["🙏", "🙇"])
    XCTAssertEqual(merged[1].source, .culture)
    XCTAssertEqual(merged[1].cultureId, "thanks-bow-jp")
    let football = CultureLayer.applyCulture(
      [SearchResult(emoji: "🏈", id: "1F3C8", score: 0.9, source: .alias)],
      culture: F.culture([F.footballSoccer]), query: "football", region: "GB", text: true)
    XCTAssertEqual(football.map(\.emoji), ["🏈", "⚽"])
  }

  // MARK: insertCulture

  private let canonical = [
    SearchResult(emoji: "🐐", id: "1F410", score: 1, source: .alias),
    SearchResult(emoji: "♑", id: "2651", score: 0.89, source: .alias),
    SearchResult(emoji: "⚽", id: "26BD", score: 0.5, source: .alias),
  ]
  private var goatMatches: [CultureResult] {
    CultureLayer.matchCulture(F.culture([F.goat]), query: "goat")
  }

  func testAddsCultureResultsRightAfterTheCanonicalTopResultNeverAboveIt() {
    let merged = CultureLayer.insertCulture(canonical, matches: goatMatches)
    XCTAssertEqual(merged.map(\.emoji), ["🐐", "⚽", "🇦🇷", "🇵🇹", "♑"])
    XCTAssertEqual(merged[0].source, .alias)
    XCTAssertEqual(merged[1].source, .culture)
    XCTAssertEqual(merged[1].context, F.goat.context)
  }

  func testPutsCultureResultsFirstOnlyWhenTheCanonicalListIsEmptyAndCutsToTheLimit() {
    XCTAssertEqual(
      CultureLayer.insertCulture([SearchResult](), matches: goatMatches).map(\.emoji),
      ["🐐", "⚽", "🇦🇷", "🇵🇹"])
    XCTAssertEqual(CultureLayer.insertCulture(canonical, matches: goatMatches, limit: 3).count, 3)
  }

  // MARK: Regional senses

  private static let regionalEngine = try! AliasEngine(packs: [F.pack]).withCulture(
    F.culture([F.footballSoccer, F.pantsUK, F.goat]))

  /// `region: ""` is no region; without one the engine uses the device's.
  private func top2(_ query: String, region: String = "") -> [String] {
    Array(
      Self.regionalEngine.search(query, options: AliasSearchOptions(prefix: false, region: region))
        .results.prefix(2).map(\.emoji))
  }

  func testKeepsTheCanonicalAnswerFirstWithoutARegion() {
    XCTAssertEqual(
      Self.regionalEngine.search("football", options: AliasSearchOptions(culture: false)).results
        .first?.emoji, "🏈")
    XCTAssertEqual(top2("football"), ["🏈", "⚽"])
  }

  func testLeadsWithTheRegionalSenseInItsRegionsAndKeepsTheCanonicalAnswerSecond() throws {
    let results = Self.regionalEngine.search(
      "football", options: AliasSearchOptions(region: "gb")
    ).results
    XCTAssertEqual(results.prefix(2).map(\.emoji), ["⚽", "🏈"])
    let lead = try XCTUnwrap(results.first)
    XCTAssertEqual(lead.source, .culture)
    XCTAssertEqual(lead.field, .culture)
    XCTAssertEqual(lead.cultureId, "football-soccer")
    XCTAssertEqual(lead.context, "Outside North America, football means soccer")
    XCTAssertEqual(lead.label, "soccer ball")
    XCTAssertEqual(lead.match, "football")
    XCTAssertEqual(results.filter { $0.emoji == "⚽" }.count, 1)
  }

  func testChangesNothingInTheRegionsItExcludes() {
    XCTAssertEqual(top2("football", region: "US"), ["🏈", "⚽"])
    XCTAssertEqual(top2("football", region: "CA").first, "🏈")
  }

  func testNeedsTheWholeTriggerNotAPrefixBeingTyped() {
    XCTAssertEqual(
      Self.regionalEngine.search("footba", options: AliasSearchOptions(region: "GB")).results
        .first?.emoji, "🏈")
  }

  func testLeadsOnlyOverTheCanonicalAnswersItNames() {
    let file = F.culture([F.pantsUK])
    XCTAssertNil(
      CultureLayer.matchRegionalLead(file, query: "pants", canonicalTopId: "1F456", region: "GB"))
    XCTAssertEqual(
      CultureLayer.matchRegionalLead(file, query: "pants", canonicalTopId: "1F410", region: "GB")?
        .emoji, "👻")
    XCTAssertNil(
      CultureLayer.matchRegionalLead(file, query: "pants", canonicalTopId: "1F410", region: "IE"))
    XCTAssertNil(CultureLayer.matchRegionalLead(file, query: "pants", canonicalTopId: "1F410"))
    XCTAssertNil(
      CultureLayer.matchRegionalLead(file, query: "pants", canonicalTopId: "1F410", region: ""))
  }

  func testNeverLeadsForOtherKindsEvenInTheirRegion() {
    XCTAssertNil(
      CultureLayer.matchRegionalLead(
        F.culture([F.bowJapan]), query: "thank you", canonicalTopId: "1F44D", region: "JP"))
  }

  func testIsOffWithCultureFalseAndKeepsTheCanonicalAnswerWithinAShortLimit() {
    XCTAssertEqual(
      Self.regionalEngine.search(
        "football", options: AliasSearchOptions(culture: false, region: "GB")
      ).results.first?.emoji, "🏈")
    XCTAssertEqual(
      Self.regionalEngine.search("football", options: AliasSearchOptions(limit: 2, region: "GB"))
        .results.map(\.emoji), ["⚽", "🏈"])
  }

  // MARK: Engine with culture

  private static let file = F.culture([
    F.goat, F.halloween,
    CultureEntry(
      id: "x", triggers: ["goat"], emoji: [CultureEmoji(emoji: "🦄", hexcode: "1F984", weight: 1)]),
  ])
  private static let cultureEngine = try! AliasEngine(packs: [F.pack], culture: file)

  func testAddsContextAfterTheCanonicalTopResult() throws {
    let output = Self.cultureEngine.search("goat")
    XCTAssertEqual(output.results.map(\.emoji), ["🐐", "⚽", "🇦🇷", "🇵🇹"])
    let second = output.results[1]
    XCTAssertEqual(second.source, .culture)
    XCTAssertEqual(second.label, "soccer ball")
    XCTAssertEqual(second.cultureId, "goat-football")
    XCTAssertEqual(second.searchResult.source, .culture)
    XCTAssertEqual(second.searchResult.context, F.goat.context)
    let canonical = Self.cultureEngine.search("goat", options: AliasSearchOptions(culture: false))
    XCTAssertEqual(output.confidence, canonical.confidence)
    XCTAssertEqual(output.coverage, canonical.coverage)
  }

  func testDropsCultureEmojiThePacksDoNotHaveAndOptsOutWithCultureFalse() {
    XCTAssertFalse(Self.cultureEngine.search("goat").results.map(\.emoji).contains("🦄"))
    XCTAssertEqual(
      Self.cultureEngine.search("goat", options: AliasSearchOptions(culture: false)).results.map(
        \.emoji), ["🐐"])
    XCTAssertEqual(Self.cultureEngine.canonicalSearch("goat").results.map(\.emoji), ["🐐"])
  }

  func testSharesTheIndexWithWithCulture() {
    let plain = Self.cultureEngine.withCulture(nil)
    XCTAssertNil(plain.culture)
    XCTAssertEqual(plain.entries, Self.cultureEngine.entries)
    XCTAssertEqual(plain.search("goat").results.map(\.emoji), ["🐐"])
    XCTAssertEqual(plain.withCulture(Self.file).search("goat").results.count, 4)
  }

  func testRespectsTheSearchLimitAndTheWindowOfSeasonalEntries() {
    XCTAssertEqual(
      Self.cultureEngine.search("goat", options: AliasSearchOptions(limit: 2)).results.count, 2)
    XCTAssertEqual(
      Self.cultureEngine.search("halloween", options: AliasSearchOptions(now: F.october20)).results
        .map(\.emoji), ["🎃", "👻"])
    XCTAssertNotEqual(
      Self.cultureEngine.search("halloween", options: AliasSearchOptions(now: F.date(2026, 6, 1)))
        .results.dropFirst().first?.source, .culture)
  }

  func testLabelsCultureResultsInTheSearchLocale() {
    let engine = try! AliasEngine(
      packs: [F.pack, Fixtures.turkish], culture: F.culture([F.goat]))
    let cake = CultureEntry(
      id: "cake", triggers: ["goat"],
      emoji: [CultureEmoji(emoji: "🎂", hexcode: "1F382", weight: 0.9)])
    let results = engine.withCulture(F.culture([cake])).search(
      "goat", options: AliasSearchOptions(locale: "tr")
    ).results
    XCTAssertEqual(results.map(\.label), ["goat", "doğum günü pastası"])
    XCTAssertEqual(
      engine.withCulture(F.culture([cake])).search("goat").results.map(\.label),
      ["goat", "birthday cake"])
  }

  // MARK: relevantNow

  private static let shelfFiles: [Culture] = {
    var dia = F.newYear
    dia.id = "dia"
    dia.when = F.halloween.when
    dia.emoji = [
      CultureEmoji(emoji: "🎃", hexcode: "1F383", weight: 1),
      CultureEmoji(emoji: "💀", hexcode: "1F480", weight: 0.9),
    ]
    return [F.culture([F.goat, F.halloween, dia]), F.culture([F.halloween], locale: "es")]
  }()

  func testListsFeaturedSeasonalEntriesActiveNowOneEmojiPerEntryInTurn() {
    let shelf = CultureLayer.relevantNow(Self.shelfFiles, now: F.october20)
    XCTAssertEqual(shelf.map(\.emoji), ["🎃", "👻", "💀"])
    XCTAssertEqual(shelf.map(\.cultureId), ["halloween", "halloween", "dia"])
  }

  func testIsEmptyOutsideEveryWindowAndNeverListsLastingEntries() {
    XCTAssertEqual(CultureLayer.relevantNow(Self.shelfFiles, now: F.date(2026, 5, 1)), [])
  }

  func testPicksTheFileOfTheLocaleAndHonoursLimitAndRegion() {
    XCTAssertEqual(
      CultureLayer.relevantNow(Self.shelfFiles, locale: "es", now: F.october20, limit: 1).count, 1)
    XCTAssertEqual(CultureLayer.relevantNow(Self.shelfFiles, locale: "fr", now: F.october20), [])
    var usOnly = F.halloween
    usOnly.regions = ["US"]
    let regional = F.culture([usOnly])
    XCTAssertEqual(CultureLayer.relevantNow(regional, now: F.october20), [])
    XCTAssertEqual(CultureLayer.relevantNow(regional, region: "us", now: F.october20).count, 2)
  }

  // MARK: Files

  private static let fileJSON = """
    {"format":"emojisense-culture","formatVersion":1,"packVersion":"0.1.0","locale":"es",
     "from":"2026-10-02","until":"2026-10-16","futureKey":{"x":1},"entries":[
     {"id":"goat-football","kind":"lasting","context":"El debate","when":null,"regions":["*"],
      "triggers":["goat","el goat"],"emoji":[["🐐","1F410",0.7],["⚽","26BD",0.6]]},
     {"id":"halloween","kind":"seasonal","context":"Halloween","when":{"from":"10-15","to":"10-31","recurs":"yearly"},
      "regions":["*"],"triggers":["halloween"],"emoji":[["🎃","1F383",0.9]],"featured":true},
     {"id":"futbol","kind":"regional","context":"Fútbol","when":null,"regions":["*"],"exceptRegions":["US"],
      "triggers":["football"],"emoji":[["⚽","26BD",0.9]],"outranks":["1F3C8"]},
     {"id":"future","kind":"someday","context":"A kind from a newer file","when":null,"regions":["*"],
      "triggers":["x"],"emoji":[]}],
     "relevantNow":["halloween"],"zones":{"Europe/Madrid":"ES"}}
    """

  func testDecodesACultureFile() throws {
    let decoded = try Culture(jsonData: Data(Self.fileJSON.utf8))
    XCTAssertEqual(decoded.locale, "es")
    XCTAssertEqual(decoded.packVersion, "0.1.0")
    XCTAssertEqual(decoded.relevantNow, ["halloween"])
    XCTAssertEqual(decoded.zones, ["Europe/Madrid": "ES"])
    XCTAssertNil(decoded.entries[0].when)
    XCTAssertEqual(
      decoded.entries[1].when, CultureWindow(from: "10-15", to: "10-31", recurs: "yearly"))
    XCTAssertTrue(decoded.entries[1].featured)
    XCTAssertFalse(decoded.entries[0].featured)
    XCTAssertEqual(decoded.entries[2].exceptRegions, ["US"])
    XCTAssertEqual(decoded.entries[2].outranks, ["1F3C8"])
    XCTAssertEqual(decoded.entries[2].kind, .regional)
    // A kind this SDK does not know acts as a lasting entry.
    XCTAssertEqual(decoded.entries[3].kind, .lasting)
    XCTAssertEqual(
      decoded.entries[0].emoji[0], CultureEmoji(emoji: "🐐", hexcode: "1F410", weight: 0.7))
  }

  func testRejectsOtherFormatsVersionsAndShapes() {
    let cases: [(String, EmojisenseError)] = [
      (
        #"{"format":"emojisense-pack","formatVersion":1,"entries":[]}"#,
        .invalidFormat(expected: "emojisense-culture", found: "emojisense-pack")
      ),
      (
        #"{"format":"emojisense-culture","formatVersion":2,"entries":[]}"#,
        .unsupportedFormatVersion(format: "emojisense-culture", version: 2)
      ),
      (
        #"{"format":"emojisense-culture","formatVersion":1}"#,
        .invalidData("culture file has no entries")
      ),
      (
        #"{"format":"emojisense-culture","formatVersion":1,"entries":null}"#,
        .invalidData("culture file has no entries")
      ),
      (
        #"{"format":"emojisense-culture","formatVersion":1,"entries":[{"id":"a","emoji":[["⚽","26BD","0.9"]]}]}"#,
        .invalidData("a culture emoji must be [emoji, hexcode, weight]")
      ),
    ]
    for (json, expected) in cases {
      XCTAssertThrowsError(try Culture(jsonData: Data(json.utf8)), json) { error in
        XCTAssertEqual(error as? EmojisenseError, expected)
      }
    }
    XCTAssertThrowsError(try Culture(jsonData: Data("not json".utf8))) { error in
      guard case .invalidData = error as? EmojisenseError else {
        return XCTFail("\(error)")
      }
    }
  }

  func testFetchesTheCultureFileOfALocaleFromTheBaseURL() async throws {
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(Self.fileJSON.utf8)) }
    let loaded = try await CultureLayer.loadCulture(
      baseURL: URL(string: "https://x.test/v1/culture/0.1.0/")!, locale: "es", transport: transport)
    let requests = await transport.requests.map(\.absoluteString)
    XCTAssertEqual(requests, ["https://x.test/v1/culture/0.1.0/culture.es.json"])
    XCTAssertEqual(loaded.entries.count, 4)
  }

  func testRejectsHTTPErrorsAndOtherFiles() async throws {
    let notFound = StubTransport { _ in HTTPResponse(status: 404, body: Data()) }
    do {
      _ = try await CultureLayer.loadCulture(
        baseURL: URL(string: "https://x.test")!, locale: "en", transport: notFound)
      XCTFail("expected an HTTP error")
    } catch let error as EmojisenseError {
      XCTAssertEqual(
        error, .httpStatus(404, url: URL(string: "https://x.test/culture.en.json")!))
      XCTAssertTrue(error.description.contains("HTTP 404"))
    }
    let pack = """
      {"format":"emojisense-pack","formatVersion":1,"packVersion":"t","locale":"en",
       "emojiVersion":"17.0","groups":[],"emoji":[]}
      """
    let other = StubTransport { _ in HTTPResponse(status: 200, body: Data(pack.utf8)) }
    do {
      _ = try await CultureLayer.loadCulture(
        baseURL: URL(string: "https://x.test")!, locale: "en", transport: other)
      XCTFail("expected a format error")
    } catch let error as EmojisenseError {
      XCTAssertEqual(
        error, .invalidFormat(expected: "emojisense-culture", found: "emojisense-pack"))
    }
  }

  func testRefusesLocalesThatAreNotPlainLocaleTagsBeforeAnyRequest() async throws {
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(Self.fileJSON.utf8)) }
    let base = URL(string: "https://x.test")!
    for locale in ["../../v1/pack/0.1.0/pack.en", "en/../x", "en?x=1", "en#", "EN", "", "e"] {
      do {
        _ = try await CultureLayer.loadCulture(baseURL: base, locale: locale, transport: transport)
        XCTFail("\(locale) was accepted")
      } catch let error as EmojisenseError {
        XCTAssertEqual(error, .invalidLocale(locale))
        XCTAssertTrue(error.description.contains("is not a locale tag"))
      }
    }
    var requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 0)
    for locale in ["pt-BR", "zh-Hans", "zh-Hant-TW", "fil"] {
      _ = try await CultureLayer.loadCulture(baseURL: base, locale: locale, transport: transport)
    }
    requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 4)
    let first = await transport.requests.first?.absoluteString
    XCTAssertEqual(first, "https://x.test/culture.pt-BR.json")
  }

  func testFindsTheCultureDirectoryNextToAPackDirectory() {
    XCTAssertEqual(
      CultureLayer.cultureURL(forPackURL: URL(string: "https://api.emojisense.com/v1/pack/0.1.0")!)?
        .absoluteString, "https://api.emojisense.com/v1/culture/0.1.0")
    XCTAssertEqual(
      CultureLayer.cultureURL(forPackURL: URL(string: "/v1/pack/0.1.0/")!)?.absoluteString,
      "/v1/culture/0.1.0")
    XCTAssertEqual(
      CultureLayer.cultureURL(forPackURL: URL(string: "https://x.test/a/pack/b/pack/1.0//")!)?
        .absoluteString, "https://x.test/a/pack/b/culture/1.0")
    for other in [
      "https://packs.test/0.1.0", "https://example.com/packs/0.1.0",
      "https://x.test/v1/pack/0.1.0?key=1", "https://x.test/v1/pack/", "pack/0.1.0",
    ] {
      XCTAssertNil(CultureLayer.cultureURL(forPackURL: URL(string: other)!), other)
    }
  }

  // MARK: Regions

  func testReadsTheTwoLetterRegionSubtagOfALocaleTag() {
    XCTAssertEqual(CultureLayer.regionOf("pt-BR"), "BR")
    XCTAssertEqual(CultureLayer.regionOf("zh-Hant-TW"), "TW")
    XCTAssertEqual(CultureLayer.regionOf("en-us"), "US")
    XCTAssertEqual(CultureLayer.regionOf("de-CH-1996"), "CH")
    XCTAssertEqual(CultureLayer.regionOf("en-GB-u-ca-gregory"), "GB")
    XCTAssertEqual(CultureLayer.regionOf("en-GB-x-a"), "GB")
  }

  func testGivesNoRegionWithoutATwoLetterRegionSubtag() {
    for tag in ["en", "zh-Hans", "es-419", "", "not a tag", "en_US", "en-GB-u", "en-"] {
      XCTAssertNil(CultureLayer.regionOf(tag), tag)
    }
  }

  func testDerivesTheDeviceRegionFromTheLocale() {
    XCTAssertEqual(CultureLayer.deviceRegion(locale: Locale(identifier: "pt-BR")), "BR")
    XCTAssertNil(CultureLayer.deviceRegion(locale: Locale(identifier: "fr")))
    XCTAssertNil(CultureLayer.deviceRegion(locale: Locale(identifier: "es-419")))
  }

  func testFallsBackToTheTimeZoneWhenTheLocaleHasNoRegion() {
    let tokyo = TimeZone(identifier: "Asia/Tokyo")!
    let japanese = Locale(identifier: "ja")
    XCTAssertEqual(
      CultureLayer.deviceRegion(zones: ["Asia/Tokyo": "JP"], locale: japanese, timeZone: tokyo),
      "JP")
    XCTAssertNil(
      CultureLayer.deviceRegion(zones: ["Not/A_Zone": "JP"], locale: japanese, timeZone: tokyo))
    XCTAssertNil(CultureLayer.deviceRegion(locale: japanese, timeZone: tokyo))
    XCTAssertEqual(
      CultureLayer.deviceRegion(
        zones: ["Asia/Tokyo": "JP"], locale: Locale(identifier: "en-CA"), timeZone: tokyo), "CA")
  }

  func testResolvesAnAppsRegionOption() {
    let zones = [TimeZone.current.identifier: "JP"]
    let culture = Culture(
      packVersion: "test", locale: "en", from: "", until: "", entries: [], zones: zones)
    let device = CultureLayer.deviceRegion(zones: zones)
    XCTAssertNotNil(device)
    XCTAssertEqual(CultureLayer.resolveRegion(nil, culture: culture), device)
    XCTAssertEqual(CultureLayer.resolveRegion("device", culture: culture), device)
    XCTAssertEqual(CultureLayer.resolveRegion("Device", culture: culture), device)
    XCTAssertEqual(CultureLayer.resolveRegion(nil), CultureLayer.deviceRegion())
    XCTAssertNil(CultureLayer.resolveRegion(""))
    XCTAssertEqual(CultureLayer.resolveRegion("BR"), "BR")
    XCTAssertEqual(CultureLayer.resolveRegion("auto"), "auto")
  }
}
