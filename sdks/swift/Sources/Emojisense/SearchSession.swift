import Foundation

public enum SessionStatus: String, Sendable {
  /// The query is empty after normalization.
  case idle
  /// Alias results only: the semantic tier was not needed, or it had no answer.
  case alias
  /// Alias results now; a semantic request is waiting or running.
  case loading
  /// Alias and semantic results, fused.
  case fused
  /// The semantic request failed; ``SessionState/results`` holds the alias results.
  case error
}

public struct SessionState: Sendable {
  public var query: String
  /// What to show: the ranking, plus culture results after its top result when the session has
  /// a culture file (``SearchResult/source`` is ``ResultSource/culture``).
  public var results: [SearchResult]
  /// The canonical alias output (no culture results).
  public var alias: AliasSearchOutput
  public var status: SessionStatus
  /// Time spent in the alias engine for this query.
  public var aliasDuration: Duration
  /// Round-trip time of the semantic request, when one finished. Zero for an answer in memory.
  public var semanticDuration: Duration?
  public var semanticCached: Bool?
  /// Which layer gave the semantic results.
  public var layer: SemanticLayer?
  public var error: (any Error)?
  /// No tier understood the query (``Confidence/assess(alias:semantic:calibration:)``): the
  /// dictionary does not cover it and the semantic list is flat or low. While
  /// ``SessionStatus/loading``, the dictionary's verdict alone. Show the results as guesses.
  public var unsure: Bool
  /// 0–1: how well the best tier understood the query.
  public var confidence: Double

  public init(
    query: String, results: [SearchResult], alias: AliasSearchOutput, status: SessionStatus,
    aliasDuration: Duration = .zero, semanticDuration: Duration? = nil,
    semanticCached: Bool? = nil, layer: SemanticLayer? = nil, error: (any Error)? = nil,
    unsure: Bool = false, confidence: Double = 0
  ) {
    self.query = query
    self.results = results
    self.alias = alias
    self.status = status
    self.aliasDuration = aliasDuration
    self.semanticDuration = semanticDuration
    self.semanticCached = semanticCached
    self.layer = layer
    self.error = error
    self.unsure = unsure
    self.confidence = confidence
  }
}

/// Search controller, like `createSearchSession` in packages/core: alias results on every
/// keystroke, then semantic results fused in. When a provider has the answer in memory (a loaded
/// shard, ``SemanticProvider/peek(_:options:)``), the fused results arrive at once, with no
/// debounce and no request. Otherwise the session calls ``SemanticProvider/prefetch(_:locale:)``
/// (the query's shard), waits for the debounce and asks the provider. A newer query cancels the
/// older request, so stale answers never arrive. The session also calls `prefetch` when it is
/// created (the shard indexes).
///
/// The culture layer is applied last, after fusion, so the canonical top result stays first.
///
/// `onChange` runs synchronously in ``update(_:)`` for the alias results and for answers in
/// memory, and on a background task for requested answers. The calls never overlap and come in
/// order: an answer for an older query never follows a newer query's results. For UI, hop to the
/// main actor the same way in every call, e.g. `Task { @MainActor in model.state = state }`. Keep
/// `onChange` short, and never wait in it for the thread that calls `update`.
public final class SearchSession: Sendable {
  private let engine: AliasEngine
  private let semantic: (any SemanticProvider)?
  private let locale: String?
  private let locales: [String]?
  private let limit: Int
  private let debounce: Duration
  private let shouldUseSemantic: @Sendable (AliasSearchOutput) -> Bool
  private let culture: Culture?
  /// The region option is "auto": learn the region from the first API answer that has one.
  private let learnsRegion: Bool
  /// The region of the culture layer, unless `learnsRegion`.
  private let fixedRegion: String?
  private let now: @Sendable () -> Date
  private let onChange: @Sendable (SessionState) -> Void
  /// Held while a state is made and delivered, so that `onChange` calls never overlap and a
  /// stale answer is never delivered after a newer update. Recursive: `onChange` may call
  /// `update`.
  private let delivery = NSRecursiveLock()
  private let progress = Locked(Progress())

  private struct Progress {
    /// Incremented by every update and cancel; an answer for an older one is dropped.
    var generation: UInt64 = 0
    var task: Task<Void, Never>?
    /// With region "auto": the region of the first API answer that reported one.
    var learnedRegion: String?
  }

  /// What one update knows before the semantic answer.
  private struct Update: Sendable {
    let query: String
    let alias: AliasSearchOutput
    let aliasDuration: Duration
    /// The canonical alias results, cut to the limit.
    let shown: [SearchResult]
  }

  /// A session with the engine's culture file (``AliasEngine/culture``).
  ///
  /// - Parameters:
  ///   - semantic: `nil` for alias-only (fully offline) search. Use ``ProviderChain`` (shards,
  ///     then API) for layers.
  ///   - locales: The user's languages (``AliasSearchOptions/locales``): only phrases of these
  ///     loaded locales match. English and `locale` always count. `nil`: every loaded pack.
  ///   - debounce: Delay before a semantic request, after the last keystroke.
  ///   - region: ISO 3166-1 alpha-2 region for regional culture entries, e.g. "BR". `nil` (or
  ///     "device"): the device's region, from its locale or else its time zone
  ///     (``CultureLayer/resolveRegion(_:culture:)``). "": none, only the entries for every
  ///     region. "auto": the region the API reports for the caller's country (`region=auto`),
  ///     learned from the first API answer that has one. A region code stays on the device.
  ///   - now: The clock that culture windows are checked against (its local day), on every
  ///     update, so a long-lived session follows the day.
  public convenience init(
    engine: AliasEngine, semantic: (any SemanticProvider)? = nil, locale: String? = nil,
    locales: [String]? = nil, limit: Int = 24, debounce: Duration = .milliseconds(200),
    shouldUseSemantic: @escaping @Sendable (AliasSearchOutput) -> Bool = Fusion
      .shouldUseSemantic,
    region: String? = nil, now: @escaping @Sendable () -> Date = { Date() },
    onChange: @escaping @Sendable (SessionState) -> Void
  ) {
    self.init(
      engine: engine, semantic: semantic, locale: locale, locales: locales, limit: limit,
      debounce: debounce, shouldUseSemantic: shouldUseSemantic, culture: engine.culture,
      region: region, now: now, onChange: onChange)
  }

  /// A session with another culture file, or with none (`culture: nil`, for reproducible
  /// ranking). The other parameters are those of
  /// ``init(engine:semantic:locale:locales:limit:debounce:shouldUseSemantic:region:now:onChange:)``.
  public init(
    engine: AliasEngine, semantic: (any SemanticProvider)? = nil, locale: String? = nil,
    locales: [String]? = nil, limit: Int = 24, debounce: Duration = .milliseconds(200),
    shouldUseSemantic: @escaping @Sendable (AliasSearchOutput) -> Bool = Fusion
      .shouldUseSemantic,
    culture: Culture?, region: String? = nil, now: @escaping @Sendable () -> Date = { Date() },
    onChange: @escaping @Sendable (SessionState) -> Void
  ) {
    self.engine = engine
    self.semantic = semantic
    self.locale = locale
    self.locales = locales
    self.limit = limit
    self.debounce = debounce
    self.shouldUseSemantic = shouldUseSemantic
    self.culture = culture
    learnsRegion = isAutoRegion(region)
    fixedRegion = learnsRegion ? nil : CultureLayer.resolveRegion(region, culture: culture)
    self.now = now
    self.onChange = onChange
    // The shard indexes load while the user starts typing, which also opens the connection.
    semantic?.prefetch("", locale: locale)
  }

  deinit {
    progress.withLock { $0.task?.cancel() }
  }

  /// Call on every keystroke. The alias results (or an answer in memory) are delivered before it
  /// returns.
  public func update(_ query: String) {
    delivery.lock()
    defer { delivery.unlock() }
    let generation = progress.withLock { progress in
      progress.task?.cancel()
      progress.task = nil
      progress.generation &+= 1
      return progress.generation
    }
    // Fusion sees the same candidates whatever the limit (rankDepth); the results are cut to it.
    let depth = max(limit, Fusion.rankDepth)
    let clock = ContinuousClock()
    let started = clock.now
    let alias = engine.canonicalSearch(
      query, options: AliasSearchOptions(limit: depth, locale: locale, locales: locales))
    let update = Update(
      query: query, alias: alias, aliasDuration: started.duration(to: clock.now),
      shown: alias.results.prefix(max(0, limit)).map(\.searchResult))
    let wantsSemantic = semantic != nil && shouldUseSemantic(alias)
    let request = SemanticSearchOptions(
      locale: locale, limit: depth, region: learnsRegion ? autoRegion : nil)

    // A loaded shard (or an answer this session already had) needs no debounce: no request.
    if wantsSemantic, let peeked = semantic?.peek(query, options: request) {
      onChange(fusedState(update, peeked, semanticDuration: .zero))
      return
    }
    let status: SessionStatus = alias.tokens.isEmpty ? .idle : wantsSemantic ? .loading : .alias
    onChange(aliasState(update, status: status))
    // `onChange` may have called `update` with a newer query.
    guard wantsSemantic, let semantic, isCurrent(generation) else { return }
    // The query's shard loads during the debounce, so the next keystroke can peek at it.
    semantic.prefetch(query, locale: locale)

    let task = Task { [weak self, debounce] in
      do {
        try await Task.sleep(for: debounce)
      } catch {
        return
      }
      let requested = ContinuousClock.now
      let outcome: Result<SemanticResponse?, any Error>
      do {
        outcome = .success(try await semantic.search(query, options: request))
      } catch {
        outcome = .failure(error)
      }
      self?.deliver(
        outcome, for: update, generation: generation, semanticDuration: requested.duration(to: .now)
      )
    }
    progress.withLock { $0.task = task }
  }

  /// Cancels the pending semantic request; its answer is not delivered. Call when the search UI
  /// goes away.
  public func cancel() {
    progress.withLock { progress in
      progress.task?.cancel()
      progress.task = nil
      progress.generation &+= 1
    }
  }

  private func isCurrent(_ generation: UInt64) -> Bool {
    progress.withLock { $0.generation == generation }
  }

  private func deliver(
    _ outcome: Result<SemanticResponse?, any Error>, for update: Update, generation: UInt64,
    semanticDuration: Duration
  ) {
    delivery.lock()
    defer { delivery.unlock() }
    guard !Task.isCancelled, isCurrent(generation) else { return }
    switch outcome {
    case .success(let response?):
      if learnsRegion, let region = response.region {
        progress.withLock { $0.learnedRegion = $0.learnedRegion ?? region }
      }
      onChange(fusedState(update, response, semanticDuration: semanticDuration))
    case .success(nil):
      // No layer had an answer (or the key is over its limit): the alias results stand.
      onChange(aliasState(update, status: .alias))
    case .failure(let error):
      onChange(aliasState(update, status: .error, error: error))
    }
  }

  private func aliasState(_ update: Update, status: SessionStatus, error: (any Error)? = nil)
    -> SessionState
  {
    let verdict = Confidence.assess(alias: update.alias, semantic: nil)
    return SessionState(
      query: update.query, results: present(update.shown, query: update.query),
      alias: update.alias, status: status, aliasDuration: update.aliasDuration, error: error,
      unsure: verdict.unsure, confidence: verdict.confidence)
  }

  private func fusedState(
    _ update: Update, _ response: SemanticResponse, semanticDuration: Duration
  ) -> SessionState {
    // The model that scored the results knows its calibration; older servers send none.
    let calibration = response.calibration ?? .standard
    let verdict = Confidence.assess(
      alias: update.alias, semantic: response.results, calibration: calibration)
    let fused = Fusion.fuse(
      alias: update.alias, semantic: response.results, limit: limit, calibration: calibration)
    return SessionState(
      query: update.query, results: present(fused, query: update.query), alias: update.alias,
      status: .fused, aliasDuration: update.aliasDuration, semanticDuration: semanticDuration,
      semanticCached: response.cached, layer: response.layer, unsure: verdict.unsure,
      confidence: verdict.confidence)
  }

  private func present(_ results: [SearchResult], query: String) -> [SearchResult] {
    guard let culture else { return results }
    let region = learnsRegion ? progress.withLock { $0.learnedRegion } : fixedRegion
    return CultureLayer.applyCulture(
      results, culture: culture, query: query, region: region, now: now(), limit: limit,
      engine: engine, locale: locale)
  }
}
