import Foundation

/// One Claude Code session (one transcript file). A folder can host several.
struct Session: Identifiable, Hashable {
    let id: String            // sessionId (== transcript filename)
    var cwd: String           // owning folder
    var title: String?        // aiTitle
    var branch: String
    var state: String         // working | idle | waiting | done | error | unknown
    var host: String?         // vscode | iterm | terminal | tmux | warp | app
    var lastActivity: TimeInterval = 0
    var pinned: Bool = false   // pinned session → kept visible in the collapsed accordion

    var isRunning: Bool { state == "working" || state == "waiting" || state == "blocked" }

    var label: String {
        if let t = title, !t.isEmpty { return t }
        return String(id.prefix(6))
    }

    var shortCode: String {
        switch state {
        case "working":            return "WORK"
        case "waiting", "blocked": return "BLOCK"
        case "done":               return "DONE"
        case "error":              return "ERR"
        default:                   return "IDLE"
        }
    }
}

/// A folder (worktree) grouping its sessions. Top-level accordion item in the HUD.
struct Folder: Identifiable, Hashable {
    let id: String            // absolute cwd — the stable key
    var repo: String
    var branch: String
    var sessions: [Session]
    var pinned: Bool = false
    var pinIndex: Int = 0
    var tier: String = "other"           // pinned | active | other
    var ideasCount: Int = 0

    var name: String { (id as NSString).lastPathComponent }
    var runningCount: Int { sessions.filter { $0.isRunning }.count }
    var lastActivity: TimeInterval { sessions.map { $0.lastActivity }.max() ?? 0 }

    /// Sessions shown while the accordion is collapsed: running ∪ pinned.
    var collapsedSessions: [Session] { sessions.filter { $0.isRunning || $0.pinned } }

    /// Dominant status for the header summary (worst-first).
    var aggregate: String {
        if sessions.contains(where: { $0.state == "error" }) { return "error" }
        if sessions.contains(where: { $0.state == "waiting" || $0.state == "blocked" }) { return "waiting" }
        if sessions.contains(where: { $0.state == "working" }) { return "working" }
        if sessions.contains(where: { $0.state == "done" }) { return "done" }
        return "idle"
    }
}

/// A parked idea (note), stored in prompt-queue.json.
struct Idea: Identifiable, Hashable, Codable {
    let id: String
    let text: String
    let ts: Double?
    let cwd: String?
}

/// Well-known on-disk locations — the contract shared with the Claude Code hooks.
enum Paths {
    static let home = FileManager.default.homeDirectoryForCurrentUser
    static var dashDir: URL { home.appending(path: ".worktree-dash") }
    static var statusDir: URL { dashDir.appending(path: "status") }
    static var pinsFile: URL { dashDir.appending(path: "pins.json") }              // folder pins
    static var sessionPinsFile: URL { dashDir.appending(path: "session-pins.json") } // session pins
    static var queueFile: URL { dashDir.appending(path: "prompt-queue.json") }
    static var claudeProjects: URL { home.appending(path: ".claude/projects") }
}
