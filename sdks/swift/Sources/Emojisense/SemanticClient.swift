import Foundation

/// The HTTP API as a semantic provider (layer `api`): `GET /v1/search?mode=semantic`.
///
/// Over its plan limit the API still answers from its shared cache. For other queries it answers
/// `overLimit: true`, and search continues on the alias dictionary and shards. Never a hard failure.
public actor SemanticClient: SemanticProvider {
  public struct Configuration: Sendable {
    /// Base URL of the Emojisense API, e.g. `https://api.emojisense.com`.
    public var endpoint: URL
    /// Publishable key (`pk_…`), sent as the `key` query parameter.
    public var key: String?
    /// Pin a data pack version so results match the client's alias pack.
    public var packVersion: String?
    /// In-memory LRU of recent responses.
    public var cacheSize: Int
    /// After an over-limit answer, skip the API for this long. Default 0: keep asking, because
    /// the edge still answers queries that are in its shared cache. Over-limit misses are remembered.
    public var overLimitCooldown: TimeInterval

    public init(
      endpoint: URL, key: String? = nil, packVersion: String? = nil, cacheSize: Int = 200,
      overLimitCooldown: TimeInterval = 0
    ) {
      self.endpoint = endpoint
      self.key = key
      self.packVersion = packVersion
      self.cacheSize = cacheSize
      self.overLimitCooldown = overLimitCooldown
    }
  }

  private let configuration: Configuration
  private let transport: any HTTPTransport
  private let now: @Sendable () -> Date
  private var cache: LRUCache<String, SemanticResponse>
  private var pausedUntil = Date.distantPast

  public init(
    configuration: Configuration, transport: any HTTPTransport = URLSessionTransport(),
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.configuration = configuration
    self.transport = transport
    self.now = now
    cache = LRUCache(capacity: configuration.cacheSize)
  }

  /// Returns `nil` for an empty query and while paused after an over-limit answer.
  /// Throws ``EmojisenseError/httpStatus(_:url:)`` for HTTP errors.
  public func search(_ query: String, options: SemanticSearchOptions) async throws
    -> SemanticResponse?
  {
    if Normalizer.normalize(query).isEmpty || now() < pausedUntil { return nil }

    // The text the API embeds, accents and punctuation kept (`normalize` would fold them).
    let url = try requestURL(query: Normalizer.embeddingText(query), options: options)
    if let hit = cache.value(forKey: url.absoluteString) { return hit.overLimit ? nil : hit }

    let response = try await transport.get(url)
    guard response.isSuccess else { throw EmojisenseError.httpStatus(response.status, url: url) }
    var body = try JSONDecoder().decode(SemanticResponse.self, from: response.body)
    body.layer = .api
    // A concept answer still pending (or not available now) is not final: ask the API again.
    if body.concept?.status.isFinal ?? true { cache.insert(body, forKey: url.absoluteString) }
    if body.overLimit {
      pausedUntil = now().addingTimeInterval(configuration.overLimitCooldown)
      return nil
    }
    return body
  }

  /// The client fuses with its own alias results, so it asks for semantic results only.
  private func requestURL(query: String, options: SemanticSearchOptions) throws -> URL {
    var parameters = [
      ("q", query), ("locale", options.locale ?? "en"), ("limit", String(options.limit)),
      ("mode", "semantic"),
    ]
    if let packVersion = configuration.packVersion { parameters.append(("pack", packVersion)) }
    if let key = configuration.key { parameters.append(("key", key)) }
    let base = URLEncoding.trimmingTrailingSlashes(configuration.endpoint)
    return try URLEncoding.url("\(base)/v1/search?\(URLEncoding.formEncoded(parameters))")
  }
}
