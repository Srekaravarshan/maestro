#!/usr/bin/env bash
# install-slots.sh — one-shot setup for the slot system
# Run once from your Mac terminal: bash install-slots.sh
set -e

echo "▶ Installing slot system..."

# ── 1. tmuxinator ─────────────────────────────────────────────────────────────
if ! command -v tmuxinator &>/dev/null; then
  echo "  Installing tmuxinator gem..."
  gem install tmuxinator
else
  echo "  tmuxinator already installed: $(tmuxinator version)"
fi

# ── 2. Deploy slot.yml template ──────────────────────────────────────────────
mkdir -p ~/.config/tmuxinator
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/slot.yml" ~/.config/tmuxinator/slot.yml
echo "  Installed: ~/.config/tmuxinator/slot.yml"

# ── 3. Shell helpers ─────────────────────────────────────────────────────────
# Add these to ~/.zshrc if not already present

HELPERS='
# ── Maestro slot helpers ──────────────────────────────────────────────────────
# Usage: slot 1 /path/to/worktree feature-name
slot() {
  local n="$1" wpath="$2" name="${3:-feature}"
  if [[ -z "$n" || -z "$wpath" ]]; then
    echo "Usage: slot <number> <worktree_path> [name]"
    echo "  e.g. slot 1 ~/Documents/SurveySparrow/worktree1 email-share-amp"
    return 1
  fi
  # Expand ~ and resolve to absolute path (macOS-safe, no realpath needed)
  local abs_path
  abs_path="$(cd "${wpath/#\~/$HOME}" && pwd)"
  tmuxinator start slot SLOT="$n" WPATH="$abs_path" NAME="$name"
}

# Quickly switch to a slot session without re-starting it
slot-attach() {
  local n="${1:-1}"
  # Find any session whose name starts with slot<n>-
  local session
  session=$(tmux list-sessions -F "#{session_name}" 2>/dev/null | grep "^slot${n}-" | head -1)
  if [[ -n "$session" ]]; then
    tmux switch-client -t "$session" 2>/dev/null || tmux attach-session -t "$session"
  else
    echo "No slot ${n} session running. Use: slot $n <path> [name]"
  fi
}

# Show all running slot sessions and their port ranges
slots() {
  echo ""
  echo "  Running slots:"
  tmux list-sessions -F "  #{session_name}" 2>/dev/null | grep "^  slot" || echo "  (none)"
  echo ""
  echo "  Port map:"
  echo "    Slot 1 → server:8000 client:8001 super-admin:8002"
  echo "    Slot 2 → server:8100 client:8101 super-admin:8102"
  echo "    Slot 3 → server:8200 client:8201 super-admin:8202"
  echo ""
}
# ─────────────────────────────────────────────────────────────────────────────
'

ZSHRC="$HOME/.zshrc"
if ! grep -q "Maestro slot helpers" "$ZSHRC" 2>/dev/null; then
  echo "$HELPERS" >> "$ZSHRC"
  echo "  Added shell helpers to ~/.zshrc"
  echo "  Run: source ~/.zshrc   (or open a new terminal)"
else
  echo "  Shell helpers already in ~/.zshrc — skipped"
fi

# ── 4. Install maestro-sessions command ─────────────────────────────────────
SESSIONS_SCRIPT="$SCRIPT_DIR/hooks/maestro-sessions.py"
if [ -f "$SESSIONS_SCRIPT" ]; then
  chmod +x "$SESSIONS_SCRIPT"
  SESSIONS_ALIAS='
# Maestro session search
maestro-sessions() { python3 '"'"'"$SESSIONS_SCRIPT"'"'"' "$@"; }
# Shorthand: "cs search ngrok" or "cs list"
cs() { python3 '"'"'"$SESSIONS_SCRIPT"'"'"' "$@"; }
'
  if ! grep -q "maestro-sessions" "$ZSHRC" 2>/dev/null; then
    echo "$SESSIONS_ALIAS" >> "$ZSHRC"
    echo "  Added maestro-sessions / cs aliases to ~/.zshrc"
  else
    echo "  maestro-sessions alias already in ~/.zshrc — skipped"
  fi
fi

# ── 5. Verify tmux is available ──────────────────────────────────────────────
if ! command -v tmux &>/dev/null; then
  echo ""
  echo "  ⚠  tmux not found. Install it:"
  echo "     brew install tmux"
  echo ""
fi

echo ""
echo "✓ Done. Quick start:"
echo ""
echo "  1. Reload your shell:   source ~/.zshrc"
echo ""
echo "  2. Start a slot:"
echo "     slot 1 ~/code/app-v1-wt/my-feature my-feature"
echo ""
echo "  3. See running slots:   slots"
echo ""
echo "  Color guide:"
echo "    Slot 1 = Blue  (#007ACC)  → Space 1"
echo "    Slot 2 = Amber (#F59E0B)  → Space 2"
echo "    Slot 3 = Pink  (#EC4899)  → Space 3"
echo ""
echo "  Next steps:"
echo "    - Edit slot.yml to match your actual Rails/client/WDS commands"
echo "    - Set VS Code Peacock colors to match: 007ACC / F59E0B / EC4899"
echo "    - In System Settings → Keyboard → Keyboard Shortcuts → Mission Control:"
echo "      assign Ctrl+1, Ctrl+2, Ctrl+3 to Switch to Desktop 1/2/3"
echo "    - Turn off 'Displays have separate Spaces' (System Settings → Desktop & Dock)"
echo ""
