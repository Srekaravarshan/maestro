import AppKit

/// Side-effecting actions (open, copy, sound, pins, ideas). All local.
enum Actions {
    // ── Open the worktree in its host app ────────────────────────────────────
    static func open(_ wt: Worktree) { openPath(wt.id, wt.host) }

    static func openPath(_ id: String, _ host: String?) {
        switch host {
        case "app":      run("/usr/bin/open", ["-b", "com.anthropic.claudefordesktop"])
        case "iterm":    run("/usr/bin/open", ["-a", "iTerm"])
        case "terminal": run("/usr/bin/open", ["-a", "Terminal"])
        default:         run("/usr/bin/open", ["-a", "Visual Studio Code", id])
        }
    }

    static func copyResume(_ wt: Worktree) {
        let cmd = wt.sessionId.map { "cd \"\(wt.id)\" && claude --resume \($0)" } ?? "cd \"\(wt.id)\" && claude"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(cmd, forType: .string)
    }

    // ── Alert sound (native system sounds) ───────────────────────────────────
    static func playSound(_ kind: String) {
        let name: String
        switch kind {
        case "done":  name = "Glass"
        case "error": name = "Basso"
        default:      name = "Ping"
        }
        NSSound(named: NSSound.Name(name))?.play()
    }

    // ── Pins (write the full ordered list; mirrors /api/pins/set) ─────────────
    static func setPins(_ order: [String]) {
        writeObject(Paths.pinsFile, ["pins": order])
    }

    // ── Ideas / notes ─────────────────────────────────────────────────────────
    static func addIdea(text: String, cwd: String) {
        var arr = readRawArray(Paths.queueFile)
        arr.append([
            "id": UUID().uuidString,
            "text": text,
            "ts": Date().timeIntervalSince1970 * 1000,
            "cwd": cwd,
        ])
        writeArray(Paths.queueFile, arr)
    }

    static func removeIdea(id: String) {
        var arr = readRawArray(Paths.queueFile)
        arr.removeAll { ($0["id"] as? String) == id }
        writeArray(Paths.queueFile, arr)
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    private static func run(_ launchPath: String, _ args: [String]) {
        let task = Process()
        task.launchPath = launchPath
        task.arguments = args
        try? task.run()
    }

    private static func ensureDir() {
        try? FileManager.default.createDirectory(at: Paths.dashDir, withIntermediateDirectories: true)
    }

    private static func readRawArray(_ url: URL) -> [[String: Any]] {
        guard let data = try? Data(contentsOf: url),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return arr
    }

    private static func writeArray(_ url: URL, _ arr: [[String: Any]]) {
        ensureDir()
        if let data = try? JSONSerialization.data(withJSONObject: arr, options: [.prettyPrinted]) {
            try? data.write(to: url)
        }
    }

    private static func writeObject(_ url: URL, _ obj: [String: Any]) {
        ensureDir()
        if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) {
            try? data.write(to: url)
        }
    }
}
