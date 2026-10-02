/// Where a semantic answer came from (docs/ARCHITECTURE.md, layers).
public enum SemanticLayer: String, Codable, Sendable {
  case device
  case shard
  case api
}

public struct SemanticResponse: Codable, Equatable, Sendable {
  public var results: [SearchResult]
  public var packVersion: String
  public var model: String?
  public var cached: Bool
  /// Server: Workers AI was unavailable, results are alias-only.
  public var degraded: Bool
  /// Server: the key is over its monthly limit; no semantic results until the next period.
  public var overLimit: Bool
  /// Server: 0–1, how well its tiers understood the query.
  public var confidence: Double?
  /// Server: no tier understood the query (``Confidence/assess(alias:semantic:calibration:)``
  /// with its own dictionary).
  public var unsure: Bool?
  /// Set by the provider that answered.
  public var layer: SemanticLayer?

  public init(
    results: [SearchResult], packVersion: String, model: String? = nil, cached: Bool,
    degraded: Bool = false, overLimit: Bool = false, confidence: Double? = nil,
    unsure: Bool? = nil, layer: SemanticLayer? = nil
  ) {
    self.results = results
    self.packVersion = packVersion
    self.model = model
    self.cached = cached
    self.degraded = degraded
    self.overLimit = overLimit
    self.confidence = confidence
    self.unsure = unsure
    self.layer = layer
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    results = try container.decode([SearchResult].self, forKey: .results)
    packVersion = try container.decode(String.self, forKey: .packVersion)
    model = try container.decodeIfPresent(String.self, forKey: .model)
    cached = try container.decodeIfPresent(Bool.self, forKey: .cached) ?? false
    degraded = try container.decodeIfPresent(Bool.self, forKey: .degraded) ?? false
    overLimit = try container.decodeIfPresent(Bool.self, forKey: .overLimit) ?? false
    confidence = try container.decodeIfPresent(Double.self, forKey: .confidence)
    unsure = try container.decodeIfPresent(Bool.self, forKey: .unsure)
    layer = try container.decodeIfPresent(SemanticLayer.self, forKey: .layer)
  }
}

public struct SemanticSearchOptions: Sendable {
  /// Default: the provider's default ("en" for the API).
  public var locale: String?
  public var limit: Int

  public init(locale: String? = nil, limit: Int = 24) {
    self.locale = locale
    self.limit = limit
  }
}

/// A source of semantic results: precomputed shards, the HTTP API, or (later) an on-device model.
/// `nil` means "no answer here": the next provider is tried, and with none left the caller keeps
/// its alias results. Cancel the surrounding task to abandon a search.
public protocol SemanticProvider: Sendable {
  func search(_ query: String, options: SemanticSearchOptions) async throws -> SemanticResponse?
}

extension SemanticProvider {
  public func search(_ query: String) async throws -> SemanticResponse? {
    try await search(query, options: SemanticSearchOptions())
  }
}

/// Tries providers in order (cheapest first, e.g. shards then API); the first answer wins.
public struct ProviderChain: SemanticProvider {
  public let providers: [any SemanticProvider]

  public init(_ providers: [any SemanticProvider]) {
    self.providers = providers
  }

  public func search(_ query: String, options: SemanticSearchOptions) async throws
    -> SemanticResponse?
  {
    for provider in providers {
      if Task.isCancelled { return nil }
      if let response = try await provider.search(query, options: options) { return response }
    }
    return nil
  }
}
