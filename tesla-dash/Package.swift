// swift-tools-version:5.9
// Core logic (DBC decoding, Panda protocol, trip maths, simulator) as a package
// so it can be unit-tested with `swift test`. The iOS app compiles the same files.
import PackageDescription

let package = Package(
    name: "TeslaCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "TeslaCore", targets: ["TeslaCore"])],
    targets: [
        .target(name: "TeslaCore", path: "Sources/TeslaCore"),
        .testTarget(name: "TeslaCoreTests", dependencies: ["TeslaCore"], path: "Tests/TeslaCoreTests"),
    ]
)
