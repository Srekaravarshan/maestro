# Maestro (macOS-native, SwiftUI)

Native rewrite of the Maestro HUD — a menu-bar app with a transparent, always-on-top
pill that monitors Claude Code sessions. Replaces the Tauri + Node stack.

It reuses the **existing data contract** unchanged:
- Claude Code hooks write `~/.worktree-dash/status/*.json` (via `set-state.sh`).
- Pins/ideas live in `~/.worktree-dash/pins.json` / `prompt-queue.json`.
- Sessions are discovered from `~/.claude/projects/`.

No Node server, no localhost port — the app reads these files directly.

## Requirements
- macOS 13+
- Xcode command-line tools (`xcode-select --install`) — provides the Swift toolchain.

## Run (Stage 1)
```bash
cd maestro-mac
swift run
```
A menu-bar item (`◑`) appears; the pill floats at top-center and lists worktrees
that Claude Code hooks have reported, updating live. Quit from the menu-bar menu.

To stop: menu-bar `◑` → Quit Maestro (or Ctrl-C the terminal).

## Status — staged migration
- [x] **Stage 1** — menu-bar app + transparent vibrancy panel + live read of hook status files.
- [x] **Stage 2** — discovery from `~/.claude/projects` + hook status merge + tiers.
- [x] **Stage 3** — collapsed pill / 3s attention alert / expanded panel; native window drag (grip); host-aware open; alert sound.
- [x] **Stage 4 (partial)** — pin/unpin, notes (add/remove) per worktree.
- [ ] Stage 4 (rest) — drag-to-pin/unpin/reorder, keyboard navigation.
- [ ] Stage 5 — notch-level window, multi-monitor (one pill per screen), FSEvents watch (drop the timer).
- [ ] Packaging — bundle as a proper `.app` (login-item / launch on start).
