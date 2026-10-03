import Foundation

public enum EmojisenseError: Error, Equatable, Sendable, CustomStringConvertible {
  /// The data is not an Emojisense file of the expected kind (`format` differs).
  case invalidFormat(expected: String, found: String?)
  /// The file uses a `formatVersion` this SDK does not support.
  case unsupportedFormatVersion(format: String, version: Int)
  /// An engine needs at least one pack.
  case noPacks
  /// The server answered with a status outside 200–299.
  case httpStatus(Int, url: URL)
  /// A downloaded file does not match the `sha256` in the manifest.
  case checksumMismatch(file: String)
  /// A URL could not be built from the configured base URL.
  case invalidURL(String)
  /// The file has the expected format but its content is not valid.
  case invalidData(String)
  /// The value is not a plain locale tag such as "en" or "pt-BR".
  case invalidLocale(String)

  public var description: String {
    switch self {
    case .invalidFormat(let expected, let found):
      "emojisense: expected a \(expected) file, found format \(found.map { "\"\($0)\"" } ?? "none")"
    case .unsupportedFormatVersion(let format, let version):
      "emojisense: \(format) format v\(version) is not supported (expected v1)"
    case .noPacks:
      "emojisense: an engine needs at least one pack"
    case .httpStatus(let status, let url):
      "emojisense: request to \(url.absoluteString) failed with HTTP \(status)"
    case .checksumMismatch(let file):
      "emojisense: \(file) does not match the sha256 in the manifest"
    case .invalidURL(let value):
      "emojisense: cannot build a URL from \(value)"
    case .invalidData(let message):
      "emojisense: \(message)"
    case .invalidLocale(let value):
      "emojisense: \"\(value)\" is not a locale tag"
    }
  }
}
