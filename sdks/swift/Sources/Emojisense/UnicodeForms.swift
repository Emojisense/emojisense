import Foundation

/// Unicode normalization forms from ICU, the library JavaScript engines normalize with.
///
/// CoreFoundation's own canonical decomposition tables lag behind ICU: on macOS 26
/// `decomposedStringWithCanonicalMapping` still misses the Unicode 16 Todhri decompositions.
/// The Foundation methods remain the fallback when an ICU transform is not available.
enum UnicodeForms {
  static func nfkc(_ text: String) -> String {
    transform(text, "Any-NFKC") ?? text.precomposedStringWithCompatibilityMapping
  }

  static func nfd(_ text: String) -> String {
    transform(text, "Any-NFD") ?? text.decomposedStringWithCanonicalMapping
  }

  static func nfc(_ text: String) -> String {
    transform(text, "Any-NFC") ?? text.precomposedStringWithCanonicalMapping
  }

  private static func transform(_ text: String, _ identifier: String) -> String? {
    // ASCII is invariant under every normalization form; skip ICU for the common case.
    if text.utf8.allSatisfy({ $0 < 0x80 }) { return text }
    return text.applyingTransform(StringTransform(identifier), reverse: false)
  }
}
