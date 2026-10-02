import Foundation

#if canImport(CryptoKit)
  import CryptoKit
#endif

/// `manifest.json` of a pack version (PACK_FORMAT.md §1).
public struct Manifest: Sendable {
  public static let format = "emojisense-manifest"

  public struct File: Codable, Sendable {
    /// Lowercase hex SHA-256 of the raw file bytes.
    public var sha256: String
    public var bytes: Int
    public var gzipBytes: Int
    public var locale: String?
    public var model: String?
    public var dims: Int?
    /// The exact string to embed for a query; `{q}` stands for the normalized query.
    public var queryTemplate: String?
  }

  public var packVersion: String
  public var emojiVersion: String
  public var emojiCount: Int
  public var files: [String: File]
}

extension Manifest: Decodable {
  private enum CodingKeys: String, CodingKey {
    case format, formatVersion, packVersion, emojiVersion, emojiCount, files
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let format = try container.decodeIfPresent(String.self, forKey: .format)
    guard format == Self.format else {
      throw EmojisenseError.invalidFormat(expected: Self.format, found: format)
    }
    let version = try container.decode(Int.self, forKey: .formatVersion)
    guard version == 1 else {
      throw EmojisenseError.unsupportedFormatVersion(format: Self.format, version: version)
    }
    packVersion = try container.decode(String.self, forKey: .packVersion)
    emojiVersion = try container.decode(String.self, forKey: .emojiVersion)
    emojiCount = try container.decode(Int.self, forKey: .emojiCount)
    files = try container.decode([String: File].self, forKey: .files)
  }
}

/// Downloads the packs of one pack version, e.g. `https://api.emojisense.com/v1/pack/0.1.0`.
/// Files are immutable, so the HTTP cache (or your own disk cache) does the rest.
public struct PackLoader: Sendable {
  public let baseURL: URL
  private let transport: any HTTPTransport

  public init(baseURL: URL, transport: any HTTPTransport = URLSessionTransport()) {
    self.baseURL = baseURL
    self.transport = transport
  }

  public func loadManifest() async throws -> Manifest {
    try JSONDecoder().decode(Manifest.self, from: try await download("manifest.json"))
  }

  /// Loads one part of the given locales, English first (it carries the shortcodes).
  /// - Parameter manifest: When given, each file must match its `sha256`.
  public func loadPacks(
    locales: [String] = ["en"], part: Pack.Part = .core, manifest: Manifest? = nil
  ) async throws -> [Pack] {
    let ordered = ["en"] + locales.filter { $0 != "en" }
    return try await withThrowingTaskGroup(of: (Int, Pack).self) { group in
      for (position, locale) in ordered.enumerated() {
        let file = Self.fileName(locale: locale, part: part)
        group.addTask {
          let data = try await download(file)
          if let expected = manifest?.files[file]?.sha256 {
            try Self.verify(data, sha256: expected, file: file)
          }
          return (position, try Pack(jsonData: data))
        }
      }
      var packs = [Pack?](repeating: nil, count: ordered.count)
      for try await (position, pack) in group { packs[position] = pack }
      return packs.compactMap { $0 }
    }
  }

  public static func fileName(locale: String, part: Pack.Part) -> String {
    part == .ext ? "pack.\(locale).ext.json" : "pack.\(locale).json"
  }

  private func download(_ file: String) async throws -> Data {
    let url = try URLEncoding.url("\(URLEncoding.trimmingTrailingSlashes(baseURL))/\(file)")
    let response = try await transport.get(url)
    guard response.isSuccess else { throw EmojisenseError.httpStatus(response.status, url: url) }
    return response.body
  }

  private static func verify(_ data: Data, sha256 expected: String, file: String) throws {
    #if canImport(CryptoKit)
      let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      guard digest == expected.lowercased() else {
        throw EmojisenseError.checksumMismatch(file: file)
      }
    #endif
  }
}
