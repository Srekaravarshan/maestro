import SwiftUI

enum HUDMode { case collapsed, expanded }

struct AttentionInfo: Equatable {
    let id: String
    let folder: String
    let state: String
    let host: String?
    let time: String
}

/// Transient UI state for the HUD (which mode it's in, any live alert).
final class HUDState: ObservableObject {
    @Published var mode: HUDMode = .collapsed
    @Published var attention: AttentionInfo?
}
