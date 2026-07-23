import SwiftUI

/// In-card chat page for one session: read-only transcript (tailed live) + a
/// send box that continues the session headlessly.
struct ChatView: View {
    let folder: String
    let sessionId: String?
    let cwd: String
    var onBack: () -> Void = {}
    var onClose: () -> Void = {}

    @StateObject private var engine = ChatEngine()
    @State private var messages: [ChatMessage] = []
    @State private var lastSize: UInt64 = 0
    @State private var draft = ""
    @State private var timer: Timer?
    @FocusState private var inputFocused: Bool

    private let bodyHeight: CGFloat = 400

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(.white.opacity(0.1))
            transcript
            Divider().overlay(.white.opacity(0.1))
            inputBar
        }
        .frame(width: 360)
        .onAppear { reload(); startTimer(); inputFocused = sessionId != nil }
        .onDisappear { timer?.invalidate(); timer = nil }
    }

    // ── Header ────────────────────────────────────────────────────────────────
    private var header: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "chevron.left").font(.system(size: 12, weight: .bold)).foregroundStyle(.secondary)
                    .frame(width: 24, height: 24).contentShape(Rectangle())
            }.buttonStyle(.plain).cursor(.pointingHand).help("Back")
            Text(folder).font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundStyle(.white).lineLimit(1)
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary)
                    .frame(width: 24, height: 24).contentShape(Rectangle())
            }.buttonStyle(.plain).cursor(.pointingHand).help("Close")
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
    }

    // ── Transcript ──────────────────────────────────────────────────────────
    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if messages.isEmpty && !engine.isSending {
                        Text(sessionId == nil ? "No session transcript for this worktree yet."
                                              : "No messages yet.")
                            .font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 20)
                    }
                    ForEach(messages) { bubble($0.role, $0.text) }
                    if engine.isSending {
                        bubble(.assistant, engine.streaming.isEmpty ? "…" : engine.streaming)
                    }
                    Color.clear.frame(height: 1).id("BOTTOM")
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
            }
            .frame(height: bodyHeight)
            .onChange(of: messages) { _ in withAnimation { proxy.scrollTo("BOTTOM", anchor: .bottom) } }
            .onChange(of: engine.streaming) { _ in proxy.scrollTo("BOTTOM", anchor: .bottom) }
        }
    }

    private func bubble(_ role: ChatMessage.Role, _ text: String) -> some View {
        let mine = role == .user
        return HStack {
            if mine { Spacer(minLength: 40) }
            Text(text)
                .font(.system(size: 11.5, design: .monospaced))
                .foregroundStyle(mine ? .white : .white.opacity(0.85))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(mine ? statusColor("working").opacity(0.22) : Color.white.opacity(0.06),
                            in: RoundedRectangle(cornerRadius: 8))
            if !mine { Spacer(minLength: 40) }
        }
    }

    // ── Input ─────────────────────────────────────────────────────────────────
    private var inputBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let err = engine.errorText {
                Text(err).font(.system(size: 10, design: .monospaced)).foregroundStyle(statusColor("error"))
                    .lineLimit(2)
            }
            HStack(spacing: 8) {
                TextField(sessionId == nil ? "no session" : "message… ↵", text: $draft)
                    .textFieldStyle(.plain)
                    .font(.system(size: 11.5, design: .monospaced))
                    .padding(.horizontal, 9).padding(.vertical, 7)
                    .background(Color.black.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(statusColor("working").opacity(0.4)))
                    .focused($inputFocused)
                    .disabled(sessionId == nil || engine.isSending)
                    .onSubmit(send)
                Button(action: send) {
                    Image(systemName: engine.isSending ? "hourglass" : "arrow.up.circle.fill")
                        .font(.system(size: 18)).foregroundStyle(statusColor("working"))
                }.buttonStyle(.plain).cursor(.pointingHand)
                    .disabled(sessionId == nil || engine.isSending || draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            Text("↩ continues this session headlessly — may incur API cost (scales with context).")
                .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary.opacity(0.7))
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
    }

    // ── Data ────────────────────────────────────────────────────────────────
    private func send() {
        guard let sid = sessionId else { return }
        let text = draft
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        draft = ""
        engine.send(message: text, sessionId: sid, cwd: cwd) { reload() }
    }

    private func reload() {
        guard let sid = sessionId else { return }
        let r = Transcript.load(sessionId: sid)
        if r.size != lastSize || messages.isEmpty {
            lastSize = r.size
            messages = r.messages
        }
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { _ in reload() }
    }
}
