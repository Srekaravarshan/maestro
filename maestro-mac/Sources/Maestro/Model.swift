import Foundation

/// A worktree row as shown in the HUD.
struct Worktree: Identifiable, Hashable {
    let id: String        // absolute cwd — the stable key
    var repo: String
    var branch: String
    var state: String     // working | idle | waiting | done | error | unknown
    var host: String?     // vscode | iterm | terminal | tmux | app
    var title: String?
    var sessionId: String?
    var pooled: Bool = false
    var lastActivity: TimeInterval = 0   // unix seconds
    var pinned: Bool = false
    var pinIndex: Int = 0
    var tier: String = "other"           // pinned | active | other
    var ideasCount: Int = 0

    var folder: String { (id as NSString).lastPathComponent }

    var shortCode: String {
        switch state {
        case "working": return "WORK"
        case "waiting", "blocked": return "BLOCK"
        case "done": return "DONE"
        case "error": return "ERR"
        default: return "IDLE"
        }
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
    static var pinsFile: URL { dashDir.appending(path: "pins.json") }
    static var queueFile: URL { dashDir.appending(path: "prompt-queue.json") }
    static var claudeProjects: URL { home.appending(path: ".claude/projects") }
}
