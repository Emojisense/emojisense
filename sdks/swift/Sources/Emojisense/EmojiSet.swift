import Foundation

/// How a picker draws emoji. `.native` draws the text with the system font. The other sets are
/// images that the Emojisense API hosts at `/v1/sets/<set>/<hexcode>.svg`, as `EmojiSet` and
/// `emojiImageUrl` in `packages/core`. Credit the set in the app (see NOTICE).
public enum EmojiSet: String, CaseIterable, Codable, Sendable {
  case native
  case twemoji
  case noto
  case fluent

  /// True for the image sets that the API hosts.
  public var isHosted: Bool { self != .native }

  /// The image URL of an emoji, skin tone included, or `nil` for `.native` (draw the text).
  ///
  /// A set may not draw every emoji (Fluent has no country flags). The API answers 404 then,
  /// and the picker should draw the text instead. Hosted sets need a publishable `key` whose
  /// plan includes them (the API answers 401 or 402 otherwise), as `emojiImageUrl` in
  /// `packages/core`.
  public func imageURL(for emoji: String, endpoint: URL, key: String? = nil) -> URL? {
    guard isHosted else { return nil }
    let base = URLEncoding.trimmingTrailingSlashes(endpoint)
    let query = key.map { $0.isEmpty ? "" : "?key=\(URLEncoding.uriComponent($0))" } ?? ""
    return URL(string: "\(base)/v1/sets/\(rawValue)/\(Hexcode.of(emoji)).svg\(query)")
  }
}

/// Emojibase hexcodes, as `hexcodeOf` in `packages/core`.
public enum Hexcode {
  /// The Emojibase hexcode of an emoji, with or without a skin tone: "👍🏽" → "1F44D-1F3FD",
  /// "❤️" → "2764", "❤️‍🔥" → "2764-FE0F-200D-1F525". U+FE0F is dropped only when it follows a
  /// single code point. Pack rows store the same value for base emoji.
  public static func of(_ emoji: String) -> String {
    var scalars = emoji.unicodeScalars.map(\.value)
    if scalars.count == 2, scalars[1] == 0xFE0F { scalars.removeLast() }
    return scalars.map { String(format: "%04X", $0) }.joined(separator: "-")
  }
}
