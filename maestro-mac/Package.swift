// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Maestro",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "Maestro",
            path: "Sources/Maestro"
        )
    ]
)
