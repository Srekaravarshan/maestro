import Foundation
import Combine

/// Reads the local file contract (hooks + ~/.claude/projects + pins + ideas),
/// computes tiers, and drives the attention alert. No server, no network.
final class WorktreeStore: ObservableObject {
    @Published private(set) var worktrees: [Worktree] = []
    @Published private(set) var ideas: [Idea] = []

    private let hud: HUDState
    private var timer: Timer?
    private var prevState: [String: String] = [:]
    private var attnClear: DispatchWorkItem?
    private let activeWindow: TimeInterval = 900   // 15 min
    private let staleWorking: TimeInterval = 600   // 10 min

    init(hud: HUDState) { self.hud = hud }

    func start() {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    // ── Public actions delegate to Actions but refresh immediately ──────────
    func reload() { refresh() }

    // ── Refresh ──────────────────────────────────────────────────────────────
    func refresh() {
        let pins = readPins()
        let ideas = readIdeas()
        self.ideas = ideas
        let status = readStatus()
        let now = Date().timeIntervalSince1970

        var byCwd: [String: Worktree] = [:]

        // 1) Every folder Claude Code has a session for.
        let fm = FileManager.default
        if let dirs = try? fm.contentsOfDirectory(
            at: Paths.claudeProjects,
            includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]
        ) {
            for dir in dirs {
                guard (try? dir.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true,
                      let newest = newestJSONL(in: dir) else { continue }
                let meta = parseHead(newest.url)
                guard let cwd = meta.cwd else { continue }
                var wt = Worktree(id: cwd, repo: "", branch: meta.branch ?? (cwd as NSString).lastPathComponent, state: "unknown", host: nil)
                wt.title = meta.title
                wt.sessionId = newest.url.deletingPathExtension().lastPathComponent
                wt.lastActivity = newest.mtime
                wt.pooled = cwd.contains("/.claude/worktrees/")
                byCwd[cwd] = wt
            }
        }

        // 2) Any folder with a hook status file but no project dir.
        for (cwd, rec) in status where byCwd[cwd] == nil {
            byCwd[cwd] = Worktree(id: cwd, repo: rec.repo ?? "",
                                  branch: rec.branch ?? (cwd as NSString).lastPathComponent,
                                  state: "unknown", host: nil)
        }

        // 3) Merge hook status + pins + ideas-count + tier.
        var list: [Worktree] = []
        for (cwd, base) in byCwd {
            var wt = base
            if let rec = status[cwd] {
                var st = rec.state
                if st == "working", let ts = rec.ts, now - ts > staleWorking { st = "unknown" }
                wt.state = st
                wt.host = rec.host
                if wt.repo.isEmpty { wt.repo = rec.repo ?? "" }
            }
            if let idx = pins.firstIndex(of: cwd) { wt.pinned = true; wt.pinIndex = idx }
            wt.ideasCount = ideas.filter { $0.cwd == cwd }.count
            let liveHook = wt.state == "working" || wt.state == "waiting"
            let recent = wt.lastActivity > 0 && (now - wt.lastActivity) < activeWindow
            wt.tier = wt.pinned ? "pinned" : ((liveHook || recent) ? "active" : "other")
            list.append(wt)
        }

        list.sort { a, b in
            if tierRank(a.tier) != tierRank(b.tier) { return tierRank(a.tier) < tierRank(b.tier) }
            if a.tier == "pinned" { return a.pinIndex < b.pinIndex }
            return a.lastActivity > b.lastActivity
        }

        detectAttention(list)
        if list != worktrees { worktrees = list }
    }

    private func tierRank(_ t: String) -> Int { t == "pinned" ? 0 : (t == "active" ? 1 : 2) }

    // ── Attention on status transition ──────────────────────────────────────
    private func detectAttention(_ list: [Worktree]) {
        var next: [String: String] = [:]
        var fired: Worktree?
        var kind: String?
        for wt in list {
            next[wt.id] = wt.state
            guard let from = prevState[wt.id], from != wt.state else { continue }
            let to = wt.state
            if to == "waiting" || to == "blocked" || to == "error" || to == "done" {
                fired = wt; kind = (to == "blocked" ? "waiting" : to)
            } else if to == "idle", from == "working" || from == "waiting" {
                fired = wt; kind = "done"
            }
        }
        prevState = next

        if let wt = fired, let k = kind, hud.mode != .expanded {
            let time = Self.hhmm.string(from: Date())
            hud.attention = AttentionInfo(id: wt.id, folder: wt.folder, state: k, host: wt.host, time: time)
            Actions.playSound(k)
            attnClear?.cancel()
            let work = DispatchWorkItem { [weak self] in
                if self?.hud.mode != .expanded { self?.hud.attention = nil }
            }
            attnClear = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 8.0, execute: work)
        }
    }

    private static let hhmm: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; return f
    }()

    // ── Readers ────────────────────────────────────────────────────────────
    struct StatusRec { let state: String; let host: String?; let repo: String?; let branch: String?; let ts: Double? }

    private func readStatus() -> [String: StatusRec] {
        var out: [String: StatusRec] = [:]
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: Paths.statusDir, includingPropertiesForKeys: nil) else { return out }
        for f in files where f.pathExtension == "json" {
            guard let data = try? Data(contentsOf: f),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = obj["id"] as? String,
                  let state = obj["state"] as? String else { continue }
            out[id] = StatusRec(
                state: state,
                host: obj["host"] as? String,
                repo: obj["repo"] as? String,
                branch: obj["branch"] as? String,
                ts: (obj["ts"] as? NSNumber)?.doubleValue
            )
        }
        return out
    }

    private func readPins() -> [String] {
        guard let data = try? Data(contentsOf: Paths.pinsFile),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let pins = obj["pins"] as? [String] else { return [] }
        return pins
    }

    private func readIdeas() -> [Idea] {
        guard let data = try? Data(contentsOf: Paths.queueFile),
              let arr = try? JSONDecoder().decode([Idea].self, from: data) else { return [] }
        return arr
    }

    private func newestJSONL(in dir: URL) -> (url: URL, mtime: TimeInterval)? {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return nil }
        var best: (URL, TimeInterval)?
        for f in files where f.pathExtension == "jsonl" {
            let m = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate?.timeIntervalSince1970 ?? 0
            if best == nil || m > best!.1 { best = (f, m) }
        }
        guard let b = best else { return nil }
        return (b.0, b.1)
    }

    private func parseHead(_ url: URL) -> (cwd: String?, branch: String?, title: String?) {
        guard let fh = try? FileHandle(forReadingFrom: url) else { return (nil, nil, nil) }
        defer { try? fh.close() }
        let data = (try? fh.read(upToCount: 65536)) ?? Data()
        let text = String(data: data, encoding: .utf8) ?? ""
        var cwd: String?, branch: String?, title: String?
        for line in text.split(separator: "\n") {
            guard let d = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { continue }
            if cwd == nil, let c = obj["cwd"] as? String { cwd = c }
            if branch == nil, let b = obj["gitBranch"] as? String { branch = b }
            if title == nil, (obj["type"] as? String) == "ai-title", let t = obj["aiTitle"] as? String { title = t }
            if cwd != nil && branch != nil && title != nil { break }
        }
        return (cwd, branch, title)
    }

    /// Summary counts for the collapsed pill — pinned worktrees only, so the pill
    /// reflects the sessions the user actually cares about (not every active one).
    var counts: (work: Int, block: Int, err: Int, done: Int) {
        var w = 0, b = 0, e = 0, d = 0
        for wt in worktrees where wt.tier == "pinned" {
            switch wt.state {
            case "working": w += 1
            case "waiting", "blocked": b += 1
            case "error": e += 1
            case "done": d += 1
            default: break
            }
        }
        return (w, b, e, d)
    }
}
