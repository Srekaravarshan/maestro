import AppKit
import SwiftUI

/// A borderless HUD panel that can still receive mouse/keyboard focus.
/// A plain borderless NSPanel returns `canBecomeKey == false`, which stops
/// SwiftUI controls (buttons, text fields) from getting clicks — override it.
final class KeyablePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false } // never steal "main" from the active app
}

/// Hosting view that acts on the FIRST click even when the window isn't active.
/// Without this a non-activating panel eats the first click just to focus itself,
/// so every interaction needs a throwaway click first.
final class FirstMouseHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    required init(rootView: Content) { super.init(rootView: rootView) }
    required init?(coder: NSCoder) { super.init(coder: coder) }
}
