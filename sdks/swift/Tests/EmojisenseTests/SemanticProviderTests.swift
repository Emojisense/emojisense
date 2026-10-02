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

  func testNormalizesTheQuerySendsTheKeyAndCaches() async throws {
    let transport = StubTransport { _ in HTTPResponse(status: 200, body: Data(semanticBody.utf8)) }
    let client = client(transport, key: "pk_1")
    let options = SemanticSearchOptions(locale: "en", limit: 5)
    let first = try await client.search("  Jurassic PARK!! ", options: options)
    _ = try await client.search("jurassic park", options: options)

    XCTAssertEqual(first?.layer, .api)
    XCTAssertEqual(first?.results.first?.emoji, "🌋")
    let requests = await transport.requests
    XCTAssertEqual(requests.count, 1)
    XCTAssertEqual(
      requests.first?.absoluteString,
      "https://api.test/v1/search?q=jurassic+park&locale=en&limit=5&mode=semantic&key=pk_1")
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

    let first = try await provider.search("Congrats on the launch!")
    XCTAssertEqual(first?.layer, .shard)
    XCTAssertEqual(first?.model, "m@256")
    XCTAssertEqual(first?.results.map(\.emoji), ["🚀", "🎉"])
    _ = try await provider.search("congrats on the launch")
    let requestCount = await transport.requests.count
    XCTAssertEqual(requestCount, 2)

    let office = try await provider.search("the office")
    XCTAssertEqual(office?.results.first?.emoji, "🏢")
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
