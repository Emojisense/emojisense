import Foundation

/// A value behind a lock. The providers keep their memory here, so that `peek`, which is
/// synchronous, can read it without waiting for the actor.
final class Locked<Value>: @unchecked Sendable {
  private let lock = NSLock()
  /// Guarded by `lock`.
  private var value: Value

  init(_ value: Value) {
    self.value = value
  }

  func withLock<Result>(_ body: (inout Value) throws -> Result) rethrows -> Result {
    lock.lock()
    defer { lock.unlock() }
    return try body(&value)
  }
}
