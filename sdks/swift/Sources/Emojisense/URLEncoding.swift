import Foundation

/// Percent-encoding with the exact rules of the JavaScript APIs the TypeScript SDK uses, so that
/// both SDKs send the same URLs (and hit the same CDN cache entries).
enum URLEncoding {
  /// `URLSearchParams` serialization (application/x-www-form-urlencoded): space → `+`, so a
  /// literal `+` (as in "+1") is sent as `%2B`.
  static func formEncoded(_ pairs: [(String, String)]) -> String {
    pairs.map { "\(formEncode($0))=\(formEncode($1))" }.joined(separator: "&")
  }

  /// `encodeURIComponent`.
  static func uriComponent(_ value: String) -> String {
    percentEncode(value, keeping: uriComponentSafe, spaceAsPlus: false)
  }

  /// The base URL without trailing slashes (JavaScript `replace(/\/+$/, "")`).
  static func trimmingTrailingSlashes(_ url: URL) -> String {
    var value = url.absoluteString
    while value.hasSuffix("/") { value.removeLast() }
    return value
  }

  static func url(_ string: String) throws -> URL {
    guard let url = URL(string: string) else { throw EmojisenseError.invalidURL(string) }
    return url
  }

  private static let formSafe = Set("*-._".utf8)
  private static let uriComponentSafe = Set("-_.!~*'()".utf8)

  private static func formEncode(_ value: String) -> String {
    percentEncode(value, keeping: formSafe, spaceAsPlus: true)
  }

  private static func percentEncode(_ value: String, keeping safe: Set<UInt8>, spaceAsPlus: Bool)
    -> String
  {
    var encoded = ""
    for byte in value.utf8 {
      if isASCIIAlphanumeric(byte) || safe.contains(byte) {
        encoded.unicodeScalars.append(Unicode.Scalar(byte))
      } else if byte == UInt8(ascii: " ") && spaceAsPlus {
        encoded.append("+")
      } else {
        encoded.append(String(format: "%%%02X", byte))
      }
    }
    return encoded
  }

  private static func isASCIIAlphanumeric(_ byte: UInt8) -> Bool {
    (UInt8(ascii: "a")...UInt8(ascii: "z")).contains(byte)
      || (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains(byte)
      || (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte)
  }
}
