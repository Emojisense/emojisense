import Foundation
import XCTest

@testable import Emojisense

private let volcanoBody = """
  {"query":"x","results":[{"emoji":"🌋","id":"1F30B","score":0.7,"source":"semantic"}],
   "packVersion":"test","cached":false}
  """

/// Ports the session tests of packages/core/test/client-session.test.ts and culture.test.ts.
final class SearchSessionTests: XCTestCase {
  private typealias F = CultureFixtures

  private func client(_ transport: StubTransport) -> SemanticClient {
    SemanticClient(
      configuration: .init(endpoint: URL(string: "https://api.test")!), transport: transport)
  }

  private func volcanoTransport() -> StubTransport {
    StubTransport { _ in HTTPResponse(status: 200, body: Data(volcanoBody.utf8)) }
  }

  // MARK: Search session

  func testFusesTheSameCandidatesWhateverItsLimitAndShowsTheLimit() async throws {
    let transport = volcanoTransport()
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), semantic: client(transport), limit: 2,
      debounce: .milliseconds(10), onChange: recorder.record)
    session.update("volcano eruption")
    try await recorder.wait { $0.status == .fused }
    let query = await transport.requests.first?.query ?? ""
    XCTAssertTrue(query.contains("limit=24"), query)
    XCTAssertTrue(recorder.states.allSatisfy { $0.results.count <= 2 })
  }

  func testDeliversAliasResultsAtOnceAndFusedResultsAfterTheDebounce() async throws {
    let transport = volcanoTransport()
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), semantic: client(transport),
      debounce: .milliseconds(50), onChange: recorder.record)
    session.update("volcano erupt")
    XCTAssertEqual(recorder.last?.status, .loading)
    session.update("volcano eruption")
    let fused = try await recorder.wait { $0.status == .fused }
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 1)
    XCTAssertEqual(fused.query, "volcano eruption")
    XCTAssertTrue(fused.results.map(\.emoji).contains("🌋"))
    XCTAssertEqual(fused.layer, .api)
    XCTAssertNotNil(fused.semanticDuration)
  }

  func testKeepsAliasResultsWhenNoLayerAnswers() async throws {
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), semantic: StubProvider { _, _ in nil },
      debounce: .milliseconds(10), onChange: recorder.record)
    session.update("volcano eruption")
    try await recorder.wait { $0.status == .alias }
    XCTAssertEqual(recorder.states.map(\.status), [.loading, .alias])
  }

  func testReportsAFailedRequestWithTheAliasResults() async throws {
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]),
      semantic: StubProvider { _, _ in throw URLError(.notConnectedToInternet) },
      debounce: .milliseconds(10), shouldUseSemantic: { _ in true }, onChange: recorder.record)
    session.update("rocket")
    let failed = try await recorder.wait { $0.status == .error }
    XCTAssertEqual((failed.error as? URLError)?.code, .notConnectedToInternet)
    XCTAssertEqual(failed.results.map(\.emoji), ["🚀"])
  }

  func testSkipsTheNetworkWhenTheAliasMatchIsConfident() async throws {
    let transport = volcanoTransport()
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), semantic: client(transport),
      debounce: .milliseconds(10), onChange: recorder.record)
    session.update("rocket")
    try await Task.sleep(for: .milliseconds(100))
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 0)
    XCTAssertEqual(recorder.last?.status, .alias)
    XCTAssertEqual(recorder.last?.unsure, false)
  }

  func testCallsAnEmptyQueryIdle() throws {
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), onChange: recorder.record)
    session.update(" 🎉 ")
    XCTAssertEqual(recorder.last?.status, .idle)
    XCTAssertEqual(recorder.last?.unsure, false)
  }

  func testDropsTheAnswerForAnOlderQuery() async throws {
    // The provider ignores cancellation, so the older answer does arrive: the session drops it.
    let provider = StubProvider(delay: .milliseconds(80)) { query, _ in
      SemanticResponse(
        results: [SearchResult(emoji: "🌋", id: "1F30B", score: 0.7, source: .semantic)],
        packVersion: query, cached: false)
    }
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), semantic: provider,
      debounce: .milliseconds(10), onChange: recorder.record)
    session.update("volcano erupt")
    try await until { provider.requests == ["volcano erupt"] }
    session.update("volcano eruption")
    try await recorder.wait { $0.status == .fused }
    try await Task.sleep(for: .milliseconds(150))
    XCTAssertEqual(provider.requests, ["volcano erupt", "volcano eruption"])
    XCTAssertEqual(
      recorder.states.map { "\($0.query) \($0.status)" },
      ["volcano erupt loading", "volcano eruption loading", "volcano eruption fused"])
  }

  func testCancelDropsThePendingAnswer() async throws {
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]),
      semantic: StubProvider(delay: .milliseconds(30)) { _, _ in
        SemanticResponse(results: [], packVersion: "test", cached: false)
      },
      debounce: .milliseconds(10), onChange: recorder.record)
    session.update("volcano eruption")
    try await Task.sleep(for: .milliseconds(20))
    session.cancel()
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertEqual(recorder.states.map(\.status), [.loading])
  }

  func testPrefetchesTheIndexesAtOnceAndTheQueryShardDuringTheDebounce() async throws {
    let provider = StubProvider { _, _ in nil }
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), semantic: provider, locale: "en",
      debounce: .milliseconds(10), onChange: { _ in })
    XCTAssertEqual(provider.prefetches, [""])
    session.update("volcano eruption")
    session.update("rocket")
    XCTAssertEqual(provider.prefetches, ["", "volcano eruption"])
  }

  func testShowsAnAnswerInMemoryAtOnceWithNoDebounceAndNoRequest() async throws {
    let transport = volcanoTransport()
    let client = client(transport)
    _ = try await client.search("volcano eruption", options: SemanticSearchOptions(limit: 24))
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), semantic: client,
      debounce: .milliseconds(50), onChange: recorder.record)
    session.update("volcano eruption")
    XCTAssertEqual(recorder.states.count, 1)
    XCTAssertEqual(recorder.last?.status, .fused)
    XCTAssertEqual(recorder.last?.layer, .api)
    XCTAssertEqual(recorder.last?.semanticCached, true)
    XCTAssertEqual(recorder.last?.semanticDuration, .zero)
    try await Task.sleep(for: .milliseconds(150))
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 1)
  }

  // MARK: Unsure queries

  /// The API's answer for an unsure query: a flat, low semantic list.
  private func unsureTransport(calibration: String = "") -> StubTransport {
    let body = """
      {"packVersion":"test","cached":false,"unsure":true,"confidence":0,\(calibration)
       "results":[{"emoji":"🌋","id":"1F30B","score":0.4,"source":"semantic"},
                  {"emoji":"🐐","id":"1F410","score":\(calibration.isEmpty ? "0.39" : "0.3"),"source":"semantic"}]}
      """
    return StubTransport { _ in HTTPResponse(status: 200, body: Data(body.utf8)) }
  }

  func testCallsAQueryUnsureWhileItWaitsAndAfterAFlatSemanticList() async throws {
    let transport = unsureTransport()
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), semantic: client(transport),
      debounce: .milliseconds(10), onChange: recorder.record)
    session.update("kendrick lamar")
    XCTAssertEqual(recorder.last?.status, .loading)
    XCTAssertEqual(recorder.last?.unsure, true)
    let fused = try await recorder.wait { $0.status == .fused }
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 1)
    XCTAssertTrue(fused.unsure)
    XCTAssertEqual(fused.results.first?.source, .semantic)
  }

  func testJudgesWithTheCalibrationTheAPISendsForItsModel() async throws {
    // A top of 0.4 that stands out: weak under the default calibration, sure under one whose
    // ceiling is below it.
    let transport = unsureTransport(calibration: #""calibration":{"floor":0.1,"ceiling":0.3},"#)
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), semantic: client(transport),
      debounce: .milliseconds(10), onChange: recorder.record)
    session.update("kendrick lamar")
    let fused = try await recorder.wait { $0.status == .fused }
    XCTAssertFalse(fused.unsure)
  }

  // MARK: Region auto

  /// A culture entry for Great Britain only.
  private let eruptionCulture = Culture(
    packVersion: "test", locale: "en", from: "2026-01-01", until: "2027-12-31",
    entries: [
      CultureEntry(
        id: "eruption-dino", context: "In this test region, eruptions come with dinosaurs",
        regions: ["GB"], triggers: ["volcano eruption"],
        emoji: [CultureEmoji(emoji: "🦖", hexcode: "1F996", weight: 0.9)])
    ])

  private func regionSession(_ region: String, answerRegion: String?) throws -> (
    StubTransport, SearchSession, StateRecorder
  ) {
    let field = answerRegion.map { #""region":"\#($0)","# } ?? #""region":null,"#
    let body = volcanoBody.replacingOccurrences(
      of: #""packVersion""#, with: field + #""packVersion""#)
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(body.utf8)) }
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [Fixtures.english]), semantic: client(transport),
      debounce: .milliseconds(10), culture: eruptionCulture, region: region,
      onChange: recorder.record)
    return (transport, session, recorder)
  }

  func testAppliesRegionalEntriesOnceAnAPIAnswerReportsTheCallersRegion() async throws {
    let (transport, session, recorder) = try regionSession("auto", answerRegion: "GB")
    session.update("volcano eruption")
    XCTAssertFalse(recorder.glyphs.contains("🦖"))
    try await recorder.wait { $0.status == .fused }
    let query = await transport.requests.first?.query ?? ""
    XCTAssertTrue(query.hasSuffix("&culture=0&region=auto"), query)
    XCTAssertEqual(recorder.glyphs, ["🌋", "🦖"])
    // Later keystrokes keep the learned region, before any new answer.
    session.update("volcano eruption ")
    XCTAssertTrue(recorder.glyphs.contains("🦖"))
  }

  func testKeepsRegionalEntriesOffWhileTheAPIDoesNotKnowTheRegion() async throws {
    let (_, session, recorder) = try regionSession("auto", answerRegion: nil)
    session.update("volcano eruption")
    try await recorder.wait { $0.status == .fused }
    XCTAssertEqual(recorder.glyphs, ["🌋"])
  }

  func testKeepsAnExplicitRegionOnTheDeviceWhateverTheAPIReports() async throws {
    let (transport, session, recorder) = try regionSession("US", answerRegion: "GB")
    session.update("volcano eruption")
    try await recorder.wait { $0.status == .fused }
    let query = await transport.requests.first?.query ?? ""
    XCTAssertFalse(query.contains("region="), query)
    XCTAssertEqual(recorder.glyphs, ["🌋"])
  }

  // MARK: Culture

  func testAppliesCultureAfterFusionSoTheCanonicalTopResultStaysFirst() async throws {
    let semanticFirst = StubProvider { _, _ in
      SemanticResponse(
        results: [
          SearchResult(emoji: "🇵🇹", id: "1F1F5-1F1F9", score: 0.9, source: .semantic),
          SearchResult(emoji: "🐐", id: "1F410", score: 0.8, source: .semantic),
        ], packVersion: "test", cached: false)
    }
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [F.pack]).withCulture(F.culture([F.goat])),
      semantic: semanticFirst, debounce: .milliseconds(10), shouldUseSemantic: { _ in true },
      onChange: recorder.record)
    session.update("greatest of all time")
    let first = try XCTUnwrap(recorder.states.first)
    XCTAssertEqual(first.results.map(\.emoji), ["🐐", "⚽", "🇦🇷", "🇵🇹"])
    XCTAssertTrue(first.alias.results.allSatisfy { $0.source == .alias })
    XCTAssertEqual(first.results[1].context, F.goat.context)
    let fused = try await recorder.wait { $0.status == .fused }
    XCTAssertEqual(fused.results.first?.emoji, "🐐")
    XCTAssertEqual(fused.results[1..<4].map(\.source), [.culture, .culture, .culture])
  }

  func testTurnsCultureOffWithNoCultureFile() throws {
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [F.pack], culture: F.culture([F.goat])), culture: nil,
      onChange: recorder.record)
    session.update("goat")
    XCTAssertEqual(recorder.glyphs, ["🐐"])
  }

  func testPassesTheRegionToRegionalEntries() throws {
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [F.pack]), culture: F.culture([F.bowJapan]), region: "JP",
      onChange: recorder.record)
    session.update("thank you")
    XCTAssertEqual(recorder.glyphs, ["🙇"])
  }

  func testUsesTheDevicesRegionByDefaultAndNoneWithAnEmptyRegion() throws {
    // The time zone gives a region when the device's locale has none, so there always is one.
    let zones = [TimeZone.current.identifier: "JP"]
    let device = try XCTUnwrap(CultureLayer.deviceRegion(zones: zones))
    var bow = F.bowJapan
    bow.regions = [device]
    var culture = F.culture([bow])
    culture.zones = zones
    let engine = try AliasEngine(packs: [F.pack])
    let search = { (region: String?) in
      let recorder = StateRecorder()
      SearchSession(engine: engine, culture: culture, region: region, onChange: recorder.record)
        .update("thank you")
      return recorder.glyphs
    }
    XCTAssertEqual(search(nil), ["🙇"])
    XCTAssertEqual(search("device"), ["🙇"])
    XCTAssertEqual(search(""), [])
  }

  func testChecksWindowsAgainstItsClockAndFollowsTheDay() throws {
    let clock = DateBox(F.date(2026, 10, 1, 12))
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try AliasEngine(packs: [F.pack]), culture: F.culture([F.halloween]),
      now: { clock.value }, onChange: recorder.record)
    session.update("halloween")
    XCTAssertEqual(recorder.glyphs, ["🎃"])
    clock.value = F.october20
    session.update("halloween")
    XCTAssertEqual(recorder.glyphs, ["🎃", "👻"])
    clock.value = F.date(2026, 10, 14, 23, 59)
    session.update("halloween")
    clock.value = F.date(2026, 10, 15, 0, 1)
    session.update("halloween")
    XCTAssertEqual(
      recorder.states.suffix(2).map { $0.results.contains { $0.source == .culture } },
      [false, true])
  }

  private func regionalEngine() throws -> AliasEngine {
    try AliasEngine(packs: [F.pack]).withCulture(F.culture([F.footballSoccer, F.pantsUK, F.goat]))
  }

  func testFollowsTheSessionRegion() throws {
    let recorder = StateRecorder()
    SearchSession(engine: try regionalEngine(), region: "DE", onChange: recorder.record)
      .update("football")
    XCTAssertEqual(Array(recorder.glyphs.prefix(2)), ["⚽", "🏈"])
  }

  /// An API that answers 🏈 and finds the region of the request.
  private func apiWithRegion(_ region: String?) -> StubProvider {
    StubProvider { _, _ in
      SemanticResponse(
        results: [SearchResult(emoji: "🏈", id: "1F3C8", score: 0.9, source: .semantic)],
        packVersion: "test", cached: false, layer: .api, region: region)
    }
  }

  func testLearnsTheRegionFromTheAPIWithRegionAuto() async throws {
    let api = apiWithRegion("DE")
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try regionalEngine(), semantic: api, debounce: .milliseconds(10),
      shouldUseSemantic: { _ in true }, region: "auto", onChange: recorder.record)
    session.update("football")
    XCTAssertEqual(Array(recorder.glyphs.prefix(2)), ["🏈", "⚽"])
    try await recorder.wait { $0.status == .fused }
    XCTAssertEqual(Array(recorder.glyphs.prefix(2)), ["⚽", "🏈"])
    XCTAssertEqual(api.regions, ["auto"])
    session.update("football")
    XCTAssertEqual(Array(recorder.glyphs.prefix(2)), ["⚽", "🏈"])
  }

  func testKeepsAnExplicitRegionOverTheAPIRegion() async throws {
    let api = apiWithRegion("DE")
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: try regionalEngine(), semantic: api, debounce: .milliseconds(10),
      shouldUseSemantic: { _ in true }, region: "US", onChange: recorder.record)
    session.update("football")
    try await recorder.wait { $0.status == .fused }
    XCTAssertEqual(Array(recorder.glyphs.prefix(2)), ["🏈", "⚽"])
    XCTAssertEqual(api.regions, [nil])
  }
}

/// Waits until `condition` holds, at most `timeout`.
func until(timeout: Duration = .seconds(5), _ condition: () -> Bool) async throws {
  let deadline = ContinuousClock.now + timeout
  while !condition() {
    guard ContinuousClock.now < deadline else { throw StateRecorderError.timeout }
    try await Task.sleep(for: .milliseconds(5))
  }
}

/// Records the states a session delivers, from any thread.
final class StateRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private var recorded: [SessionState] = []

  var states: [SessionState] { lock.withLock { recorded } }
  var last: SessionState? { states.last }
  /// The glyphs of the last state.
  var glyphs: [String] { last?.results.map(\.emoji) ?? [] }

  func record(_ state: SessionState) {
    lock.withLock { recorded.append(state) }
  }

  /// The first state that satisfies `condition`, waiting for it at most `timeout`.
  @discardableResult
  func wait(
    timeout: Duration = .seconds(5), until condition: (SessionState) -> Bool
  ) async throws -> SessionState {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
      if let state = states.first(where: condition) { return state }
      try await Task.sleep(for: .milliseconds(5))
    }
    throw StateRecorderError.noMatchingState(states.map { "\($0.query) \($0.status)" })
  }
}

enum StateRecorderError: Error {
  case timeout
  /// The states delivered before the timeout.
  case noMatchingState([String])
}

/// A semantic provider that answers from a closure after a delay that cancellation does not
/// shorten, and records what it was asked.
final class StubProvider: SemanticProvider, @unchecked Sendable {
  private let delay: Duration
  private let answer: @Sendable (String, SemanticSearchOptions) throws -> SemanticResponse?
  private let lock = NSLock()
  private var asked: [(query: String, region: String?)] = []
  private var prefetched: [String] = []

  init(
    delay: Duration = .zero,
    _ answer: @escaping @Sendable (String, SemanticSearchOptions) throws -> SemanticResponse?
  ) {
    self.delay = delay
    self.answer = answer
  }

  var requests: [String] { lock.withLock { asked.map(\.query) } }
  var regions: [String?] { lock.withLock { asked.map(\.region) } }
  var prefetches: [String] { lock.withLock { prefetched } }

  func search(_ query: String, options: SemanticSearchOptions) async throws -> SemanticResponse? {
    lock.withLock { asked.append((query, options.region)) }
    if delay > .zero {
      let nanoseconds =
        Int(delay.components.seconds) * 1_000_000_000
        + Int(delay.components.attoseconds / 1_000_000_000)
      await withCheckedContinuation { continuation in
        DispatchQueue.global().asyncAfter(deadline: .now() + .nanoseconds(nanoseconds)) {
          continuation.resume()
        }
      }
    }
    return try answer(query, options)
  }

  func prefetch(_ query: String, locale: String?) {
    lock.withLock { prefetched.append(query) }
  }
}

/// A date that a test changes while a session reads it.
final class DateBox: @unchecked Sendable {
  private let lock = NSLock()
  private var current: Date

  init(_ date: Date) {
    current = date
  }

  var value: Date {
    get { lock.withLock { current } }
    set { lock.withLock { current = newValue } }
  }
}
