import Foundation

/// One rendered line of the conversation.
struct ChatMessage: Identifiable, Equatable {
    enum Role { case user, assistant }
    let id: String
    let role: Role
    let text: String
}

/// Reads Claude Code session transcripts (~/.claude/projects/<enc>/<sessionId>.jsonl).
/// NOTE: this on-disk format is internal to Claude Code and can change between
/// versions — parsing is deliberately defensive (unknown fields are ignored).
enum Transcript {
    /// Locate the transcript file for a session id (filename == session id).
    static func fileURL(sessionId: String) -> URL? {
        let root = Paths.claudeProjects
        guard let dirs = try? FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: nil) else { return nil }
        for dir in dirs {
            let candidate = dir.appendingPathComponent("\(sessionId).jsonl")
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        }
        return nil
    }

    /// Tail-read the transcript (last `maxBytes`) and parse into chat messages.
    /// Returns the file size too, so callers can skip re-parsing when unchanged.
    static func load(sessionId: String, maxBytes: UInt64 = 400_000) -> (messages: [ChatMessage], size: UInt64) {
        guard let url = fileURL(sessionId: sessionId),
              let fh = try? FileHandle(forReadingFrom: url) else { return ([], 0) }
        defer { try? fh.close() }
        let size = (try? fh.seekToEnd()) ?? 0
        let start = size > maxBytes ? size - maxBytes : 0
        try? fh.seek(toOffset: start)
        let data = (try? fh.readToEnd()) ?? Data()
        var text = String(data: data, encoding: .utf8) ?? ""
        if start > 0, let nl = text.firstIndex(of: "\n") {   // drop the partial first line
            text = String(text[text.index(after: nl)...])
        }
        var out: [ChatMessage] = []
        for line in text.split(separator: "\n") {
            guard let d = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let m = message(from: obj) else { continue }
            out.append(m)
        }
        return (out, size)
    }

    private static func message(from obj: [String: Any]) -> ChatMessage? {
        let type = obj["type"] as? String
        guard type == "user" || type == "assistant",
              let msg = obj["message"] as? [String: Any] else { return nil }
        let text = extractText(msg["content"]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let id = (obj["uuid"] as? String) ?? UUID().uuidString
        return ChatMessage(id: id, role: type == "user" ? .user : .assistant, text: text)
    }

    /// `content` is either a plain String or an array of typed blocks.
    static func extractText(_ content: Any?) -> String {
        if let s = content as? String { return s }
        guard let blocks = content as? [[String: Any]] else { return "" }
        var parts: [String] = []
        for b in blocks {
            switch b["type"] as? String {
            case "text":     if let t = b["text"] as? String { parts.append(t) }
            case "tool_use": if let n = b["name"] as? String { parts.append("⚙ \(n)") }
            default:         break   // skip thinking / tool_result noise
            }
        }
        return parts.joined(separator: "\n")
    }
}
