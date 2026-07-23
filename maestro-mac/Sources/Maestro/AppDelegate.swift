import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var panel: NSPanel!
    private let hud = HUDState()
    private var store: WorktreeStore!

    private var lastPillSize: CGSize = .zero
    private var wantCenter = true

    func applicationDidFinishLaunching(_ notification: Notification) {
        store = WorktreeStore(hud: hud)
        setupStatusItem()
        setupPanel()
        setupEscapeMonitor()
        setupOutsideClickMonitor()
        store.start()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "◑"
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show / Hide", action: #selector(togglePanel), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Maestro", action: #selector(quit), keyEquivalent: "q"))
        menu.items.forEach { $0.target = self }
        statusItem.menu = menu
    }

    private func setupPanel() {
        let hosting = FirstMouseHostingView(rootView: PillView(
            store: store, hud: hud,
            onPillSize: { [weak self] size in
                guard let self = self else { return }
                self.lastPillSize = size
                self.snapToPill()   // fit the window to the pill immediately (fade hides any resize)
            }
        ))

        let panel = KeyablePanel(
            contentRect: NSRect(x: 0, y: 0, width: 240, height: 60),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false          // shadow is drawn on the SwiftUI pill
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = hosting
        self.panel = panel

        // Initial placement near top-center; the first pill measurement will refine it.
        if let screen = NSScreen.main {
            let vf = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: vf.midX - 120, y: vf.maxY - 6 - 60))
        }
        panel.orderFrontRegardless()
    }

    /// Snap the window to the pill's exact size (instant). Runs over transparent area,
    /// so it's invisible; keeps horizontal centre + top edge (or centres on first show).
    private func snapToPill() {
        let s = lastPillSize
        guard s.width > 1, s.height > 1 else { return }
        let origin: NSPoint
        if wantCenter, let screen = NSScreen.main {
            let vf = screen.visibleFrame
            origin = NSPoint(x: vf.midX - s.width / 2, y: vf.maxY - s.height - 6)
            wantCenter = false
        } else {
            let old = panel.frame
            origin = NSPoint(x: old.midX - s.width / 2, y: old.maxY - s.height)
        }
        let target = NSRect(origin: origin, size: s)
        if !target.equalTo(panel.frame) { panel.setFrame(target, display: true) }
    }

    private func collapse() { hud.mode = .collapsed }   // PillView fades on the mode change

    private func setupOutsideClickMonitor() {
        NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self = self, self.hud.mode == .expanded else { return }
            self.collapse()
        }
    }

    private func setupEscapeMonitor() {
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self = self else { return event }
            if event.keyCode == 53, self.hud.mode == .expanded {
                self.collapse()
                return nil
            }
            return event
        }
    }

    @objc private func togglePanel() {
        if panel.isVisible { panel.orderOut(nil) } else { panel.orderFrontRegardless() }
    }

    @objc private func quit() { NSApp.terminate(nil) }
}
