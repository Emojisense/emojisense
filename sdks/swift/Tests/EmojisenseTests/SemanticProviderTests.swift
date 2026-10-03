import Foundation
import XCTest

@testable import Emojisense

private let semanticBody = """
  {"query":"x","results":[{"emoji":"🌋","id":"1F30B","score":0.7,"source":"semantic"}],
   "packVersion":"test","cached":false}
  """

/// Ports the semantic client tests of packages/core/test/client-session.test.ts.
final class SemanticClientTests: XCTestCase {
  private func client(
    _ transport: StubTransport, key: String? = nil, cooldown: TimeInterval = 3600,
    now: @escaping @Sendable () -> Date = { Date() }
  ) -> SemanticClient {
    SemanticClient(
      configuration: .init(
        endpoint: URL(string: "https://api.test/")!, key: key, overLimitCooldown: cooldown),
      transport: transport, now: now)
  }

  func testSendsTheEmbeddingTextSendsTheKeyAndCaches() async throws {
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8)) }
    let client = client(transport, key: "pk_1")
    let options = SemanticSearchOptions(locale: "en", limit: 5)
    let first = try await client.search("  Jurassic   PARK!! ", options: options)
    _ = try await client.search("jurassic park!!", options: options)
    _ = try await client.search(" 🎉 !! ", options: options)

    XCTAssertEqual(first?.layer, .api)
    XCTAssertEqual(first?.results.first?.emoji, "🌋")
    let requests = await transport.requests
    XCTAssertEqual(requests.count, 1)
    XCTAssertEqual(
      requests.first?.absoluteString,
      "https://api.test/v1/search?q=jurassic+park%21%21&locale=en&limit=5&mode=semantic&key=pk_1")
  }

  func testEncodesAPlusLikeURLSearchParams() async throws {
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8)) }
    _ = try await client(transport).search("+1")
    let url = await transport.requests.first
    XCTAssertEqual(url?.query, "q=%2B1&locale=en&limit=24&mode=semantic")
  }

  func testGoesQuietAfterAnOverLimitAnswerThenRetriesAfterTheCooldown() async throws {
    let overLimit = semanticBody.replacingOccurrences(
      of: #""cached":false"#, with: #""cached":false,"overLimit":true"#)
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(overLimit.utf8)) }
    let clock = TestClock()
    let client = client(transport, cooldown: 1, now: { clock.now })

    let first = try await client.search("lava eruption")
    let second = try await client.search("volcano eruption")
    XCTAssertNil(first)
    XCTAssertNil(second)
    var requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 1)

    clock.advance(by: 2)
    _ = try await client.search("volcano eruption")
    requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 2)
  }

  func testMarksAnAnswerFromItsOwnMemoryAsCached() async throws {
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8)) }
    let client = client(transport)
    let first = try await client.search("volcano")
    let second = try await client.search("volcano")
    XCTAssertEqual(first?.cached, false)
    XCTAssertEqual(second?.cached, true)
    XCTAssertEqual(second?.results, first?.results)
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 1)
  }

  func testDecodesTheCalibrationOfTheServerModel() throws {
    let decode = { (json: String) in
      try JSONDecoder().decode(SemanticResponse.self, from: Data(json.utf8))
    }
    XCTAssertNil(try decode(semanticBody).calibration)
    let body = """
      {"results":[],"packVersion":"test","cached":false,
       "calibration":{"floor":0.39,"ceiling":0.56,"gapFloor":0.02,"gapCeiling":0.1}}
      """
    XCTAssertEqual(try decode(body).calibration, .standard)
    let withoutGap = body.replacingOccurrences(of: #","gapFloor":0.02,"gapCeiling":0.1"#, with: "")
    XCTAssertEqual(
      try decode(withoutGap).calibration, Fusion.SemanticCalibration(floor: 0.39, ceiling: 0.56))
  }

  // MARK: The search loop of the README (the session tests of client-session.test.ts)

  func testFusesTheSameCandidatesWhateverItsLimitAndShowsTheLimit() async throws {
    let body = """
      {"packVersion":"test","cached":false,"results":[
       {"emoji":"🚒","id":"1F692","score":0.6,"source":"semantic"},
       {"emoji":"🌋","id":"1F30B","score":0.55,"source":"semantic"},
       {"emoji":"🔥","id":"1F525","score":0.5,"source":"semantic"}]}
      """
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(body.utf8)) }
    let engine = try AliasEngine(packs: [Fixtures.english])
    let limit = 2
    let depth = max(limit, Fusion.rankDepth)
    let alias = engine.search("fire", options: AliasSearchOptions(limit: depth))
    let response = try await client(transport).search(
      "fire", options: SemanticSearchOptions(limit: depth))
    let requests = await transport.requests
    let url = try XCTUnwrap(requests.first)
    let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
    XCTAssertEqual(query?.first { $0.name == "limit" }?.value, "24")

    let semantic = try XCTUnwrap(response).results
    let ranking = Fusion.Ranking(popularity: { [engine] in engine.popularity($0) })
    let shown = Fusion.fuse(alias: alias, semantic: semantic, limit: limit, ranking: ranking)
    let deep = Fusion.fuse(alias: alias, semantic: semantic, limit: depth, ranking: ranking)
    XCTAssertGreaterThan(deep.count, limit)
    XCTAssertEqual(shown, Array(deep.prefix(limit)))
  }

  func testJudgesWithTheCalibrationTheAPISendsForItsModel() async throws {
    // A top of 0.4 that stands out: weak under the default calibration, sure under one whose
    // ceiling is below it.
    let body = """
      {"packVersion":"test","cached":false,"unsure":true,"confidence":0,
       "calibration":{"floor":0.1,"ceiling":0.3},
       "results":[{"emoji":"🌋","id":"1F30B","score":0.4,"source":"semantic"},
                  {"emoji":"🐐","id":"1F410","score":0.3,"source":"semantic"}]}
      """
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(body.utf8)) }
    let alias = try AliasEngine(packs: [Fixtures.english]).search("kendrick lamar")
    let answer = try await client(transport).search("kendrick lamar")
    let response = try XCTUnwrap(answer)
    let calibration = response.calibration ?? .standard
    XCTAssertFalse(
      Confidence.assess(alias: alias, semantic: response.results, calibration: calibration).unsure)
    XCTAssertTrue(Confidence.assess(alias: alias, semantic: response.results).unsure)
  }

  func testThrowsOnHTTPErrors() async {
    let transport = StubTransport { _ in HTTPResponse(status: 429, body: Data("nope".utf8)) }
    do {
      _ = try await client(transport).search("x y z")
      XCTFail("expected an HTTP error")
    } catch let error as EmojisenseError {
      guard case .httpStatus(429, _) = error else { return XCTFail("unexpected \(error)") }
    } catch {
      XCTFail("unexpected \(error)")
    }
  }

  func testDecodesTheVerdictOfAnUnsureQueryAndCachesIt() async throws {
    let body = """
      {"packVersion":"test","cached":false,"unsure":true,"confidence":0.12,
       "results":[{"emoji":"🌋","id":"1F30B","score":0.4,"source":"semantic"}]}
      """
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(body.utf8)) }
    let client = client(transport)
    let response = try await client.search("kendrick lamar")
    _ = try await client.search("kendrick lamar")
    XCTAssertEqual(response?.unsure, true)
    XCTAssertEqual(response?.confidence, 0.12)
    XCTAssertEqual(response?.results.map(\.source), [.semantic])
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 1)
  }

  func testSkipsEmptyQueries() async throws {
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8)) }
    let response = try await client(transport).search("🚀 !!")
    XCTAssertNil(response)
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 0)
  }
}

/// Ports packages/core/test/shards.test.ts.
final class ShardProviderTests: XCTestCase {
  private static let files = [
    "index.json": """
    {"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256",
     "keys":["c","co","th","the "]}
    """,
    "co.json": """
    {"key":"co","entries":{"congrats on the launch":[["🚀","1F680",0.8],["🎉","1F389",0.7]]}}
    """,
    "the%20.json": #"{"key":"the ","entries":{"the office":[["🏢","1F3E2",0.6]]}}"#,
  ]

  func testPicksTheLongestMatchingPrefixKey() {
    let keys = ["c", "co", "th", "the "]
    XCTAssertEqual(ShardProvider.shardKey(for: "the office", keys: keys), "the ")
    XCTAssertEqual(ShardProvider.shardKey(for: "cat", keys: keys), "c")
    XCTAssertNil(ShardProvider.shardKey(for: "zebra", keys: keys))
  }

  func testAnswersFromAShardAndDownloadsEachShardOnce() async throws {
    let transport = StubTransport(files: Self.files)
    let provider = ShardProvider(baseURL: URL(string: "https://x.test/p/1/")!, transport: transport)

    let first = try await provider.search("Congrats  on the launch")
    XCTAssertEqual(first?.layer, .shard)
    XCTAssertEqual(first?.model, "m@256")
    XCTAssertEqual(first?.results.map(\.emoji), ["🚀", "🎉"])
    _ = try await provider.search("congrats on the launch")
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 2)

    let office = try await provider.search("the office")
    XCTAssertEqual(office?.results.first?.emoji, "🏢")
  }

  func testLeavesTextTypedWithAccentsPunctuationOrEmojiToTheAPI() async throws {
    let transport = StubTransport(files: Self.files)
    let provider = ShardProvider(baseURL: URL(string: "https://x.test/p/1")!, transport: transport)
    for typed in ["congrats on the launch!", "cöngrats on the launch", "congrats on the launch 🚀"] {
      let response = try await provider.search(typed)
      XCTAssertNil(response, typed)
    }
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 0)
    let upper = try await provider.search("CONGRATS on the launch")
    XCTAssertEqual(upper?.layer, .shard)
  }

  func testReturnsNilForUnknownQueriesSoTheNextLayerIsAsked() async throws {
    let shards = ShardProvider(
      baseURL: URL(string: "https://x.test/p/1")!, transport: StubTransport(files: Self.files))
    let apiTransport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8))
    }
    let api = SemanticClient(
      configuration: .init(endpoint: URL(string: "https://api.test")!), transport: apiTransport)
    let chain = ProviderChain([shards, api])

    let coffee = try await chain.search("coffee time")
    XCTAssertEqual(coffee?.layer, .api)
    let congrats = try await chain.search("congrats on the launch")
    XCTAssertEqual(congrats?.layer, .shard)
    let apiRequests = await apiTransport.requests.count
    XCTAssertEqual(apiRequests, 1)
  }

  func testTreatsNetworkFailuresAsNoAnswer() async throws {
    let provider = ShardProvider(
      baseURL: URL(string: "https://x.test/p/1")!,
      transport: StubTransport { _ in HTTPResponse(status: 500, body: Data()) })
    let response = try await provider.search("congrats")
    XCTAssertNil(response)
  }

  // MARK: Shards per locale

  private static let base = "https://x.test/p/1"
  private static let localeFiles = [
    "\(base)/index.json": files["index.json"]!,
    "\(base)/co.json": files["co.json"]!,
    "\(base)/tr/index.json": """
    {"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256",
     "keys":["co","dogum "]}
    """,
    "\(base)/tr/co.json": #"{"key":"co","entries":{"congrats on the launch":[["🎊","1F38A",0.9]]}}"#,
    "\(base)/tr/dogum%20.json": #"{"key":"dogum ","entries":{"dogum gunu":[["🎂","1F382",0.9]]}}"#,
  ]

  private func requestedURLs(_ transport: StubTransport) async -> [String] {
    await transport.requests.map(\.absoluteString)
  }

  func testUsesTheRootFilesForEnglishAndForNoLocale() async throws {
    let transport = StubTransport(urls: Self.localeFiles)
    let provider = ShardProvider(baseURL: URL(string: "\(Self.base)/")!, transport: transport)
    for locale in [nil, "en", "EN", "", "en-GB"] {
      let response = try await provider.search(
        "congrats on the launch", options: SemanticSearchOptions(locale: locale))
      XCTAssertEqual(response?.results.first?.emoji, "🚀", locale ?? "nil")
    }
    let requests = await requestedURLs(transport)
    XCTAssertEqual(requests, ["\(Self.base)/index.json", "\(Self.base)/co.json"])
  }

  func testAsksTheFolderOfAnyOtherLocaleInLowercase() async throws {
    let transport = StubTransport(urls: Self.localeFiles)
    let provider = ShardProvider(baseURL: URL(string: Self.base)!, transport: transport)
    let upper = try await provider.search("Dogum gunu", options: SemanticSearchOptions(locale: "TR"))
    XCTAssertEqual(upper?.layer, .shard)
    XCTAssertEqual(upper?.results.map(\.emoji), ["🎂"])
    let lower = try await provider.search("dogum gunu", options: SemanticSearchOptions(locale: "tr"))
    XCTAssertEqual(lower?.results.map(\.emoji), ["🎂"])
    // Only the language subtag counts, like the API's locale.
    let tagged = try await provider.search("dogum gunu", options: SemanticSearchOptions(locale: "tr-TR"))
    XCTAssertEqual(tagged?.results.map(\.emoji), ["🎂"])
    let requests = await requestedURLs(transport)
    XCTAssertEqual(requests, ["\(Self.base)/tr/index.json", "\(Self.base)/tr/dogum%20.json"])
  }

  func testKeepsTheIndexAndShardsOfEachLocaleApart() async throws {
    let transport = StubTransport(urls: Self.localeFiles)
    let provider = ShardProvider(baseURL: URL(string: Self.base)!, transport: transport)
    for _ in 0..<2 {
      let english = try await provider.search(
        "congrats on the launch", options: SemanticSearchOptions(locale: "en"))
      let turkish = try await provider.search(
        "congrats on the launch", options: SemanticSearchOptions(locale: "tr"))
      XCTAssertEqual(english?.results.first?.emoji, "🚀")
      XCTAssertEqual(turkish?.results.first?.emoji, "🎊")
    }
    let requests = await requestedURLs(transport)
    XCTAssertEqual(
      requests,
      [
        "\(Self.base)/index.json", "\(Self.base)/co.json", "\(Self.base)/tr/index.json",
        "\(Self.base)/tr/co.json",
      ])
  }

  func testGivesNoAnswerForALocaleWithoutShardsAndDoesNotAskAgain() async throws {
    let transport = StubTransport(urls: Self.localeFiles)
    let shards = ShardProvider(baseURL: URL(string: Self.base)!, transport: transport)
    let german = SemanticSearchOptions(locale: "de")
    let first = try await shards.search("congrats on the launch", options: german)
    let second = try await shards.search("congrats on the way", options: german)
    XCTAssertNil(first)
    XCTAssertNil(second)
    var requests = await requestedURLs(transport)
    XCTAssertEqual(requests, ["\(Self.base)/de/index.json"])

    let apiTransport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8))
    }
    let api = SemanticClient(
      configuration: .init(endpoint: URL(string: "https://api.test")!), transport: apiTransport)
    let chained = try await ProviderChain([shards, api]).search(
      "congrats on the launch", options: german)
    XCTAssertEqual(chained?.layer, .api)
    let english = try await shards.search("congrats on the launch")
    XCTAssertEqual(english?.layer, .shard)
    requests = await requestedURLs(transport)
    XCTAssertEqual(requests.filter { $0.hasSuffix("/de/index.json") }.count, 1)
  }
}

/// A clock the test moves by hand.
private final class TestClock: @unchecked Sendable {
  private let lock = NSLock()
  private var current = Date(timeIntervalSince1970: 0)

  var now: Date {
    lock.lock()
    defer { lock.unlock() }
    return current
  }

  func advance(by interval: TimeInterval) {
    lock.lock()
    defer { lock.unlock() }
    current = current.addingTimeInterval(interval)
  }
}
