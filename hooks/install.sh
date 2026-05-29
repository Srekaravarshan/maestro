#!/bin/bash
# install.sh — one-time setup for worktree-dash hooks.
#
# What it does:
#   1. Creates ~/.worktree-dash/hooks/ and copies set-state.sh there
#   2. Makes it executable
#   3. Merges the 4 Claude Code hooks into ~/.claude/settings.json
#      (non-destructive: preserves all existing settings)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$HOME/.worktree-dash/hooks"
SETTINGS="$HOME/.claude/settings.json"
HOOK_SCRIPT="$HOOKS_DIR/set-state.sh"

echo "=== Worktree Dash — Hook Installer ==="
echo ""

# ── 1. Copy hook script ────────────────────────────────────────────────────
echo "→ Installing hook scripts to $HOOKS_DIR"
mkdir -p "$HOOKS_DIR"
cp "$SCRIPT_DIR/set-state.sh"     "$HOOKS_DIR/set-state.sh"
cp "$SCRIPT_DIR/worktree-pick.sh" "$HOOKS_DIR/worktree-pick.sh"
chmod +x "$HOOKS_DIR/set-state.sh"
chmod +x "$HOOKS_DIR/worktree-pick.sh"
echo "  ✓ Done"

# ── 2. Merge hooks into ~/.claude/settings.json ───────────────────────────
echo "→ Updating $SETTINGS"

# Ensure the file exists with at least {}
if [ ! -f "$SETTINGS" ]; then
  mkdir -p "$(dirname "$SETTINGS")"
  echo '{}' > "$SETTINGS"
  echo "  (created new settings.json)"
fi

# Use Python 3 to merge — available on every modern Mac
python3 - "$SETTINGS" "$HOOK_SCRIPT" <<'PYEOF'
import sys, json, copy

settings_path = sys.argv[1]
hook_script   = sys.argv[2]

cmd_working = f"bash {hook_script} working"
cmd_idle    = f"bash {hook_script} idle"
cmd_waiting = f"bash {hook_script} waiting"

NEW_HOOKS = {
    "SessionStart":     [{"matcher": "", "hooks": [{"type": "command", "command": cmd_working}]}],
    "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "command", "command": cmd_working}]}],
    "Stop":             [{"matcher": "", "hooks": [{"type": "command", "command": cmd_idle}]}],
    "Notification":     [{"matcher": "", "hooks": [{"type": "command", "command": cmd_waiting}]}],
}

with open(settings_path) as f:
    settings = json.load(f)

existing_hooks = settings.get("hooks", {})

for event, entries in NEW_HOOKS.items():
    if event not in existing_hooks:
        existing_hooks[event] = entries
    else:
        # Append only if command not already present
        existing_cmds = {
            h["command"]
            for entry in existing_hooks[event]
            for h in entry.get("hooks", [])
            if "command" in h
        }
        for entry in entries:
            for h in entry.get("hooks", []):
                if h.get("command") not in existing_cmds:
                    existing_hooks[event].append(entry)

settings["hooks"] = existing_hooks

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")

print(f"  ✓ Merged hooks for: {', '.join(NEW_HOOKS.keys())}")
PYEOF

echo ""
echo "=== Done ==="
echo ""
echo "Restart your Claude Code sessions to pick up the new hooks."
echo "Then open http://localhost:3444 — worktrees will show working/idle/waiting live."
echo ""
echo "Optional — better notifications:"
echo "  brew install terminal-notifier"
echo ""
echo "Optional — fuzzy switcher (much better UX than the AppleScript fallback):"
echo "  brew install fzf"
echo ""
echo "Fuzzy switcher hotkey (Automator — no extra apps needed):"
echo "  1. Open Automator → New Document → Quick Action"
echo "  2. 'Workflow receives': no input, in: any application"
echo "  3. Add 'Run Shell Script': bash ~/.worktree-dash/hooks/worktree-pick.sh"
echo "  4. Save as 'Jump to Worktree'"
echo "  5. System Settings → Keyboard → Shortcuts → Services → assign Cmd+Shift+W"
