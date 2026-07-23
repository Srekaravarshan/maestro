import Foundation

/// Reads the local file contract (hooks + ~/.claude/projects + pins + ideas),
/// groups sessions by folder, computes tiers, and drives the attention alert.
final class WorktreeStore: ObservableObject {
    @Published private(set) var folders: [Folder] = []
    @Published private(set) var ideas: [Idea] = []

    private let hud: HUDState
    private var timer: Timer?
    private var prevState: [String: String] = [:]     // by sessionId
    private var attnClear: DispatchWorkItem?
    private var headCache: [String: (mtime: TimeInterval, cwd: String?, branch: String?, title: String?)] = [:]
    private let activeWindow: TimeInterval = 900   // 15 min
    private let staleWorking: TimeInterval = 600   // 10 min

    init(hud: HUDState) { self.hud = hud }

    func start() {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    func reload() { refresh() }

    // ── Refresh ──────────────────────────────────────────────────────────────
    func refresh() {
        let folderPins = readPins(Paths.pinsFile)
        let sessionPins = Set(readPins(Paths.sessionPinsFile))
        let ideas = readIdeas()
        self.ideas = ideas
        let status = readStatus()          // keyed by sessionId
        let now = Date().timeIntervalSince1970

        // 1) Every session (one jsonl per session), grouped by folder (cwd).
        var byCwd: [String: [Session]] = [:]
        let fm = FileManager.default
        if let dirs = try? fm.contentsOfDirectory(
            at: Paths.claudeProjects, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
            for dir in dirs {
                guard let files = try? fm.contentsOfDirectory(
                    at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { continue }
                for f in files where f.pathExtension == "jsonl" {
                    let mtime = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?
                        .contentModificationDate?.timeIntervalSince1970 ?? 0
                    let head = cachedHead(f, mtime: mtime)
                    guard let cwd = head.cwd else { continue }
                    let sid = f.deletingPathExtension().lastPathComponent
                    var s = Session(id: sid, cwd: cwd,
                                    title: head.title,
                                    branch: head.branch ?? (cwd as NSString).lastPathComponent,
                                    state: "idle", host: nil, lastActivity: mtime)
                    if let rec = status[sid] {
                        var st = rec.state
                        if st == "working", let ts = rec.ts, now - ts > staleWorking { st = "idle" }
                        s.state = st
                        s.host = rec.host
                        if let b = rec.branch, !b.isEmpty { s.branch = b }
                    }
                    s.pinned = sessionPins.contains(sid)
                    byCwd[cwd, default: []].append(s)
                }
            }
        }

        // 2) Build folders.
        var list: [Folder] = []
        for (cwd, rawSessions) in byCwd {
            var sessions = rawSessions
            // running first, then most-recent.
            sessions.sort { a, b in
                if a.isRunning != b.isRunning { return a.isRunning }
                return a.lastActivity > b.lastActivity
            }
            let repo = status.values.first(where: { $0.cwd == cwd })?.repo ?? ""
            var f = Folder(id: cwd, repo: repo,
                           branch: sessions.first?.branch ?? (cwd as NSString).lastPathComponent,
                           sessions: sessions)
            if let idx = folderPins.firstIndex(of: cwd) { f.pinned = true; f.pinIndex = idx }
            f.ideasCount = ideas.filter { $0.cwd == cwd }.count
            let anyLive = sessions.contains { $0.isRunning }
            let recent = f.lastActivity > 0 && (now - f.lastActivity) < activeWindow
            f.tier = f.pinned ? "pinned" : ((anyLive || recent) ? "active" : "other")
            list.append(f)
        }

        list.sort { a, b in
            if tierRank(a.tier) != tierRank(b.tier) { return tierRank(a.tier) < tierRank(b.tier) }
            if a.tier == "pinned" { return a.pinIndex < b.pinIndex }
            return a.lastActivity > b.lastActivity
        }

        detectAttention(list)
        if list != folders { folders = list }
    }

    private func tierRank(_ t: String) -> Int { t == "pinned" ? 0 : (t == "active" ? 1 : 2) }

    // ── Attention on per-session status transition ────────────────────────────
    private func detectAttention(_ list: [Folder]) {
        var next: [String: String] = [:]
        var firedCwd: String?, firedHost: String?, firedFolder: String?, kind: String?
        for f in list {
            for s in f.sessions {
                next[s.id] = s.state
                guard let from = prevState[s.id], from != s.state else { continue }
                let to = s.state
                if to == "waiting" || to == "blocked" || to == "error" || to == "done" {
                    firedCwd = s.cwd; firedHost = s.host; firedFolder = f.name
                    kind = (to == "blocked" ? "waiting" : to)
                } else if to == "idle", from == "working" || from == "waiting" {
                    firedCwd = s.cwd; firedHost = s.host; firedFolder = f.name; kind = "done"
                }
            }
        }
        prevState = next

        if let cwd = firedCwd, let k = kind, let folder = firedFolder, hud.mode != .expanded {
            let time = Self.hhmm.string(from: Date())
            hud.attention = AttentionInfo(id: cwd, folder: folder, state: k, host: firedHost, time: time)
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

    /// Running-session counts across PINNED folders (drives the collapsed pill).
    var counts: (work: Int, block: Int, err: Int, done: Int) {
        var w = 0, b = 0, e = 0, d = 0
        for f in folders where f.tier == "pinned" {
            for s in f.sessions {
                switch s.state {
                case "working": w += 1
                case "waiting", "blocked": b += 1
                case "error": e += 1
                case "done": d += 1
                default: break
                }
            }
        }
        return (w, b, e, d)
    }

    // ── Readers ────────────────────────────────────────────────────────────
    struct StatusRec { let state: String; let host: String?; let repo: String?; let branch: String?; let cwd: String?; let ts: Double? }

    private func readStatus() -> [String: StatusRec] {
        var out: [String: StatusRec] = [:]
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: Paths.statusDir, includingPropertiesForKeys: nil) else { return out }
        for f in files where f.pathExtension == "json" {
            guard let data = try? Data(contentsOf: f),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let sid = obj["sessionId"] as? String, !sid.isEmpty,
                  let state = obj["state"] as? String else { continue }
            out[sid] = StatusRec(
                state: state,
                host: obj["host"] as? String,
                repo: obj["repo"] as? String,
                branch: obj["branch"] as? String,
                cwd: obj["cwd"] as? String ?? obj["id"] as? String,
                ts: (obj["ts"] as? NSNumber)?.doubleValue
            )
        }
        return out
    }

    private func readPins(_ url: URL) -> [String] {
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let pins = obj["pins"] as? [String] else { return [] }
        return pins
    }

    private func readIdeas() -> [Idea] {
        guard let data = try? Data(contentsOf: Paths.queueFile),
              let arr = try? JSONDecoder().decode([Idea].self, from: data) else { return [] }
        return arr
    }

    private func cachedHead(_ url: URL, mtime: TimeInterval)
        -> (cwd: String?, branch: String?, title: String?) {
        if let c = headCache[url.path], c.mtime == mtime {
            return (c.cwd, c.branch, c.title)
        }
        let parsed = parseHead(url)
        headCache[url.path] = (mtime, parsed.cwd, parsed.branch, parsed.title)
        return parsed
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
}
