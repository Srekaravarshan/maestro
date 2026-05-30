# Maestro

A native macOS terminal multiplexer and AI agent monitor — built to eliminate context switching when running multiple Claude Code sessions in parallel.

**The problem:** Running 3–4 Claude Code agents across git worktrees means constantly switching terminals to check which one finished, which one is waiting, which one errored. Maestro makes them report back to you.

---

## What it does

- **Split terminal view** — real shells, one per worktree. `Ctrl+1/2/3` to jump instantly.
- **Agent state monitoring** — Claude Code hooks report working/idle/waiting state in real time. Terminals glow when they need attention.
- **`Cmd+O`** — focuses the VS Code window for the active terminal without leaving the keyboard.
- **Git status** — dirty files, ahead/behind, no upstream — across all worktrees at a glance.
- **Sidebar** — all worktrees visible, each with Claude state + git status. `Cmd+B` to toggle.

Built with Tauri (Rust) + React + xterm.js.

---

## Requirements

- macOS
- [Rust](https://rustup.rs/)
- Node.js 18+
- [Claude Code](https://claude.ai/code)

---

## Setup

### 1. Install dependencies

```bash
# Server
cd server && npm install && npm run build

# Dashboard
cd ../dashboard && npm install
```

### 2. Register your repos

```bash
cd server
node dist/index.js --add-repo /path/to/your/repo
```

### 3. Wire Claude Code hooks

```bash
bash hooks/install.sh
```

This adds lifecycle hooks to `~/.claude/settings.json` that report agent state to Maestro automatically.

### 4. Register the MCP server with Claude Code

```bash
claude mcp add --scope user maestro \
  /path/to/node \
  "/path/to/maestro/server/dist/index.js"
```

Add this to `~/.claude/CLAUDE.md`:

```
You have access to the Maestro MCP server. At session start:
1. Call register_agent with your cwd as project_path and a one-sentence task description. Store the returned agent_id.
2. After each significant action, call report_status.
3. When done, call report_done with a summary.
4. If you need input, call report_blocked with a specific question.
5. On unrecoverable error, call report_error.
```

---

## Running

```bash
# Terminal 1 — monitoring server (keep this running)
cd server && npm start

# Terminal 2 — native app
cd dashboard && npx tauri dev
```

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+B` | Toggle sidebar |
| `Cmd+O` | Focus VS Code for active terminal |
| `Cmd+E` | Toggle expand mode (3+ terminals) |
| `Cmd+1-9` | Switch to Nth open terminal |
| `Ctrl+1-9` | Open/focus Nth sidebar worktree |
| `Cmd+Shift+K` | Clear all attention glows |
| `Shift+Enter` | Type `\` for Claude Code line continuation |
| `Cmd+Backspace` | Delete to start of line |
| `Opt+Backspace` | Delete word backward |
| `Cmd+←/→` | Jump to line start/end |
| `Opt+←/→` | Jump word backward/forward |
| `Cmd+K` | Clear terminal screen |

---

## How agent state works

```
Claude Code session
  ├── Hooks (set-state.sh) → working / idle / waiting
  └── MCP tools → task, current activity, done summary, blocked question
```

Both signals merge on each terminal row. The hooks give you session state automatically. The MCP tools give you rich context about what Claude is doing.

---

## Data stored locally

All state is in `~/.worktree-dash/`:
- `repos.json` — registered repo paths
- `sessions.json` — persisted agent sessions
- `open-terminals.json` — restored on next launch
- `status/` — hook state files per worktree

---

## License

MIT
