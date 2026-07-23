import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    static let allScreensKey = "maestro.showOnAllScreens"

    private var statusItem: NSStatusItem!
    private var panels: [NSPanel] = []
    private let hud = HUDState()
    private var store: WorktreeStore!
    private var settingsWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.register(defaults: [Self.allScreensKey: true])
        store = WorktreeStore(hud: hud)
        setupStatusItem()
        rebuildPanels()
        setupEscapeMonitor()
        setupOutsideClickMonitor()
        NotificationCenter.default.addObserver(
            self, selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)
        store.start()
    }

    private var showOnAllScreens: Bool { UserDefaults.standard.bool(forKey: Self.allScreensKey) }

    @objc private func screensChanged() { rebuildPanels() }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "◑"
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show / Hide", action: #selector(togglePanels), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Reset Pill Position", action: #selector(resetPositions), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ","))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Maestro", action: #selector(quit), keyEquivalent: "q"))
        menu.items.forEach { $0.target = self }
        statusItem.menu = menu
    }

    // ── Panels: one pill per target screen; joins all Spaces ──────────────────
    /// (Re)build panels for the current screen set + setting. Safe to call anytime.
    func rebuildPanels() {
        panels.forEach { $0.orderOut(nil) }
        panels.removeAll()
        let screens = showOnAllScreens ? NSScreen.screens : [NSScreen.main].compactMap { $0 }
        panels = screens.map { makePanel(on: $0) }
    }

    private func makePanel(on screen: NSScreen) -> NSPanel {
        let hosting = FirstMouseHostingView(rootView: PillView(store: store, hud: hud))
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
        // Seed the panel inside its screen so PillView centres on the right display.
        let vf = screen.visibleFrame
        panel.setFrameOrigin(NSPoint(x: vf.midX - 120, y: vf.maxY - 6 - 60))
        panel.orderFrontRegardless()
        return panel
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

    @objc private func togglePanels() {
        if panels.contains(where: { $0.isVisible }) { panels.forEach { $0.orderOut(nil) } }
        else { panels.forEach { $0.orderFrontRegardless() } }
    }

    @objc private func resetPositions() {
        for panel in panels {
            guard let vf = (panel.screen ?? NSScreen.main)?.visibleFrame else { continue }
            let s = panel.frame.size
            panel.setFrameOrigin(NSPoint(x: vf.midX - s.width / 2, y: vf.maxY - s.height - 6))
        }
    }

    @objc private func openSettings() {
        if let w = settingsWindow {
            w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return
        }
        let view = SettingsView(onAllScreensChanged: { [weak self] in self?.rebuildPanels() })
        let w = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 380, height: 220),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        w.title = "Maestro Settings"
        w.contentView = NSHostingView(rootView: view)
        w.isReleasedWhenClosed = false
        w.center()
        settingsWindow = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func quit() { NSApp.terminate(nil) }
}
