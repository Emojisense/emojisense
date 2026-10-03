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
      "https://api.test/v1/search?q=jurassic+park%21%21&locale=en&limit=5&mode=semantic&culture=0&key=pk_1")
  }

  func testEncodesAPlusLikeURLSearchParams() async throws {
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8)) }
    _ = try await client(transport).search("+1")
    let url = await transport.requests.first
    XCTAssertEqual(url?.query, "q=%2B1&locale=en&limit=24&mode=semantic&culture=0")
  }

  /// The session applies culture on the device, so the API must not; only "auto" is sent as a
  /// region, after `culture` and before `pack` and `key`, in the order of the reference.
  func testSendsCultureOffAndOnlyTheAutoRegion() async throws {
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8)) }
    let client = SemanticClient(
      configuration: .init(
        endpoint: URL(string: "https://api.test")!, key: "pk_1", packVersion: "0.1.0"),
      transport: transport)
    _ = try await client.search("volcano", options: SemanticSearchOptions(region: "AUTO"))
    _ = try await client.search("lava", options: SemanticSearchOptions(region: "BR"))
    let queries = await transport.requests.map(\.query)
    XCTAssertEqual(
      queries,
      [
        "q=volcano&locale=en&limit=24&mode=semantic&culture=0&region=auto&pack=0.1.0&key=pk_1",
        "q=lava&locale=en&limit=24&mode=semantic&culture=0&pack=0.1.0&key=pk_1",
      ])
  }

  func testDecodesTheRegionTheAPIFound() throws {
    let json = semanticBody.replacingOccurrences(
      of: #""cached":false"#, with: #""cached":false,"region":"DE","culture":null"#)
    let response = try JSONDecoder().decode(SemanticResponse.self, from: Data(json.utf8))
    XCTAssertEqual(response.region, "DE")
    let unknown = semanticBody.replacingOccurrences(
      of: #""cached":false"#, with: #""cached":false,"region":null"#)
    XCTAssertNil(try JSONDecoder().decode(SemanticResponse.self, from: Data(unknown.utf8)).region)
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
       "calibration":{"floor":0.35,"ceiling":0.53,"gapFloor":0.02,"gapCeiling":0.1}}
      """
    XCTAssertEqual(try decode(body).calibration, .standard)
    let withoutGap = body.replacingOccurrences(of: #","gapFloor":0.02,"gapCeiling":0.1"#, with: "")
    XCTAssertEqual(
      try decode(withoutGap).calibration, Fusion.SemanticCalibration(floor: 0.35, ceiling: 0.53))
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
    let shown = Fusion.fuse(alias: alias, semantic: semantic, limit: limit)
    let deep = Fusion.fuse(alias: alias, semantic: semantic, limit: depth)
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

  // MARK: Answers without waiting (client-session.test.ts)

  func testPeeksAtItsOwnMemoryOnly() async throws {
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8)) }
    let client = client(transport)
    XCTAssertNil(client.peek("volcano eruption"))
    _ = try await client.search("volcano eruption")

    let peeked = client.peek("volcano eruption")
    XCTAssertEqual(peeked?.cached, true)
    XCTAssertEqual(peeked?.layer, .api)
    XCTAssertEqual(peeked?.results.first?.emoji, "🌋")
    XCTAssertNil(client.peek("volcano eruption", options: SemanticSearchOptions(locale: "tr")))
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 1)
  }

  func testNeverPeeksAtAnOverLimitAnswer() async throws {
    let overLimit = semanticBody.replacingOccurrences(
      of: #""cached":false"#, with: #""cached":false,"overLimit":true"#)
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(overLimit.utf8)) }
    let client = client(transport, cooldown: 0)
    let response = try await client.search("lava eruption")
    XCTAssertNil(response)
    XCTAssertNil(client.peek("lava eruption"))
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
      let response = await provider.search(
        "congrats on the launch", options: SemanticSearchOptions(locale: locale))
      XCTAssertEqual(response?.results.first?.emoji, "🚀", locale ?? "nil")
    }
    let requests = await requestedURLs(transport)
    XCTAssertEqual(requests, ["\(Self.base)/index.json", "\(Self.base)/co.json"])
  }

  func testAsksTheFolderOfAnyOtherLocaleInLowercase() async throws {
    let transport = StubTransport(urls: Self.localeFiles)
    let provider = ShardProvider(baseURL: URL(string: Self.base)!, transport: transport)
    let upper = await provider.search("Dogum gunu", options: SemanticSearchOptions(locale: "TR"))
    XCTAssertEqual(upper?.layer, .shard)
    XCTAssertEqual(upper?.results.map(\.emoji), ["🎂"])
    let lower = await provider.search("dogum gunu", options: SemanticSearchOptions(locale: "tr"))
    XCTAssertEqual(lower?.results.map(\.emoji), ["🎂"])
    // Only the language subtag counts, like the API's locale.
    let tagged = await provider.search("dogum gunu", options: SemanticSearchOptions(locale: "tr-TR"))
    XCTAssertEqual(tagged?.results.map(\.emoji), ["🎂"])
    let requests = await requestedURLs(transport)
    XCTAssertEqual(requests, ["\(Self.base)/tr/index.json", "\(Self.base)/tr/dogum%20.json"])
  }

  func testKeepsTheIndexAndShardsOfEachLocaleApart() async throws {
    let transport = StubTransport(urls: Self.localeFiles)
    let provider = ShardProvider(baseURL: URL(string: Self.base)!, transport: transport)
    for _ in 0..<2 {
      let english = await provider.search(
        "congrats on the launch", options: SemanticSearchOptions(locale: "en"))
      let turkish = await provider.search(
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
    let first = await shards.search("congrats on the launch", options: german)
    let second = await shards.search("congrats on the way", options: german)
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

  // MARK: Hashed files and the base layer

  /// Live English index with hashed files and a base index. The base files are in f/ as well.
  /// The Turkish index names its file and the same base index with "../f/".
  private static let layeredFiles = [
    "\(base)/index.json": """
    {"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256",
     "keys":["co"],"files":{"co":"f/live-co.json"},"base":"f/base-en.json"}
    """,
    "\(base)/f/live-co.json": files["co.json"]!,
    "\(base)/f/base-en.json": """
    {"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256",
     "keys":["th"],"files":{"th":"base-th.json"}}
    """,
    "\(base)/f/base-th.json": #"{"key":"th","entries":{"thank you so much":[["🙏","1F64F",0.9]]}}"#,
    "\(base)/tr/index.json": """
    {"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256",
     "keys":["do"],"files":{"do":"../f/tr-do.json"},"base":"../f/base-en.json"}
    """,
    "\(base)/f/tr-do.json": #"{"key":"do","entries":{"dogum gunu":[["🎂","1F382",0.9]]}}"#,
  ]

  private func layeredProvider(
    _ transport: StubTransport, now: @escaping @Sendable () -> Date = { Date() }
  ) -> ShardProvider {
    ShardProvider(baseURL: URL(string: Self.base)!, transport: transport, retryDelay: 10, now: now)
  }

  /// The requested paths below the base URL.
  private func paths(_ transport: StubTransport) async -> [String] {
    await requestedURLs(transport).map { String($0.dropFirst(Self.base.count + 1)) }
  }

  func testResolvesPathsAgainstTheIndexURL() {
    let resolve = { (path: String, index: String) in
      ShardProvider.resolve(path, against: URL(string: index)!)?.absoluteString
    }
    XCTAssertEqual(resolve("f/a.json", "https://x/p/1/index.json"), "https://x/p/1/f/a.json")
    XCTAssertEqual(resolve("../f/a.json", "https://x/p/1/tr/index.json"), "https://x/p/1/f/a.json")
    XCTAssertEqual(resolve("b.json", "https://x/p/1/f/a.json"), "https://x/p/1/f/b.json")
    XCTAssertEqual(resolve("the%20.json", "https://x/p/1/index.json"), "https://x/p/1/the%20.json")
  }

  func testReadsTheFilesTheIndexNamesThenTheBaseLayer() async throws {
    let transport = StubTransport(urls: Self.layeredFiles)
    let provider = layeredProvider(transport)
    let congrats = await provider.search("congrats on the launch", options: .init())
    XCTAssertEqual(congrats?.results.first?.emoji, "🚀")
    let thanks = await provider.search("thank you so much", options: .init())
    XCTAssertEqual(thanks?.results.first?.emoji, "🙏")
    XCTAssertEqual(thanks?.layer, .shard)
    let unknown = await provider.search("thanks a lot", options: .init())
    XCTAssertNil(unknown)
    let requested = await paths(transport)
    XCTAssertEqual(requested, ["index.json", "f/base-en.json", "f/live-co.json", "f/base-th.json"])
  }

  func testResolvesPathsRelativeToALocaleDirectory() async throws {
    let transport = StubTransport(urls: Self.layeredFiles)
    let provider = layeredProvider(transport)
    let turkish = SemanticSearchOptions(locale: "tr")
    let birthday = await provider.search("dogum gunu", options: turkish)
    XCTAssertEqual(birthday?.results.map(\.emoji), ["🎂"])
    let thanks = await provider.search("thank you so much", options: turkish)
    XCTAssertEqual(thanks?.layer, .shard)
    // English names the same base index, so it is not downloaded again.
    let english = await provider.search("thank you so much", options: .init())
    XCTAssertEqual(english?.results.first?.emoji, "🙏")
    let requested = await paths(transport)
    XCTAssertEqual(
      requested,
      ["tr/index.json", "f/base-en.json", "f/tr-do.json", "f/base-th.json", "index.json"])
  }

  func testPeeksOnlyAtWhatIsLoadedAndPrefetchLoadsIt() async throws {
    let transport = StubTransport(urls: Self.layeredFiles)
    let provider = layeredProvider(transport)
    XCTAssertNil(provider.peek("thank you so much"))
    var requested = await paths(transport)
    XCTAssertEqual(requested, [])

    provider.prefetch("thank you", locale: nil)
    await waitUntil { provider.peek("thank you so much") != nil }
    XCTAssertEqual(provider.peek("thank you so much")?.results.first?.emoji, "🙏")
    XCTAssertEqual(provider.peek("thank you so much")?.layer, .shard)
    let none = provider.peek("thank you so much", options: SemanticSearchOptions(limit: 0))
    XCTAssertEqual(none?.results, [])
    XCTAssertNil(provider.peek("thank you!"))
    requested = await paths(transport)
    XCTAssertEqual(requested, ["index.json", "f/base-en.json", "f/base-th.json"])
  }

  func testPrefetchesTheIndexesOnlyForAnEmptyQuery() async throws {
    let transport = StubTransport(urls: Self.layeredFiles)
    let provider = layeredProvider(transport)
    provider.prefetch("", locale: "tr")
    await waitUntil { await transport.requests.count >= 2 }
    // The search that follows needs only its shard.
    let birthday = await provider.search("dogum gunu", options: SemanticSearchOptions(locale: "tr"))
    XCTAssertEqual(birthday?.layer, .shard)
    let requested = await paths(transport)
    XCTAssertEqual(requested, ["tr/index.json", "f/base-en.json", "f/tr-do.json"])
  }

  func testAsksAgainAfterANetworkErrorButNotAfterA404() async throws {
    let transport = StubTransport(urls: Self.layeredFiles)
    await transport.failOnce("\(Self.base)/index.json")
    await transport.failOnce("\(Self.base)/f/live-co.json")
    let clock = TestClock()
    let provider = layeredProvider(transport, now: { clock.now })
    let congrats = "congrats on the launch"

    let first = await provider.search(congrats, options: .init())
    XCTAssertNil(first)
    // Within the retry delay, an unreachable host is not asked again.
    let second = await provider.search(congrats, options: .init())
    XCTAssertNil(second)
    clock.advance(by: 11)
    let third = await provider.search(congrats, options: .init())
    XCTAssertNil(third)
    clock.advance(by: 11)
    let fourth = await provider.search(congrats, options: .init())
    XCTAssertEqual(fourth?.layer, .shard)

    let german = SemanticSearchOptions(locale: "de")
    let missing = await provider.search("thanks", options: german)
    XCTAssertNil(missing)
    clock.advance(by: 11)
    let stillMissing = await provider.search("thanks", options: german)
    XCTAssertNil(stillMissing)

    let requested = await paths(transport)
    XCTAssertEqual(requested.filter { $0 == "index.json" }.count, 2)
    XCTAssertEqual(requested.filter { $0 == "f/live-co.json" }.count, 2)
    XCTAssertEqual(requested.filter { $0 == "de/index.json" }.count, 1)
  }

  func testTreatsAnIndexWithoutAKeysArrayAsNoIndex() async throws {
    var files = Self.layeredFiles
    files["\(Self.base)/index.json"] = """
      {"format":"emojisense-shards","formatVersion":1,"packVersion":"t","model":"m@256","keys":"co"}
      """
    files["\(Self.base)/tr/index.json"] = "<!doctype html><title>Not found</title>"
    let transport = StubTransport(urls: files)
    let provider = layeredProvider(transport)
    for _ in 0..<2 {
      let english = await provider.search("congrats on the launch", options: .init())
      XCTAssertNil(english)
      let turkish = await provider.search(
        "dogum gunu", options: SemanticSearchOptions(locale: "tr"))
      XCTAssertNil(turkish)
    }
    XCTAssertNil(provider.peek("congrats on the launch"))
    let requested = await paths(transport)
    XCTAssertEqual(requested, ["index.json", "tr/index.json"])
  }

  func testKeepsTheLiveLayerWhenTheBaseIndexIsNotValid() async throws {
    var files = Self.layeredFiles
    files["\(Self.base)/f/base-en.json"] = #"{"keys":null}"#
    let provider = layeredProvider(StubTransport(urls: files))
    let congrats = await provider.search("congrats on the launch", options: .init())
    XCTAssertEqual(congrats?.results.first?.emoji, "🚀")
    let thanks = await provider.search("thank you so much", options: .init())
    XCTAssertNil(thanks)
  }

  func testAChainPeeksAndPrefetchesThroughItsProviders() async throws {
    let shards = layeredProvider(StubTransport(urls: Self.layeredFiles))
    let apiTransport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8))
    }
    let api = SemanticClient(
      configuration: .init(endpoint: URL(string: "https://api.test")!), transport: apiTransport)
    let chain = ProviderChain([shards, api])

    XCTAssertNil(chain.peek("coffee time"))
    _ = try await chain.search("coffee time")
    XCTAssertEqual(chain.peek("coffee time")?.layer, .api)

    XCTAssertNil(chain.peek("thank you so much"))
    chain.prefetch("thank you", locale: nil)
    await waitUntil { chain.peek("thank you so much") != nil }
    XCTAssertEqual(chain.peek("thank you so much")?.layer, .shard)
    let apiRequests = await apiTransport.requests.count
    XCTAssertEqual(apiRequests, 1)
  }
}

/// Waits until `condition` holds, for work that `prefetch` starts in the background (at most 2 s).
private func waitUntil(_ condition: () async -> Bool) async {
  for _ in 0..<400 {
    if await condition() { return }
    try? await Task.sleep(nanoseconds: 5_000_000)
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
