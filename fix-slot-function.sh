#!/usr/bin/env bash
# Patches the slot() function in ~/.zshrc — removes old version, writes fixed one.
set -e

ZSHRC="$HOME/.zshrc"

# Remove the entire old helpers block (from the marker to the closing marker)
# Uses Python for reliable multiline deletion (sed -i behaves differently on macOS)
python3 - "$ZSHRC" <<'PYEOF'
import sys, re
path = sys.argv[1]
with open(path, "r") as f:
    content = f.read()

# Remove everything between the two markers (inclusive)
cleaned = re.sub(
    r'\n# ── Maestro slot helpers ─+.*?# ─+\n',
    '\n',
    content,
    flags=re.DOTALL
)
with open(path, "w") as f:
    f.write(cleaned)
print("  Removed old helpers block from ~/.zshrc")
PYEOF

# Append the fixed version
cat >> "$ZSHRC" <<'ZSHEOF'

# ── Maestro slot helpers ──────────────────────────────────────────────────────
# Usage: slot <number> <worktree_path> [name]
#   slot 1 /Users/srekaravarshannk/Documents/SurveySparrow/worktree1 email-share-amp
slot() {
  local n="$1" wpath="$2" name="${3:-feature}"
  if [[ -z "$n" || -z "$wpath" ]]; then
    echo "Usage: slot <number> <worktree_path> [name]"
    echo "  e.g. slot 1 ~/Documents/SurveySparrow/worktree1 email-share-amp"
    return 1
  fi
  # Expand ~ and resolve absolute path — macOS-safe (no realpath needed)
  local abs_path
  abs_path="$(cd "${wpath/#\~/$HOME}" && pwd)"
  tmuxinator start slot SLOT="$n" WPATH="$abs_path" NAME="$name"
}

# Jump to an already-running slot (no restart)
slot-attach() {
  local n="${1:-1}"
  local session
  session=$(tmux list-sessions -F "#{session_name}" 2>/dev/null | grep "^slot${n}-" | head -1)
  if [[ -n "$session" ]]; then
    tmux switch-client -t "$session" 2>/dev/null || tmux attach-session -t "$session"
  else
    echo "No slot ${n} session running. Use: slot $n <path> [name]"
  fi
}

# List running slots and port map
slots() {
  echo ""
  echo "  Running slots:"
  tmux list-sessions -F "  #{session_name}" 2>/dev/null | grep "^  slot" || echo "  (none)"
  echo ""
  echo "  Port map:"
  echo "    Slot 1 → server:8000  client:8001  super-admin:8002"
  echo "    Slot 2 → server:8100  client:8101  super-admin:8102"
  echo "    Slot 3 → server:8200  client:8201  super-admin:8202"
  echo ""
}
# ─────────────────────────────────────────────────────────────────────────────
ZSHEOF

echo "  Written fixed helpers to ~/.zshrc"
echo ""
echo "✓ Done. Now run:"
echo ""
echo "  source ~/.zshrc"
echo ""
echo "Then try:"
echo "  slot 1 /Users/srekaravarshannk/Documents/SurveySparrow/worktree1 email-share-amp"
echo ""
