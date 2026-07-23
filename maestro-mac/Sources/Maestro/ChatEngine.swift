import Foundation

/// Sends a message to a Claude Code session via the supported headless path:
/// `claude --print --resume=<id> --output-format=stream-json --verbose "<msg>"`
/// run from the session's cwd. Streams the assistant reply as it arrives.
final class ChatEngine: ObservableObject {
    @Published var streaming = ""       // assistant text for the in-flight turn
    @Published var isSending = false
    @Published var errorText: String?

    private var process: Process?
    private var buffer = Data()

    func send(message: String, sessionId: String, cwd: String, onFinished: @escaping () -> Void) {
        guard !isSending else { return }
        let msg = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !msg.isEmpty else { return }
        // The session id is interpolated into the shell command, so allow only safe
        // characters; the user's message is passed via an env var (never interpolated).
        guard sessionId.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil else {
            errorText = "Invalid session id"; return
        }

        isSending = true; streaming = ""; errorText = nil; buffer = Data()

        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")   // login shell → user's PATH (node, claude)
        p.arguments = ["-lc",
            "claude --print --resume=\(sessionId) --output-format=stream-json --verbose \"$MAESTRO_MSG\""]
        p.currentDirectoryURL = URL(fileURLWithPath: cwd)     // resume is project-scoped
        var env = ProcessInfo.processInfo.environment
        env["MAESTRO_MSG"] = msg
        env["MAESTRO_HEADLESS"] = "1"   // tell set-state.sh to ignore our own hook fires
        p.environment = env

        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice   // discard (never blocks)
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            guard !d.isEmpty else { return }
            self?.consume(d)
        }
        p.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                out.fileHandleForReading.readabilityHandler = nil
                self?.isSending = false
                self?.process = nil
                onFinished()
            }
        }
        process = p
        do { try p.run() }
        catch {
            isSending = false
            errorText = "Couldn't launch claude: \(error.localizedDescription)"
        }
    }

    // ── Stream parsing (one JSON object per line) ─────────────────────────────
    private func consume(_ d: Data) {
        buffer.append(d)
        while let nl = buffer.firstIndex(of: 0x0A) {
            let line = buffer.subdata(in: buffer.startIndex..<nl)
            buffer.removeSubrange(buffer.startIndex...nl)
            guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            handle(obj)
        }
    }

    private func handle(_ obj: [String: Any]) {
        switch obj["type"] as? String {
        case "assistant":
            if let msg = obj["message"] as? [String: Any] {
                let t = Transcript.extractText(msg["content"])
                if !t.isEmpty { DispatchQueue.main.async { self.streaming = t } }
            }
        case "result":
            if let errs = obj["errors"] as? [String], let first = errs.first {
                DispatchQueue.main.async { self.errorText = first }
            }
        default:
            break
        }
    }
}
