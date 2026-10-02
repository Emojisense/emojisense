/// A small least-recently-used cache. Reading an entry makes it the most recent.
struct LRUCache<Key: Hashable, Value> {
  private let capacity: Int
  private var values: [Key: Value] = [:]
  /// Oldest first.
  private var order: [Key] = []

  init(capacity: Int) {
    self.capacity = capacity
  }

  mutating func value(forKey key: Key) -> Value? {
    guard let value = values[key] else { return nil }
    touch(key)
    return value
  }

  mutating func insert(_ value: Value, forKey key: Key) {
    if values.updateValue(value, forKey: key) != nil {
      touch(key)
    } else {
      order.append(key)
    }
    while order.count > max(0, capacity) {
      values[order.removeFirst()] = nil
    }
  }

  private mutating func touch(_ key: Key) {
    if let position = order.firstIndex(of: key) { order.remove(at: position) }
    order.append(key)
  }
}
