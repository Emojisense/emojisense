import Foundation

public struct HTTPResponse: Sendable {
  public var status: Int
  public var body: Data

  public init(status: Int, body: Data) {
    self.status = status
    self.body = body
  }

  public var isSuccess: Bool { (200..<300).contains(status) }
}

/// The one network operation the SDK needs. Inject your own to add headers, logging or a stub.
public protocol HTTPTransport: Sendable {
  func get(_ url: URL) async throws -> HTTPResponse
}

public struct URLSessionTransport: HTTPTransport {
  public let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func get(_ url: URL) async throws -> HTTPResponse {
    let (data, response) = try await session.data(from: url)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 200
    return HTTPResponse(status: status, body: data)
  }
}
