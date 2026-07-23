import SwiftUI
import AppKit

func statusColor(_ state: String) -> Color {
    switch state {
    case "working":            return Color(red: 0.36, green: 0.60, blue: 0.98)
    case "waiting", "blocked": return Color(red: 0.95, green: 0.72, blue: 0.25)
    case "done":               return Color(red: 0.30, green: 0.80, blue: 0.55)
    case "error":              return Color(red: 0.93, green: 0.35, blue: 0.32)
    default:                   return Color(white: 0.55)
    }
}

func shortCode(_ state: String) -> String {
    switch state {
    case "working": return "WORK"
    case "waiting", "blocked": return "BLOCK"
    case "done": return "DONE"
    case "error": return "ERR"
    default: return "IDLE"
    }
}

func shortPhrase(_ state: String) -> String {
    switch state {
    case "waiting", "blocked": return "input needed"
    case "done": return "done"
    case "error": return "failed"
    default: return state
    }
}

private let hmFmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f }()
private let mdFmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "MMM d"; return f }()

func timeLabel(_ t: TimeInterval) -> String {
    guard t > 0 else { return "—" }
    let d = Date(timeIntervalSince1970: t)
    return Calendar.current.isDateInToday(d) ? hmFmt.string(from: d) : mdFmt.string(from: d)
}

func hostIcon(_ host: String?) -> String {
    switch host {
    case "vscode":                            return "chevron.left.forwardslash.chevron.right"
    case "iterm", "terminal", "warp", "tmux": return "terminal"
    case "app":                               return "sparkles"
    default:                                  return "arrow.up.right.square"
    }
}

private struct HeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

private struct SizeKey: PreferenceKey {
    static var defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() }
}

extension View {
    @ViewBuilder func applyIf<T: View>(_ cond: Bool, _ transform: (Self) -> T) -> some View {
        if cond { transform(self) } else { self }
    }
    func cursor(_ cursor: NSCursor) -> some View {
        onHover { inside in
            if inside { cursor.push() } else { NSCursor.pop() }
        }
    }
}

private struct WindowAccessor: NSViewRepresentable {
    let onResolve: (NSWindow?) -> Void
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async { onResolve(v.window) }
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {}
}

/// Pages the expanded card can show (a simple nav stack).
enum CardRoute: Equatable {
    case list
    case folder(String)                         // cwd
    case notes(String)                          // cwd
    case chat(id: String, cwd: String, folder: String)
}

struct PillView: View {
    @ObservedObject var store: WorktreeStore
    @ObservedObject var hud: HUDState

    @State private var window: NSWindow?
    @State private var didInitialCenter = false
    @State private var dragStartMouse: CGPoint?
    @State private var dragStartOrigin: CGPoint?
    @AppStorage("maestro.moreOpen") private var moreOpen = false
    @State private var contentHeight: CGFloat = 0
    @State private var displayedMode: HUDMode = .collapsed
    @State private var pillOpacity: Double = 1
    @State private var stack: [CardRoute] = []      // nav stack; current = last

    private let maxBodyHeight: CGFloat = 440
    private let shadowMargin: CGFloat = 20

    private var route: CardRoute { stack.last ?? .list }
    private func push(_ r: CardRoute) { stack.append(r) }
    private func pop() { if !stack.isEmpty { stack.removeLast() } }
    private func popToRoot() { stack.removeAll() }

    var body: some View {
        ZStack(alignment: .top) {
            Color.clear
            pill
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(WindowAccessor { self.window = $0 })
        .environment(\.colorScheme, .dark)
    }

    private var pill: some View {
        content
            .frame(width: hud.mode == .expanded ? 360 : nil)
            .background(Color(red: 0.10, green: 0.11, blue: 0.13), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.12)))
            .shadow(color: .black.opacity(0.40), radius: 14, x: 0, y: 6)
            .padding(shadowMargin)
            .background(GeometryReader { g in Color.clear.preference(key: SizeKey.self, value: g.size) })
            .opacity(pillOpacity)
            .onPreferenceChange(SizeKey.self) { fitWindow($0) }
            .onChange(of: hud.mode) { newMode in
                // Keep the nav stack across collapse so reopening returns to the same page.
                guard newMode != displayedMode else { return }
                if newMode == .expanded {
                    pillOpacity = 0
                    displayedMode = newMode
                    DispatchQueue.main.async {
                        withAnimation(.easeIn(duration: 0.18)) { pillOpacity = 1 }
                    }
                } else {
                    withAnimation(.easeOut(duration: 0.12)) { pillOpacity = 0 }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                        displayedMode = newMode
                        DispatchQueue.main.async {
                            withAnimation(.easeIn(duration: 0.18)) { pillOpacity = 1 }
                        }
                    }
                }
            }
    }

    @ViewBuilder private var content: some View {
        if let a = hud.attention, displayedMode == .collapsed {
            attentionView(a)
        } else if displayedMode == .collapsed {
            collapsedView
        } else {
            expandedView
        }
    }

    // ── Window drag ────────────────────────────────────────────────────────
    private var windowDrag: some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .global)
            .onChanged { _ in
                guard let w = window else { return }
                let mouse = NSEvent.mouseLocation
                if dragStartMouse == nil {
                    dragStartMouse = mouse; dragStartOrigin = w.frame.origin
                    NSCursor.closedHand.push()
                }
                guard let sm = dragStartMouse, let so = dragStartOrigin else { return }
                w.setFrameOrigin(NSPoint(x: so.x + (mouse.x - sm.x), y: so.y + (mouse.y - sm.y)))
            }
            .onEnded { _ in
                if dragStartMouse != nil { NSCursor.pop() }
                dragStartMouse = nil; dragStartOrigin = nil
            }
    }

    private func expand()   { hud.mode = .expanded }
    private func collapse() { hud.mode = .collapsed }

    private func fitWindow(_ size: CGSize) {
        guard let w = window, size.width > 1, size.height > 1 else { return }
        if !didInitialCenter, let vf = (w.screen ?? NSScreen.main)?.visibleFrame {
            w.setFrame(NSRect(x: vf.midX - size.width / 2, y: vf.maxY - size.height - 6,
                              width: size.width, height: size.height), display: true)
            didInitialCenter = true
            return
        }
        let old = w.frame
        let target = NSRect(x: old.midX - size.width / 2, y: old.maxY - size.height,
                            width: size.width, height: size.height)
        if !target.equalTo(old) { w.setFrame(target, display: true) }
    }

    private func recenter() {
        guard let w = window, let vf = (w.screen ?? NSScreen.main)?.visibleFrame else { return }
        let s = w.frame.size
        w.setFrameOrigin(NSPoint(x: vf.midX - s.width / 2, y: vf.maxY - s.height - 6))
    }

    // ── Collapsed ─────────────────────────────────────────────────────────────
    private var collapsedView: some View {
        let c = store.counts
        return HStack(spacing: 10) {
            if c.work > 0 { seg("\(c.work) wk", statusColor("working")) }
            if c.block > 0 { seg("\(c.block) block", statusColor("waiting")) }
            if c.err > 0 { seg("\(c.err) err", statusColor("error")) }
            if c.work == 0 && c.block == 0 && c.err == 0 { seg("Maestro · idle", Color(white: 0.6)) }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .fixedSize()
        .contentShape(Rectangle())
        .onTapGesture { expand() }
        .gesture(windowDrag)
        .cursor(.openHand)
        .contextMenu { Button("Reset position", action: recenter) }
    }

    private func seg(_ text: String, _ color: Color) -> some View {
        Text(text).font(.system(size: 12.5, weight: .semibold, design: .monospaced)).foregroundStyle(color)
    }

    // ── Attention ─────────────────────────────────────────────────────────────
    private func attentionView(_ a: AttentionInfo) -> some View {
        HStack(spacing: 11) {
            Text("[\(a.time)]").font(.system(size: 13, design: .monospaced)).foregroundStyle(.secondary)
            Text(a.folder).font(.system(size: 14, weight: .bold, design: .monospaced)).foregroundStyle(.white).lineLimit(1)
            Text("\(shortCode(a.state)) · \(shortPhrase(a.state))")
                .font(.system(size: 13.5, weight: .bold, design: .monospaced)).foregroundStyle(statusColor(a.state))
            Button {
                Actions.openPath(a.id, a.host); hud.attention = nil
            } label: {
                Text("Open").font(.system(size: 12.5, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 12).padding(.vertical, 5)
                    .foregroundStyle(statusColor(a.state))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(statusColor(a.state).opacity(0.5)))
            }.buttonStyle(.plain).cursor(.pointingHand)
            Button { hud.attention = nil } label: {
                Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.secondary)
                    .frame(width: 24, height: 24).contentShape(Rectangle())
            }.buttonStyle(.plain).cursor(.pointingHand).help("Dismiss")
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .fixedSize()
        .onTapGesture { expand() }
        .gesture(windowDrag)
        .cursor(.openHand)
        .contextMenu { Button("Reset position", action: recenter) }
    }

    // ── Expanded: route to a page ─────────────────────────────────────────────
    @ViewBuilder private var expandedView: some View {
        switch route {
        case .list:
            listView
        case .folder(let cwd):
            folderPage(cwd)
        case .notes(let cwd):
            NotesPage(folderName: (cwd as NSString).lastPathComponent, cwd: cwd, store: store,
                      onBack: { pop() }, onClose: { collapse() })
        case .chat(let id, let cwd, let folder):
            ChatView(folder: folder, sessionId: id, cwd: cwd,
                     onBack: { pop() }, onClose: { collapse() })
        }
    }

    // ── Root: folder list ─────────────────────────────────────────────────────
    private var listView: some View {
        let pinned = store.folders.filter { $0.tier == "pinned" }
        let active = store.folders.filter { $0.tier == "active" }
        let other  = store.folders.filter { $0.tier == "other" }
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("MAESTRO").font(.system(size: 12, weight: .bold, design: .monospaced)).kerning(1).foregroundStyle(.white)
                Text("\(store.folders.count) folders").font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                Spacer()
                Button { collapse() } label: {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary)
                        .frame(width: 26, height: 26).contentShape(Rectangle())
                }.buttonStyle(.plain).cursor(.pointingHand)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .contentShape(Rectangle())
            .gesture(windowDrag)
            .cursor(.openHand)

            Divider().overlay(.white.opacity(0.1))

            ScrollView {
                VStack(spacing: 0) {
                    if store.folders.isEmpty {
                        Text("No Claude sessions found.")
                            .font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity).padding(.vertical, 24)
                    }
                    if !pinned.isEmpty { sectionLabel("PINNED"); folderList(pinned) }
                    if !active.isEmpty { sectionLabel("ACTIVE"); folderList(active) }
                    if !other.isEmpty {
                        accordionHeader("MORE", count: other.count, isOpen: moreOpen) { moreOpen.toggle() }
                        if moreOpen { folderList(other) }
                    }
                }
                .padding(.bottom, 10)
                .background(GeometryReader { g in Color.clear.preference(key: HeightKey.self, value: g.size.height) })
            }
            .frame(height: min(max(contentHeight, 1), maxBodyHeight))
            .onPreferenceChange(HeightKey.self) { h in
                if abs(h - contentHeight) > 0.5 { contentHeight = h }
            }
        }
    }

    private func folderList(_ list: [Folder]) -> some View {
        ForEach(list) { f in
            FolderView(folder: f, store: store,
                       onOpenFolder: { push(.folder(f.id)) },
                       onPinFolder: { toggleFolderPin(f) },
                       onPinSession: { s in toggleSessionPin(s) },
                       onOpenChat: { s in push(.chat(id: s.id, cwd: s.cwd, folder: f.name)) })
        }
    }

    // ── Folder page (all sessions + Notes row) ────────────────────────────────
    @ViewBuilder private func folderPage(_ cwd: String) -> some View {
        if let f = store.folders.first(where: { $0.id == cwd }) {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Button { pop() } label: {
                        Image(systemName: "chevron.left").font(.system(size: 12, weight: .bold)).foregroundStyle(.secondary)
                            .frame(width: 24, height: 24).contentShape(Rectangle())
                    }.buttonStyle(.plain).cursor(.pointingHand).help("Back")
                    VStack(alignment: .leading, spacing: 1) {
                        Text(f.name).font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(.white).lineLimit(1)
                        Text(f.repo.isEmpty ? f.branch : "\(f.repo):\(f.branch)")
                            .font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    Button { toggleFolderPin(f) } label: {
                        Image(systemName: f.pinned ? "pin.fill" : "pin").font(.system(size: 12))
                            .foregroundStyle(f.pinned ? statusColor("done") : Color.secondary)
                            .frame(width: 22, height: 22).contentShape(Rectangle())
                    }.buttonStyle(.plain).cursor(.pointingHand).help(f.pinned ? "Unpin folder" : "Pin folder")
                    Button { collapse() } label: {
                        Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary)
                            .frame(width: 24, height: 24).contentShape(Rectangle())
                    }.buttonStyle(.plain).cursor(.pointingHand).help("Close")
                }
                .padding(.horizontal, 12).padding(.vertical, 9)
                .gesture(windowDrag)
                .contextMenu { Button("Copy path") { Actions.copyText(f.id) } }

                Divider().overlay(.white.opacity(0.1))

                ScrollView {
                    VStack(spacing: 0) {
                        // Notes row (top) → notes page
                        Button { push(.notes(cwd)) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "note.text").font(.system(size: 11))
                                Text(f.ideasCount > 0 ? "Notes · \(f.ideasCount)" : "Notes")
                                    .font(.system(size: 11, design: .monospaced))
                                Spacer()
                                Image(systemName: "chevron.right").font(.system(size: 9))
                            }
                            .foregroundStyle(f.ideasCount > 0 ? statusColor("waiting") : Color.secondary)
                            .padding(.horizontal, 12).padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }.buttonStyle(.plain).cursor(.pointingHand)
                        Divider().overlay(.white.opacity(0.08))
                        ForEach(f.sessions) { s in
                            SessionTileView(session: s, indent: 12,
                                            onOpen: { Actions.open(s) },
                                            onPin: { toggleSessionPin(s) },
                                            onChat: { push(.chat(id: s.id, cwd: s.cwd, folder: f.name)) })
                        }
                    }
                    .padding(.bottom, 10)
                    .background(GeometryReader { g in Color.clear.preference(key: HeightKey.self, value: g.size.height) })
                }
                .frame(height: min(max(contentHeight, 1), maxBodyHeight))
                .onPreferenceChange(HeightKey.self) { h in
                    if abs(h - contentHeight) > 0.5 { contentHeight = h }
                }
            }
        } else {
            Color.clear.frame(width: 320, height: 60).onAppear { popToRoot() }   // folder vanished
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        HStack {
            Text(text).font(.system(size: 10, weight: .semibold, design: .monospaced)).kerning(1).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6)
    }

    private func accordionHeader(_ title: String, count: Int, isOpen: Bool, _ toggle: @escaping () -> Void) -> some View {
        Button(action: toggle) {
            HStack(spacing: 8) {
                Image(systemName: isOpen ? "chevron.down" : "chevron.right").font(.system(size: 9))
                Text("\(title) · \(count)").font(.system(size: 10, weight: .semibold, design: .monospaced)).kerning(1)
                Spacer()
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6).foregroundStyle(.secondary)
            .contentShape(Rectangle())
        }.buttonStyle(.plain).cursor(.pointingHand)
    }

    // ── Mutations ─────────────────────────────────────────────────────────────
    private func toggleFolderPin(_ f: Folder) {
        var order = store.folders.filter { $0.tier == "pinned" }.sorted { $0.pinIndex < $1.pinIndex }.map { $0.id }
        if f.pinned { order.removeAll { $0 == f.id } } else { order.append(f.id) }
        Actions.setPins(order); store.reload()
    }

    private func toggleSessionPin(_ s: Session) {
        var order = store.folders.flatMap { $0.sessions }.filter { $0.pinned }.map { $0.id }
        if s.pinned { order.removeAll { $0 == s.id } } else { order.append(s.id) }
        Actions.setSessionPins(order); store.reload()
    }
}

// ── Folder row (root list): tap to open its page; pinned folders show tiles ────
struct FolderView: View {
    let folder: Folder
    @ObservedObject var store: WorktreeStore
    var onOpenFolder: () -> Void
    var onPinFolder: () -> Void
    var onPinSession: (Session) -> Void
    var onOpenChat: (Session) -> Void
    @State private var hover = false

    var body: some View {
        VStack(spacing: 0) {
            header
            if folder.pinned {
                ForEach(folder.collapsedSessions) { s in
                    SessionTileView(session: s, indent: 26,
                                    onOpen: { Actions.open(s) },
                                    onPin: { onPinSession(s) },
                                    onChat: { onOpenChat(s) })
                }
            }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.06)).frame(height: 1) }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button(action: onOpenFolder) {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(.secondary).frame(width: 10)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(folder.name).font(.system(size: 13, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.white).lineLimit(1)
                        Text(folder.repo.isEmpty ? folder.branch : "\(folder.repo):\(folder.branch)")
                            .font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    summary
                    Text("\(folder.sessions.count)").font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary.opacity(0.7))
                }
                .contentShape(Rectangle())
            }.buttonStyle(.plain).cursor(.pointingHand)

            Button(action: onPinFolder) {
                Image(systemName: folder.pinned ? "pin.fill" : "pin")
                    .font(.system(size: 12)).foregroundStyle(folder.pinned ? statusColor("done") : Color.secondary)
                    .frame(width: 22, height: 22).contentShape(Rectangle())
            }.buttonStyle(.plain).cursor(.pointingHand).help(folder.pinned ? "Unpin folder" : "Pin folder")
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(hover ? Color.white.opacity(0.04) : .clear)
        .onHover { hover = $0 }
        .contextMenu { Button("Copy path") { Actions.copyText(folder.id) } }
    }

    @ViewBuilder private var summary: some View {
        if folder.runningCount > 0 {
            Text("\(folder.runningCount) run").font(.system(size: 10.5, weight: .bold, design: .monospaced))
                .foregroundStyle(statusColor("working"))
        } else {
            Text(shortCode(folder.aggregate)).font(.system(size: 10.5, weight: .bold, design: .monospaced))
                .foregroundStyle(statusColor(folder.aggregate))
        }
    }
}

// ── Session tile ──────────────────────────────────────────────────────────────
struct SessionTileView: View {
    let session: Session
    var indent: CGFloat = 26
    var onOpen: () -> Void
    var onPin: () -> Void
    var onChat: () -> Void
    @State private var hover = false

    // Pinned tiles hide the time (they're persistent, not activity-driven); keep host.
    private var subtitle: String {
        if session.pinned { return session.host ?? "" }
        return "\(timeLabel(session.lastActivity))\(session.host.map { " · \($0)" } ?? "")"
    }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(session.label).font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.92)).lineLimit(1)
                if !subtitle.isEmpty {
                    Text(subtitle).font(.system(size: 9.5, design: .monospaced)).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button(action: onOpen) {
                Image(systemName: hostIcon(session.host)).font(.system(size: 11)).foregroundStyle(.secondary)
                    .frame(width: 22, height: 22).contentShape(Rectangle())
            }.buttonStyle(.plain).cursor(.pointingHand).help("Open in \(session.host ?? "editor")")
            Button(action: onPin) {
                Image(systemName: session.pinned ? "pin.fill" : "pin").font(.system(size: 11))
                    .foregroundStyle(session.pinned ? statusColor("done") : Color.secondary)
                    .frame(width: 22, height: 22).contentShape(Rectangle())
            }.buttonStyle(.plain).cursor(.pointingHand).help(session.pinned ? "Unpin session" : "Pin session")
            Button(action: onChat) {
                Image(systemName: "bubble.left").font(.system(size: 11)).foregroundStyle(.secondary)
                    .frame(width: 22, height: 22).contentShape(Rectangle())
            }.buttonStyle(.plain).cursor(.pointingHand).help("Chat")
            Text(session.shortCode).font(.system(size: 10.5, weight: .bold, design: .monospaced))
                .foregroundStyle(statusColor(session.state)).frame(width: 44, alignment: .trailing)
        }
        .padding(.leading, indent).padding(.trailing, 12).padding(.vertical, 7)
        .background(hover ? Color.white.opacity(0.05) : .clear)
        .onHover { hover = $0 }
        .contextMenu {
            Button("Copy path") { Actions.copyText(session.cwd) }
            Button("Copy session id") { Actions.copyText(session.id) }
        }
    }
}

// ── Notes page (per folder) ────────────────────────────────────────────────────
struct NotesPage: View {
    let folderName: String
    let cwd: String
    @ObservedObject var store: WorktreeStore
    var onBack: () -> Void = {}
    var onClose: () -> Void = {}

    @State private var draft = ""
    @FocusState private var focused: Bool
    private let bodyHeight: CGFloat = 380

    private var notes: [Idea] { store.ideas.filter { $0.cwd == cwd } }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button(action: onBack) {
                    Image(systemName: "chevron.left").font(.system(size: 12, weight: .bold)).foregroundStyle(.secondary)
                        .frame(width: 24, height: 24).contentShape(Rectangle())
                }.buttonStyle(.plain).cursor(.pointingHand).help("Back")
                Text("\(folderName) · Notes").font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundStyle(.white).lineLimit(1)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary)
                        .frame(width: 24, height: 24).contentShape(Rectangle())
                }.buttonStyle(.plain).cursor(.pointingHand).help("Close")
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            Divider().overlay(.white.opacity(0.1))

            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    if notes.isEmpty {
                        Text("No notes yet.").font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity).padding(.vertical, 18)
                    }
                    ForEach(notes) { idea in
                        HStack(spacing: 6) {
                            Text(idea.text).font(.system(size: 11.5, design: .monospaced)).foregroundStyle(.white.opacity(0.85))
                                .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                            Button { Actions.removeIdea(id: idea.id); store.reload() } label: {
                                Image(systemName: "xmark").font(.system(size: 9)).foregroundStyle(.secondary)
                            }.buttonStyle(.plain).cursor(.pointingHand)
                        }
                        .padding(.horizontal, 9).padding(.vertical, 7)
                        .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
            }
            .frame(height: bodyHeight)

            Divider().overlay(.white.opacity(0.1))
            TextField("park a note… ↵", text: $draft)
                .textFieldStyle(.plain).font(.system(size: 11.5, design: .monospaced))
                .padding(.horizontal, 9).padding(.vertical, 7)
                .background(Color.black.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(statusColor("working").opacity(0.4)))
                .focused($focused)
                .onSubmit(add)
                .padding(.horizontal, 12).padding(.vertical, 9)
        }
        .frame(width: 360)
        .onAppear { focused = true }
    }

    private func add() {
        let t = draft.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        Actions.addIdea(text: t, cwd: cwd); draft = ""; store.reload()
    }
}
