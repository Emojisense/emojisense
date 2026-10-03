// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Emojisense",
  platforms: [.iOS(.v16), .macOS(.v13)],
  products: [
    .library(name: "Emojisense", targets: ["Emojisense"])
  ],
  targets: [
    .target(name: "Emojisense"),
    .testTarget(
      name: "EmojisenseTests",
      dependencies: ["Emojisense"],
      resources: [.copy("Resources/golden.json"), .copy("Resources/culture-golden.json")]
    ),
  ]
)
