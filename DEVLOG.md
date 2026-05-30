# Worktree Dash — Dev Log

---

## Session 1 — Foundation + Agent Monitor

### What was built

**worktree-dash server** (`server/`)
- Repo registry (`~/.worktree-dash/repos.json`) — list of git repo roots to watch
- `list_worktrees` — discovers all worktrees per repo via `git worktree list --porcelain`, returns branch, git status (dirty/ahead/behind), color identity, server up/down, claude state
- All failure modes handled: ghost worktrees (prunable flag), detached HEAD (short SHA fallback), no upstream, stale claude status, per-repo isolation
- Filters out `.cursor/` and `.claude/` managed worktrees automatically
- Fixed branch name parsing bug (`/heads/` prefix was appearing)
- MCP tools: `list_worktrees`, `add_repo`, `remove_repo`, `list_repos`, `refresh`, `focus_worktree`, `open_in_browser`, `set_worktree_colors`, `register_agent`, `report_status`, `report_done`, `report_blocked`, `report_error`
- CLI modes: `--list`, `--add-repo`, `--remove-repo`, `--list-repos`, `--set-colors-all`, `--clear-colors-all`

**Agent store** (merged from agent-command-center)
- In-memory store keyed by worktree path (= worktree id — joins with zero mapping)
- Persisted to `~/.worktree-dash/sessions.json` — survives server restarts
- Stale session cleanup: sessions silent for 15+ mins auto-removed every 2 min
- Fields: task, current_activity, status (running/done/blocked/error), summary, question, error_msg, history

**HTTP server** (`server/src/http-server.ts`, port 3444)
- SSE endpoint (`/events`) — real-time state broadcast with heartbeat
- Agent endpoints: `POST /api/agent/register|status|done|blocked|error`
- Action endpoints: `POST /api/focus`, `POST /api/set-colors-all`, `POST /api/clear-colors-all`, `POST /api/refresh`
- Merges agent store data into worktree state before broadcasting
- Detects claude state transitions → adds to activity log
- `setNoDelay` on SSE clients to prevent TCP buffering

**Claude Code hooks** (`hooks/set-state.sh`)
- Writes `~/.worktree-dash/status/<hash>.json` on every session lifecycle event
- `SessionStart` + `UserPromptSubmit` → `working`
- `Stop` → `idle` + fires macOS notification (terminal-notifier or osascript fallback)
- `Notification` → `waiting`
- Pings `/api/refresh` after each write for immediate SSE broadcast
- `install.sh` — one-command setup, merges hooks into `~/.claude/settings.json` non-destructively

**VS Code color identity** (`server/src/vscode.ts`)
- `setWorktreeColors` — writes window chrome colors + `window.title` into `.vscode/settings.json`
- `clearWorktreeColors` — removes only the keys we wrote, leaves other settings untouched
- Color is `repo/branch` hash (never branch alone — repos can share branch names)

**Fuzzy worktree switcher** (`hooks/worktree-pick.sh`)
- fzf if available (fuzzy, fast), AppleScript choose-from-list fallback
- Shows branch, claude state, dirty indicator
- Selecting focuses VS Code via `open -a`
- Hotkey setup instructions: Automator Quick Action or Raycast script

---

## Session 2 — Native Desktop App (Tauri)

### Architecture pivot
Moved from browser (localhost:3444) to Tauri native macOS app. Eliminates browser keyboard shortcut conflicts, gives real window management, makes `Cmd+O` faster via direct Rust invocation.

```
Tauri window (React)
  ├── Tauri IPC → Rust backend → PTY → /bin/zsh
  └── SSE/fetch → Node.js monitoring server (port 3444)
```

### Rust backend (`dashboard/src-tauri/`)
- PTY management via `portable-pty` crate
- Commands: `create_terminal`, `write_terminal`, `resize_terminal`, `kill_terminal`, `list_terminals`, `focus_vscode`
- `focus_vscode` — Phase 1: `osascript activate` (~50ms visual snap), Phase 2: bundled `code` CLI via IPC
- Each terminal spawns fresh zsh in the worktree directory with clean env
- PTY reader runs in a dedicated thread, emits `terminal-output` and `terminal-exit` Tauri events

### Dashboard layout
- **Left sidebar (300px):** monitoring panel — stats, worktree list, attention states
  - Sidebar is a flex item (pushes terminals, no overlay)
  - Collapse with `Cmd+B` or `☰` button (no animation, instant)
  - Each row: branch name, folder name, git badges (M/↑/↓), status + timestamp, `^N` shortcut badge
  - Click → open terminal. `Cmd+click` → focus VS Code (removed; now `Cmd+O`)
  - `Ctrl+1-9` → open/focus Nth sidebar worktree
- **Right panel (flex-1):** xterm.js terminals
  - Split view (default) or Tabs, toggle with `⊞ Split` / `⊟ Tabs`
  - Split layout: 1=full, 2=side-by-side, 3=left full-height + 2 stacked right
  - **Expand mode** (`Cmd+E`, only with 3+ terminals): click any terminal → expands to fill, others collapse to 180px strip showing last activity
  - `Cmd+1-9` → switch to Nth open terminal (by open order)
  - `☰` button top-left toggles sidebar

### TerminalView (`dashboard/src/components/TerminalView.tsx`)
- xterm.js + FitAddon + WebLinksAddon
- **Stale closure fix**: `onGlobalShortcut`, `onBecameActive`, `onTerminalReady` held in refs — ensures effects with `[]` deps always call the latest callback
- **Mac keyboard shortcuts** (via `attachCustomKeyEventHandler`):
  - `Cmd+Backspace` → kill to line start (Ctrl+U)
  - `Opt+Backspace` → delete word (Ctrl+W)
  - `Cmd+←/→` → line start/end (Ctrl+A / Ctrl+E)
  - `Opt+←/→` → word backward/forward (ESC+b / ESC+f)
  - `Cmd+K` → clear screen (Ctrl+L)
  - `Cmd+O` → intercept (don't send to PTY), let window handler fire
  - `Ctrl+1-9` → intercepted inside xterm (stops at PTY, routes to `onGlobalShortcut`) — fixes the "terminal captures Ctrl" problem
- Double `requestAnimationFrame` for initial fit — waits for CSS grid to finish before measuring cols/rows (prevents text overlap/wrapping in Claude Code output)
- Resize observer debounced 60ms — prevents flood of PTY resize signals
- Active slot tracking via `term.textarea.addEventListener('focus')` — works even when xterm stops propagation on canvas clicks
- Terminal persistence: open worktrees saved to `~/.worktree-dash/open-terminals.json`, restored on next launch
- **Glow animation**: terminal border pulses (CSS keyframes) when Claude reports done/blocked/error or hook state = waiting. Cleared when terminal is focused. `Cmd+Shift+K` clears all.

### Terminal state (no more attention queue section)
- Dropped the dedicated attention queue section from the sidebar
- Instead: terminals glow when they need attention — the visual is on the thing itself
- Status colors: running=green, done=blue, blocked/waiting=amber, error=red
- Agent data shown inline on the worktree row: task + current activity

### Keyboard map (final)
| Shortcut | Action |
|---|---|
| `Cmd+B` | Toggle sidebar |
| `Cmd+E` | Toggle expand mode (3+ terminals only) |
| `Cmd+O` | Focus VS Code for active terminal (Tauri invoke, no HTTP) |
| `Cmd+K` | Clear terminal screen |
| `Cmd+Shift+K` | Clear all glow states |
| `Cmd+1-9` | Switch to Nth open terminal |
| `Ctrl+1-9` | Open/focus Nth sidebar worktree |
| `Cmd+Backspace` | Kill to start of line |
| `Opt+Backspace` | Delete word backward |
| `Cmd+←/→` | Jump to line start/end |
| `Opt+←/→` | Jump word backward/forward |

### How to run
```bash
# Terminal 1 — monitoring server (always on)
cd ~/Documents/personal/worktree-dash/server && npm start

# Terminal 2 — Tauri native app
cd ~/Documents/personal/worktree-dash/dashboard && npx tauri dev
```

### Claude Code integration
```
# ~/.claude/CLAUDE.md — add this snippet
You have access to the worktree dashboard MCP. At session start:
1. Call register_agent with your cwd as project_path and a one-sentence task description. Store the returned agent_id.
2. After each significant action, call report_status.
3. When done, call report_done with a summary.
4. If you need input, call report_blocked with a specific question.
5. On unrecoverable error, call report_error.
```

```bash
# Register MCP globally
claude mcp add --scope user worktree-dash \
  /Users/srekaravarshannk/.nvm/versions/node/v24.15.0/bin/node \
  "/Users/srekaravarshannk/Documents/personal/worktree-dash/server/dist/index.js"
```

---

## Pending / Deferred

- **Port wiring** — complex HAProxy multi-service setup, skipped. `.dashboard/port` file approach exists but not wired
- **Browser tab focus** — deferred. Approach A (Space + URL file) implemented and reverted (unpredictable). Approach B (detect 4-finger swipe, auto-switch Firefox tab) viable but needs Chrome or Firefox extension
- **Command palette** (`Cmd+P`) — deferred until strong use case emerges
- **Broadcast mode** — send same input to all terminals simultaneously
- **Terminal search** — `@xterm/addon-search` is available, 30min to add
- **Snippet library** — save/insert common commands
