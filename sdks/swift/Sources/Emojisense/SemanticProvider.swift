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
  /// Server: the calibration of the model that scored `results`. Pass it to
  /// ``Fusion/fuse(alias:semantic:limit:calibration:ranking:)`` and
  /// ``Confidence/assess(alias:semantic:calibration:)``, so a model change on the server needs no
  /// client update. `nil` (older servers): use ``Fusion/SemanticCalibration/standard``.
  public var calibration: Fusion.SemanticCalibration?
  /// Answered from a cache: the server's shared one, or the client's own memory.
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
  /// Server, after a request with `region=auto` (``SemanticSearchOptions/region``): the caller's
  /// country as the API's edge saw it. `nil` when unknown.
  public var region: String?

  public init(
    results: [SearchResult], packVersion: String, model: String? = nil,
    calibration: Fusion.SemanticCalibration? = nil, cached: Bool, degraded: Bool = false,
    overLimit: Bool = false, confidence: Double? = nil, unsure: Bool? = nil,
    layer: SemanticLayer? = nil, region: String? = nil
  ) {
    self.results = results
    self.packVersion = packVersion
    self.model = model
    self.calibration = calibration
    self.cached = cached
    self.degraded = degraded
    self.overLimit = overLimit
    self.confidence = confidence
    self.unsure = unsure
    self.layer = layer
    self.region = region
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    results = try container.decode([SearchResult].self, forKey: .results)
    packVersion = try container.decode(String.self, forKey: .packVersion)
    model = try container.decodeIfPresent(String.self, forKey: .model)
    calibration = try container.decodeIfPresent(
      Fusion.SemanticCalibration.self, forKey: .calibration)
    cached = try container.decodeIfPresent(Bool.self, forKey: .cached) ?? false
    degraded = try container.decodeIfPresent(Bool.self, forKey: .degraded) ?? false
    overLimit = try container.decodeIfPresent(Bool.self, forKey: .overLimit) ?? false
    confidence = try container.decodeIfPresent(Double.self, forKey: .confidence)
    unsure = try container.decodeIfPresent(Bool.self, forKey: .unsure)
    layer = try container.decodeIfPresent(SemanticLayer.self, forKey: .layer)
    region = try container.decodeIfPresent(String.self, forKey: .region)
  }
}

public struct SemanticSearchOptions: Sendable {
  /// Default: the provider's default ("en" for the API).
  public var locale: String?
  public var limit: Int
  /// "auto" asks the API for the caller's region (`region=auto`, from the request's country),
  /// which it returns in ``SemanticResponse/region``. Only "auto" is sent: a region code stays
  /// on the device.
  public var region: String?

  public init(locale: String? = nil, limit: Int = 24, region: String? = nil) {
    self.locale = locale
    self.limit = limit
    self.region = region
  }
}

/// The region value that asks the API for the caller's region.
let autoRegion = "auto"

/// True for "auto" in any case.
func isAutoRegion(_ region: String?) -> Bool {
  region?.lowercased() == autoRegion
}

/// A source of semantic results: precomputed shards, the HTTP API, or (later) an on-device model.
/// `nil` means "no answer here": the next provider is tried, and with none left the caller keeps
/// its alias results. Cancel the surrounding task to abandon a search.
public protocol SemanticProvider: Sendable {
  func search(_ query: String, options: SemanticSearchOptions) async throws -> SemanticResponse?

  /// The answer that is already in memory, without I/O: a loaded shard, or a response this client
  /// received before. Show it at once, with no debounce. The default returns `nil`.
  func peek(_ query: String, options: SemanticSearchOptions) -> SemanticResponse?

  /// Starts to load what ``peek(_:options:)`` needs for this query (a shard index, the query's
  /// shard), so that it is there by the next keystroke. An empty query loads the indexes only.
  /// Returns at once and never fails. The default does nothing.
  func prefetch(_ query: String, locale: String?)
}

extension SemanticProvider {
  public func search(_ query: String) async throws -> SemanticResponse? {
    try await search(query, options: SemanticSearchOptions())
  }

  public func peek(_ query: String, options: SemanticSearchOptions) -> SemanticResponse? {
    nil
  }

  public func peek(_ query: String) -> SemanticResponse? {
    peek(query, options: SemanticSearchOptions())
  }

  public func prefetch(_ query: String, locale: String?) {}
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

  /// The first answer in memory, in provider order.
  public func peek(_ query: String, options: SemanticSearchOptions) -> SemanticResponse? {
    for provider in providers {
      if let response = provider.peek(query, options: options) { return response }
    }
    return nil
  }

  public func prefetch(_ query: String, locale: String?) {
    for provider in providers { provider.prefetch(query, locale: locale) }
  }
}
