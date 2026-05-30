# LinkedIn Post

---

I've been running 3–4 Claude Code AI agents in parallel across different git worktrees.

Each one is working on a separate feature. Each one is in its own VS Code window. Each one might be done, stuck, or waiting for me to answer a question.

The way I was handling this? Tab-switching. Manually. One terminal at a time. "Is this one done? No. Is this one done? Still running. Oh, *this* one finished 8 minutes ago."

It was embarrassing how much time I was losing to that loop.

So I built something.

---

**Worktree Dash** — a native macOS terminal multiplexer + AI session monitor built with Tauri (Rust + React).

Here's what it does:

→ **Split terminal view** — up to 3 terminals side by side. Each one is a real shell in the right worktree directory. Click to focus, or press Ctrl+1/2/3 to jump without lifting your hands.

→ **Live Claude state** — Claude Code hooks write working/idle/waiting state in real time. When Claude finishes a task, the terminal border glows. Blue = done, amber = needs my input, red = error. I don't watch the dashboard — it tells me when to look.

→ **Agent context** — when Claude calls `report_status`, the task and what it's currently doing shows right on the terminal header. No switching to read the output.

→ **Cmd+O** — one keystroke focuses the VS Code window for whatever terminal I'm in. Built into Rust so it fires before the JS event loop even wakes up.

→ **Git status at a glance** — dirty files, ahead/behind upstream, no upstream. Across all worktrees simultaneously.

The thing I'm most proud of: every time I feel friction in the workflow, I open the app and add a feature. The tool is shaped entirely by real pain. No feature is there for show.

It runs locally on macOS. No cloud, no API keys, no subscription.

Might open source it. DMs open if you're running parallel AI agents and want to talk.

---

*Built with: Tauri 2, Rust (portable-pty), React, xterm.js, TypeScript, Claude Code MCP*

#DeveloperProductivity #AI #ClaudeCode #Tauri #Rust #SideProject
