import SwiftUI
import AppKit
import UniformTypeIdentifiers

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

private struct HeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// The pill's own size (not the window) — the window snaps to this after a transition.
private struct SizeKey: PreferenceKey {
    static var defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() }
}

extension View {
    @ViewBuilder func applyIf<T: View>(_ cond: Bool, _ transform: (Self) -> T) -> some View {
        if cond { transform(self) } else { self }
    }

    /// Show `cursor` while hovering this view. Uses push/pop so nested regions
    /// (row → button) restore the parent's cursor cleanly on exit.
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

struct PillView: View {
    @ObservedObject var store: WorktreeStore
    @ObservedObject var hud: HUDState
    @State private var window: NSWindow?
    @State private var didInitialCenter = false
    @State private var dragStartMouse: CGPoint?
    @State private var dragStartOrigin: CGPoint?
    // Accordion open/closed — persisted across launches (UserDefaults).
    @AppStorage("maestro.activeOpen") private var activeOpen = true
    @AppStorage("maestro.moreOpen") private var moreOpen = false
    @State private var contentHeight: CGFloat = 0
    @State private var overPinned = false
    @State private var overActive = false
    @State private var overMore = false
    @FocusState private var focused: String?   // keyed focus: "row:<cwd>", "notes:<cwd>", "sec:ACTIVE"/"sec:MORE"
    @State private var displayedMode: HUDMode = .collapsed   // what's actually rendered (fades between states)
    @State private var pillOpacity: Double = 1

    private let maxBodyHeight: CGFloat = 440

    var body: some View {
        // The root fills the (possibly larger, during a transition) window; the pill
        // is top-anchored. The empty area is transparent, so the window snapping back
        // to the pill's size afterwards is invisible.
        ZStack(alignment: .top) {
            Color.clear
            pill
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(WindowAccessor { self.window = $0 })
        .environment(\.colorScheme, .dark)
    }

    private let shadowMargin: CGFloat = 20   // transparent room around the pill for the shadow

    private var pill: some View {
        content
            .frame(width: hud.mode == .expanded ? 360 : nil)
            // Solid dark (not .ultraThinMaterial) so the pill looks identical over any
            // app — a material samples/blurs the backdrop and turns milky over white.
            .background(Color(red: 0.10, green: 0.11, blue: 0.13), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.12)))
            .shadow(color: .black.opacity(0.40), radius: 14, x: 0, y: 6)
            // Measure the padded frame so the window includes the shadow's margin
            // (transparent) — otherwise the window edge crops the shadow.
            .padding(shadowMargin)
            .background(GeometryReader { g in Color.clear.preference(key: SizeKey.self, value: g.size) })
            .opacity(pillOpacity)
            .onPreferenceChange(SizeKey.self) { fitWindow($0) }
            .onChange(of: hud.mode) { newMode in
                guard newMode != displayedMode else { return }
                // Fade out, swap + resize while invisible (no size tween → no width glitch), fade in.
                withAnimation(.easeOut(duration: 0.12)) { pillOpacity = 0 }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                    displayedMode = newMode
                    DispatchQueue.main.async {   // let layout + window snap happen before fading in
                        withAnimation(.easeIn(duration: 0.18)) { pillOpacity = 1 }
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

    private var windowDrag: some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .global)
            .onChanged { _ in
                guard let w = window else { return }
                let mouse = NSEvent.mouseLocation
                if dragStartMouse == nil {
                    dragStartMouse = mouse; dragStartOrigin = w.frame.origin
                    NSCursor.closedHand.push()          // grabbing cursor while moving
                }
                guard let sm = dragStartMouse, let so = dragStartOrigin else { return }
                w.setFrameOrigin(NSPoint(x: so.x + (mouse.x - sm.x), y: so.y + (mouse.y - sm.y)))
            }
            .onEnded { _ in
                if dragStartMouse != nil { NSCursor.pop() }
                dragStartMouse = nil; dragStartOrigin = nil
            }
    }

    private func expand()   { hud.mode = .expanded }   // PillView fades on mode change
    private func collapse() { hud.mode = .collapsed }

    /// Size this pill's own window to the measured pill (keeps top-center on its own
    /// screen). Runs over transparent area so the resize is invisible.
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

    /// Snap the pill back to top-center of its own screen (right-click → Reset position).
    private func recenter() {
        guard let w = window, let vf = (w.screen ?? NSScreen.main)?.visibleFrame else { return }
        let s = w.frame.size
        w.setFrameOrigin(NSPoint(x: vf.midX - s.width / 2, y: vf.maxY - s.height - 6))
    }

    // ── Drag between sections: PINNED pins, ACTIVE/MORE unpins ────────────────
    enum DropZone { case pinned, other }

    private func handleDrop(_ providers: [NSItemProvider], _ zone: DropZone) -> Bool {
        loadCwd(providers) { cwd in
            var order = pinnedOrder()
            switch zone {
            case .pinned: if !order.contains(cwd) { order.append(cwd) }
            case .other:  order.removeAll { $0 == cwd }
            }
            Actions.setPins(order); store.reload()
        }
        return true
    }

    private func reorderPinned(_ dragged: String, onto targetCwd: String) {
        guard dragged != targetCwd else { return }
        var order = pinnedOrder()
        if let from = order.firstIndex(of: dragged), let to = order.firstIndex(of: targetCwd) {
            order.remove(at: from)
            order.insert(dragged, at: min(to, order.count))
        } else if let to = order.firstIndex(of: targetCwd) {
            order.insert(dragged, at: to)
        } else {
            order.append(dragged)
        }
        Actions.setPins(order); store.reload()
    }

    private func pinnedOrder() -> [String] {
        store.worktrees.filter { $0.tier == "pinned" }.sorted { $0.pinIndex < $1.pinIndex }.map { $0.id }
    }

    private func loadCwd(_ providers: [NSItemProvider], _ done: @escaping (String) -> Void) {
        guard let p = providers.first else { return }
        _ = p.loadObject(ofClass: NSString.self) { obj, _ in
            if let cwd = obj as? String { DispatchQueue.main.async { done(cwd) } }
        }
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
        .onTapGesture { expand() }               // single click — instant, no double-tap delay
        .gesture(windowDrag)
        .cursor(.openHand)
        .contextMenu { Button("Reset position", action: recenter) }   // right-click to reset
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
            Button { hud.attention = nil } label: {   // dismiss the banner
                Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.secondary)
                    .frame(width: 24, height: 24).contentShape(Rectangle())
            }.buttonStyle(.plain).cursor(.pointingHand).help("Dismiss")
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .fixedSize()
        .overlay(alignment: .leading) { Rectangle().fill(statusColor(a.state)).frame(width: 4) }
        .onTapGesture { expand() }               // single click — instant
        .gesture(windowDrag)
        .cursor(.openHand)
        .contextMenu { Button("Reset position", action: recenter) }
    }

    // ── Expanded ──────────────────────────────────────────────────────────────
    private var expandedView: some View {
        let pinned = store.worktrees.filter { $0.tier == "pinned" }
        let active = store.worktrees.filter { $0.tier == "active" }
        let other  = store.worktrees.filter { $0.tier == "other" }
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("MAESTRO").font(.system(size: 12, weight: .bold, design: .monospaced)).kerning(1).foregroundStyle(.white)
                Text("\(store.worktrees.count) trees").font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                Spacer()
                Button { collapse() } label: {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary)
                        .frame(width: 26, height: 26)          // generous hit area
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).cursor(.pointingHand)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .contentShape(Rectangle())
            .gesture(windowDrag)
            .cursor(.openHand)

            Divider().overlay(.white.opacity(0.1))

            ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    VStack(spacing: 0) {
                        sectionLabel("PINNED")
                        if pinned.isEmpty {
                            Text("drag a row here to pin")
                                .font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary.opacity(0.6))
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.bottom, 8)
                        } else {
                            ForEach(pinned) { wt in
                                RowView(wt: wt, store: store, focus: $focused, onMove: move, onPinned: revealAndFocusPin,
                                        onDropRow: { dragged in reorderPinned(dragged, onto: wt.id) })
                                    .id("row:\(wt.id)")
                            }
                        }
                    }
                    .background(overPinned ? statusColor("done").opacity(0.08) : .clear)
                    .onDrop(of: [.text], isTargeted: $overPinned) { handleDrop($0, .pinned) }

                    VStack(spacing: 0) {
                        if !active.isEmpty {
                            accordionHeader("ACTIVE", count: active.count, isOpen: activeOpen) { activeOpen.toggle() }
                            if activeOpen { rows(active) }
                        } else if pinned.isEmpty {
                            Text("nothing active").font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 16)
                        }
                    }
                    .background(overActive ? Color.white.opacity(0.05) : .clear)
                    .onDrop(of: [.text], isTargeted: $overActive) { handleDrop($0, .other) }

                    if !other.isEmpty {
                        VStack(spacing: 0) {
                            accordionHeader("MORE", count: other.count, isOpen: moreOpen) { moreOpen.toggle() }
                            if moreOpen { rows(other) }
                        }
                        .background(overMore ? Color.white.opacity(0.05) : .clear)
                        .onDrop(of: [.text], isTargeted: $overMore) { handleDrop($0, .other) }
                    }
                }
                .background(GeometryReader { g in
                    Color.clear.preference(key: HeightKey.self, value: g.size.height)
                })
            }
            .frame(height: min(max(contentHeight, 1), maxBodyHeight))
            .onPreferenceChange(HeightKey.self) { h in
                if abs(h - contentHeight) > 0.5 { contentHeight = h }
            }
            .onChange(of: focused) { id in
                guard let id else { return }
                withAnimation(.easeOut(duration: 0.18)) { proxy.scrollTo(id, anchor: .center) }
            }
            }
        }
    }

    private func rows(_ list: [Worktree]) -> some View {
        ForEach(list) { wt in
            RowView(wt: wt, store: store, focus: $focused, onMove: move, onPinned: revealAndFocusPin).id("row:\(wt.id)")
        }
    }

    // ── Keyboard focus order + arrow navigation ───────────────────────────────
    /// Visual order of arrow-navigable controls (rows + section headers).
    private var focusOrder: [String] {
        let pinned = store.worktrees.filter { $0.tier == "pinned" }
        let active = store.worktrees.filter { $0.tier == "active" }
        let other  = store.worktrees.filter { $0.tier == "other" }
        var keys = pinned.map { "row:\($0.id)" }
        if !active.isEmpty { keys.append("sec:ACTIVE"); if activeOpen { keys += active.map { "row:\($0.id)" } } }
        if !other.isEmpty  { keys.append("sec:MORE");   if moreOpen   { keys += other.map  { "row:\($0.id)" } } }
        return keys
    }

    private func move(_ from: String, _ dir: MoveCommandDirection) {
        let order = focusOrder
        guard let i = order.firstIndex(of: from) else { return }
        switch dir {
        case .down: if i + 1 < order.count { focused = order[i + 1] }
        case .up:   if i > 0 { focused = order[i - 1] }
        default: break
        }
    }

    /// After (un)pinning, open the section the item landed in (so its button exists),
    /// then re-focus that same item's pin button on the next tick.
    private func revealAndFocusPin(_ cwd: String) {
        switch store.worktrees.first(where: { $0.id == cwd })?.tier {
        case "active": activeOpen = true
        case "other":  moreOpen = true
        default: break   // "pinned" is always visible
        }
        DispatchQueue.main.async { focused = "pin:\(cwd)" }
    }

    private func sectionLabel(_ text: String) -> some View {
        HStack {
            Text(text).font(.system(size: 10, weight: .semibold, design: .monospaced)).kerning(1).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6)
    }

    /// A full-width, keyboard-activatable accordion header with a disclosure chevron.
    private func accordionHeader(_ title: String, count: Int, isOpen: Bool, _ toggle: @escaping () -> Void) -> some View {
        let key = "sec:\(title)"
        return Button(action: toggle) {
            HStack(spacing: 8) {
                Image(systemName: isOpen ? "chevron.down" : "chevron.right").font(.system(size: 9))
                Text("\(title) · \(count)").font(.system(size: 10, weight: .semibold, design: .monospaced)).kerning(1)
                Spacer()
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6).foregroundStyle(.secondary)
            .contentShape(Rectangle())
        }.buttonStyle(.plain).cursor(.pointingHand)
            .focused($focused, equals: key)
            .id(key)
            .onMoveCommand { move(key, $0) }
    }
}

/// A worktree row: click to open, plus pin + notes. Draggable; pinned rows accept drops (reorder).
struct RowView: View {
    let wt: Worktree
    @ObservedObject var store: WorktreeStore
    var focus: FocusState<String?>.Binding
    var onMove: (String, MoveCommandDirection) -> Void = { _, _ in }
    var onPinned: (String) -> Void = { _ in }
    var onDropRow: ((String) -> Void)? = nil
    @State private var ideasOpen = false
    @State private var draft = ""
    @State private var hover = false
    @State private var notesHover = false
    @State private var copiedId: String?
    @FocusState private var noteFocused: Bool

    private var notes: [Idea] { store.ideas.filter { $0.cwd == wt.id } }

    var body: some View {
        VStack(spacing: 0) {
            // ── Name + status, with a pin icon button at the top-right ──
            HStack(spacing: 10) {
                Button { Actions.open(wt) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(wt.folder).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundStyle(.white).lineLimit(1)
                            if wt.pooled { chip("eph") }
                            if let h = wt.host { chip(h) }
                        }
                        Text(sub).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }.buttonStyle(.plain).cursor(.pointingHand)
                    .focused(focus, equals: "row:\(wt.id)")     // scroll + arrow target
                    .onMoveCommand { onMove("row:\(wt.id)", $0) }

                Text(wt.shortCode).font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(statusColor(wt.state)).frame(width: 46, alignment: .trailing)

                Button { togglePin() } label: {
                    Image(systemName: wt.pinned ? "pin.fill" : "pin")
                        .font(.system(size: 12))
                        .foregroundStyle(wt.pinned ? statusColor("done") : Color.secondary)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).cursor(.pointingHand)
                    .help(wt.pinned ? "Unpin" : "Pin")
                    .focused(focus, equals: "pin:\(wt.id)")
                    .id("pin:\(wt.id)")
            }
            .padding(.horizontal, 14).padding(.top, 9).padding(.bottom, 4)

            // ── Notes accordion (full-width header) ──
            Button { ideasOpen.toggle() } label: {
                HStack(spacing: 8) {
                    Image(systemName: ideasOpen ? "chevron.down" : "chevron.right").font(.system(size: 9))
                    Text(wt.ideasCount > 0 ? "Notes · \(wt.ideasCount)" : "Notes")
                        .font(.system(size: 10.5, design: .monospaced))
                    Spacer()
                }
                .foregroundStyle(wt.ideasCount > 0 ? statusColor("waiting") : Color.secondary)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(notesHover ? Color.white.opacity(0.06) : .clear)
                .contentShape(Rectangle())
            }.buttonStyle(.plain).cursor(.pointingHand)
                .onHover { notesHover = $0 }
                .focused(focus, equals: "notes:\(wt.id)")
                .id("notes:\(wt.id)")

            if ideasOpen { ideasPanel }
        }
        .background(hover ? Color.white.opacity(0.05) : Color.clear)
        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.05)).frame(height: 1) }
        .onHover { hover = $0 }
        .onChange(of: ideasOpen) { open in
            if open { DispatchQueue.main.async { noteFocused = true } }   // auto-focus the input
        }
        .onDrag {
            NSCursor.closedHand.set()   // grabbing, at drag start
            return NSItemProvider(object: wt.id as NSString)
        }
        .applyIf(onDropRow != nil) { view in
            view.onDrop(of: [.text], isTargeted: nil) { providers in
                _ = providers.first?.loadObject(ofClass: NSString.self) { obj, _ in
                    if let c = obj as? String { DispatchQueue.main.async { onDropRow?(c) } }
                }
                return true
            }
        }
    }

    private var sub: String {
        let base = wt.repo.isEmpty ? wt.branch : "\(wt.repo):\(wt.branch)"
        if let t = wt.title, !t.isEmpty { return "\(base) · \(t)" }
        return base
    }

    private var ideasPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(notes) { idea in
                HStack(spacing: 6) {
                    Text(idea.text).font(.system(size: 11.5, design: .monospaced)).foregroundStyle(.white.opacity(0.85))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { copyNote(idea) }   // click to copy
                        .cursor(.pointingHand)
                        .help("Click to copy")
                    if copiedId == idea.id {
                        Text("copied").font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(statusColor("done"))
                    }
                    Button { Actions.removeIdea(id: idea.id); store.reload() } label: {
                        Image(systemName: "xmark").font(.system(size: 9)).foregroundStyle(.secondary)
                    }.buttonStyle(.plain).cursor(.pointingHand)
                }
                .padding(.horizontal, 9).padding(.vertical, 7)
                .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 6))
            }
            TextField("park a note… ↵", text: $draft)
                .textFieldStyle(.plain)
                .font(.system(size: 11.5, design: .monospaced))
                .padding(.horizontal, 9).padding(.vertical, 7)
                .background(Color.black.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(statusColor("working").opacity(0.4)))
                .focused($noteFocused)
                .onSubmit { addNote() }
        }
        .padding(.horizontal, 14).padding(.bottom, 10).padding(.leading, 16)
    }

    private func chip(_ t: String) -> some View {
        Text(t).font(.system(size: 8.5, design: .monospaced)).foregroundStyle(.secondary)
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 4))
    }

    private func togglePin() {
        var order = store.worktrees.filter { $0.tier == "pinned" }.sorted { $0.pinIndex < $1.pinIndex }.map { $0.id }
        if wt.pinned { order.removeAll { $0 == wt.id } } else { order.append(wt.id) }
        Actions.setPins(order); store.reload()
        // The row jumps to another section (new view identity), which drops focus.
        // Let the parent reveal the destination section, then re-focus the same item.
        onPinned(wt.id)
    }

    private func addNote() {
        let t = draft.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        Actions.addIdea(text: t, cwd: wt.id); draft = ""; store.reload()
    }

    private func copyNote(_ idea: Idea) {
        Actions.copyText(idea.text)
        copiedId = idea.id
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            if copiedId == idea.id { copiedId = nil }
        }
    }
}
