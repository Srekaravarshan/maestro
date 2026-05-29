#!/bin/bash
# ~/.worktree-dash/hooks/set-state.sh
#
# Called by Claude Code lifecycle hooks.
# Usage: set-state.sh <state>   where state = working | idle | waiting
#
# Writes ~/.worktree-dash/status/<key>.json so the dashboard can show
# live claude state per worktree.
#
# On idle, also fires a macOS notification with click-to-focus.

STATE="$1"
if [ -z "$STATE" ]; then
  echo "Usage: set-state.sh <working|idle|waiting>" >&2
  exit 1
fi

# ── Read cwd from Claude Code's JSON stdin ─────────────────────────────────
INPUT=$(cat)

# Try jq first, fall back to Python 3
if command -v jq &>/dev/null; then
  DIR=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
elif command -v python3 &>/dev/null; then
  DIR=$(echo "$INPUT" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null)
fi
# Final fallback
[ -z "$DIR" ] && DIR=$(pwd)

# ── Resolve branch + repo ──────────────────────────────────────────────────
BR=$(git -C "$DIR" branch --show-current 2>/dev/null)
# Detached HEAD fallback: use short SHA, then folder name
[ -z "$BR" ] && BR=$(git -C "$DIR" rev-parse --short HEAD 2>/dev/null)
[ -z "$BR" ] && BR=$(basename "$DIR")

REPO=$(basename "$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || echo "$DIR")")

# ── Write status file ──────────────────────────────────────────────────────
# Key = first 12 chars of SHA-1 of the absolute path — stable across renames
KEY=$(printf '%s' "$DIR" | shasum | cut -c1-12)

mkdir -p ~/.worktree-dash/status

printf '{"id":"%s","repo":"%s","branch":"%s","state":"%s","ts":%s}\n' \
  "$DIR" "$REPO" "$BR" "$STATE" "$(date +%s)" \
  > ~/.worktree-dash/status/"$KEY".json

# ── Ping dashboard for immediate update (fire-and-forget) ─────────────────
curl -s -X POST http://localhost:3444/api/refresh \
  -H "Content-Type: application/json" \
  -d '{}' >/dev/null 2>&1 &

# ── macOS notification on idle (task #4) ──────────────────────────────────
if [ "$STATE" = "idle" ]; then
  if command -v terminal-notifier &>/dev/null; then
    terminal-notifier \
      -title "Done: $BR" \
      -subtitle "$REPO" \
      -message "Claude finished — click to focus" \
      -sound Glass \
      -execute "open -a 'Visual Studio Code' '$DIR'" \
      2>/dev/null &
  else
    # Fallback: macOS built-in osascript notification (no click-to-focus)
    osascript -e "display notification \"Claude finished — $BR ($REPO)\" with title \"Worktree Dash\" sound name \"Glass\"" \
      2>/dev/null &
  fi
fi
