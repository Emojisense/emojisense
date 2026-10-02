import Foundation

@testable import Emojisense

/// An HTTP transport that answers from a closure and records every request.
actor StubTransport: HTTPTransport {
  private let respond: @Sendable (URL) -> HTTPResponse
  private(set) var requests: [URL] = []

  init(_ respond: @escaping @Sendable (URL) -> HTTPResponse) {
    self.respond = respond
  }

  /// Serves bodies by the last, still percent-encoded, path segment; anything else is a 404.
  init(files: [String: String]) {
    self.init { url in
      let segment = url.absoluteString.split(separator: "/").last.map(String.init) ?? ""
      guard let body = files[segment] else {
        return HTTPResponse(status: 404, body: Data())
      }
      return HTTPResponse(status: 200, body: Data(body.utf8))
    }
  }

  /// Serves bodies by the full URL; anything else is a 404.
  init(urls: [String: String]) {
    self.init { url in
      guard let body = urls[url.absoluteString] else {
        return HTTPResponse(status: 404, body: Data())
      }
      return HTTPResponse(status: 200, body: Data(body.utf8))
    }
  }

  func get(_ url: URL) async throws -> HTTPResponse {
    requests.append(url)
    return respond(url)
  }
}
