#!/usr/bin/env python3
"""
maestro-sessions — find and resume Claude Code sessions across all worktrees.

Usage:
  maestro-sessions list                   # list all sessions, newest first
  maestro-sessions search <keyword>       # search session content for keyword
  maestro-sessions resume <session-id>    # print the resume command for a session

Examples:
  maestro-sessions list
  maestro-sessions search "email share amp"
  maestro-sessions search "ngrok webhook"
"""

import os
import sys
import json
import re
from datetime import datetime, timezone
from pathlib import Path

PROJECTS_DIR = Path.home() / ".claude" / "projects"


# ── JSONL reader ──────────────────────────────────────────────────────────────

def read_session(jsonl_path: Path) -> dict:
    """Extract key metadata from a Claude Code JSONL session file."""
    meta = {
        "id":       jsonl_path.stem,                  # UUID = filename without .jsonl
        "file":     str(jsonl_path),
        "title":    None,
        "cwd":      None,
        "branch":   None,
        "preview":  None,
        "ts":       None,
        "messages": [],                               # list of (role, text) snippets
    }

    try:
        with open(jsonl_path, encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                t = obj.get("type", "")

                if t == "ai-title" and not meta["title"]:
                    meta["title"] = obj.get("aiTitle")

                elif t == "user":
                    if not meta["cwd"]:
                        meta["cwd"]    = obj.get("cwd")
                        meta["branch"] = obj.get("gitBranch")
                        meta["ts"]     = obj.get("timestamp")
                    # Extract text from message content
                    content = obj.get("message", {}).get("content", "")
                    text = _extract_text(content)
                    if text:
                        meta["messages"].append(("user", text))
                        if not meta["preview"]:
                            meta["preview"] = text[:100]

                elif t == "assistant":
                    content = obj.get("message", {}).get("content", "")
                    text = _extract_text(content)
                    if text:
                        meta["messages"].append(("assistant", text[:200]))

    except Exception:
        pass

    return meta


def _extract_text(content) -> str:
    """Pull plain text out of Claude's content field (string or block list)."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return " ".join(parts).strip()
    return ""


# ── Session discovery ─────────────────────────────────────────────────────────

def iter_sessions():
    """Yield session dicts for every JSONL in ~/.claude/projects/, newest first."""
    if not PROJECTS_DIR.exists():
        return

    sessions = []
    for project_dir in PROJECTS_DIR.iterdir():
        if not project_dir.is_dir():
            continue
        for jsonl in project_dir.glob("*.jsonl"):
            sessions.append(jsonl)

    # Sort by modification time, newest first
    sessions.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    for jsonl in sessions:
        yield read_session(jsonl)


# ── Display helpers ───────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
CYAN   = "\033[36m"
GREEN  = "\033[32m"
YELLOW = "\033[33m"
RED    = "\033[31m"


def fmt_date(ts_str) -> str:
    if not ts_str:
        return "unknown date"
    try:
        # ISO 8601 with or without Z
        ts_str = str(ts_str).replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts_str).astimezone()
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(ts_str)[:16]


def short_path(p: str) -> str:
    if not p:
        return "unknown"
    home = str(Path.home())
    if p.startswith(home):
        return "~" + p[len(home):]
    return p


def print_session(s: dict, highlight: str = None):
    title  = s["title"]  or s["preview"] or "(untitled)"
    cwd    = short_path(s["cwd"])
    branch = s["branch"] or ""
    date   = fmt_date(s["ts"])
    sid    = s["id"]

    print(f"{BOLD}{CYAN}{title}{RESET}")
    print(f"  {DIM}{date}{RESET}  {GREEN}{cwd}{RESET}" + (f"  {YELLOW}[{branch}]{RESET}" if branch else ""))
    print(f"  {DIM}Session: {sid}{RESET}")

    if highlight and s["messages"]:
        kw = highlight.lower()
        shown = 0
        for role, text in s["messages"]:
            if kw in text.lower() and shown < 2:
                idx = text.lower().find(kw)
                start = max(0, idx - 40)
                end   = min(len(text), idx + len(kw) + 60)
                snippet = text[start:end].replace("\n", " ")
                if start > 0:
                    snippet = "…" + snippet
                if end < len(text):
                    snippet = snippet + "…"
                # Highlight keyword
                snippet = re.sub(
                    re.escape(kw), f"{BOLD}{RED}\\g<0>{RESET}", snippet, flags=re.IGNORECASE
                )
                label = "you" if role == "user" else " ai"
                print(f"  {DIM}[{label}]{RESET} {snippet}")
                shown += 1

    print(f"  {DIM}→ cd {s['cwd'] or '.'} && claude --resume {sid}{RESET}")
    print()


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_list(args):
    count = int(args[0]) if args and args[0].isdigit() else 20
    print(f"{BOLD}Recent Claude Code sessions (last {count}):{RESET}\n")
    shown = 0
    for s in iter_sessions():
        if shown >= count:
            break
        print_session(s)
        shown += 1
    if shown == 0:
        print(f"{RED}No sessions found in {PROJECTS_DIR}{RESET}")
    else:
        print(f"{DIM}Showing {shown} sessions. Run with a number to see more: maestro-sessions list 50{RESET}")


def cmd_search(args):
    if not args:
        print(f"{RED}Usage: maestro-sessions search <keyword>{RESET}", file=sys.stderr)
        sys.exit(1)

    keyword = " ".join(args).lower()
    print(f"{BOLD}Searching for: \"{keyword}\"{RESET}\n")

    found = 0
    for s in iter_sessions():
        # Check title, preview, cwd, branch, and message text
        haystack = " ".join([
            s["title"]  or "",
            s["preview"] or "",
            s["cwd"]    or "",
            s["branch"] or "",
            " ".join(t for _, t in s["messages"]),
        ]).lower()

        if keyword in haystack:
            print_session(s, highlight=keyword)
            found += 1

    if found == 0:
        print(f"{RED}No sessions found matching \"{keyword}\"{RESET}")
    else:
        print(f"{GREEN}Found {found} matching session(s).{RESET}")
        print()
        print(f"{DIM}To resume a session in a DIFFERENT worktree than the original:{RESET}")
        print(f"{DIM}  cd <your-new-worktree> && claude --resume <session-id>{RESET}")
        print(f"{DIM}Claude will continue the conversation but work in the new directory.{RESET}")


def cmd_resume(args):
    if not args:
        print(f"{RED}Usage: maestro-sessions resume <session-id>{RESET}", file=sys.stderr)
        sys.exit(1)

    sid = args[0]
    for s in iter_sessions():
        if s["id"] == sid:
            print(f"{BOLD}Session found:{RESET} {s['title'] or s['preview'] or '(untitled)'}")
            print(f"Original path: {s['cwd']}")
            print()
            print(f"{BOLD}Resume in original worktree:{RESET}")
            print(f"  cd {s['cwd']} && claude --resume {sid}")
            print()
            print(f"{BOLD}Resume in current directory:{RESET}")
            print(f"  claude --resume {sid}")
            return

    print(f"{RED}Session not found: {sid}{RESET}", file=sys.stderr)
    sys.exit(1)


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    cmd  = args[0]
    rest = args[1:]

    if cmd == "list":
        cmd_list(rest)
    elif cmd == "search":
        cmd_search(rest)
    elif cmd == "resume":
        cmd_resume(rest)
    else:
        # Treat unknown first arg as a search keyword shorthand
        cmd_search(args)


if __name__ == "__main__":
    main()
