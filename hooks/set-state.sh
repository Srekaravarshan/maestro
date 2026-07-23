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

# Ignore Maestro's own headless sends (chat "send" feature runs `claude --print
# --resume` with MAESTRO_HEADLESS=1). Otherwise those fires would overwrite the
# folder's host/state with wherever the app launched them.
if [ -n "$MAESTRO_HEADLESS" ]; then
  exit 0
fi

# Try jq first, fall back to Python 3. We read BOTH the cwd and the session_id so
# status can be tracked per-session (a folder can host several Claude sessions).
if command -v jq &>/dev/null; then
  DIR=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
  SID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
elif command -v python3 &>/dev/null; then
  DIR=$(echo "$INPUT" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null)
  SID=$(echo "$INPUT" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null)
fi
# Final fallback
[ -z "$DIR" ] && DIR=$(pwd)

# ── Resolve branch + repo ──────────────────────────────────────────────────
BR=$(git -C "$DIR" branch --show-current 2>/dev/null)
# Detached HEAD fallback: use short SHA, then folder name
[ -z "$BR" ] && BR=$(git -C "$DIR" rev-parse --short HEAD 2>/dev/null)
[ -z "$BR" ] && BR=$(basename "$DIR")

REPO=$(basename "$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || echo "$DIR")")

# ── Detect the host app (best-effort, from the session's environment) ──────
# VS Code integrated terminal exports TERM_PROGRAM=vscode + VSCODE_*; iTerm and
# Terminal set TERM_PROGRAM; the Claude Code desktop app has none of these.
if [ "$TERM_PROGRAM" = "vscode" ] || [ -n "$VSCODE_PID" ] || [ -n "$VSCODE_GIT_IPC_HANDLE" ]; then
  HOST="vscode"
elif [ -n "$TMUX" ]; then
  HOST="tmux"
elif [ "$TERM_PROGRAM" = "iTerm.app" ]; then
  HOST="iterm"
elif [ "$TERM_PROGRAM" = "Apple_Terminal" ]; then
  HOST="terminal"
elif [ "$TERM_PROGRAM" = "WarpTerminal" ]; then
  HOST="warp"
elif [ "$TERM_PROGRAM" = "ghostty" ] || [ "$TERM_PROGRAM" = "WezTerm" ]; then
  HOST="terminal"
else
  HOST="app"
fi

# ── Write status file (keyed by SESSION, not folder) ──────────────────────
# One status file per Claude session so a folder can show several sessions.
# Key = session_id when available; fall back to the folder hash for safety.
if [ -n "$SID" ]; then
  KEY="$SID"
else
  KEY=$(printf '%s' "$DIR" | shasum | cut -c1-12)
fi
STATUS_FILE=~/.worktree-dash/status/"$KEY".json
mkdir -p ~/.worktree-dash/status

# Suppress the false "needs input": Claude Code's Notification hook fires both
# for real permission prompts AND as a ~60s idle nudge after a turn ends. Treat
# it as waiting only if the session is currently WORKING (a real mid-task
# prompt). If it's already idle, this is just the idle reminder — leave it.
if [ "$STATE" = "waiting" ] && [ -f "$STATUS_FILE" ]; then
  CUR=$(grep -o '"state":"[a-z]*"' "$STATUS_FILE" | head -1 | sed 's/.*"state":"//;s/"//')
  if [ "$CUR" = "idle" ]; then
    exit 0
  fi
fi

# `id` stays = cwd (folder) for grouping; `sessionId` identifies the session.
printf '{"id":"%s","sessionId":"%s","cwd":"%s","repo":"%s","branch":"%s","state":"%s","ts":%s,"host":"%s"}\n' \
  "$DIR" "$SID" "$DIR" "$REPO" "$BR" "$STATE" "$(date +%s)" "$HOST" \
  > "$STATUS_FILE"

# ── Ping dashboard for immediate update (fire-and-forget) ─────────────────
curl -s -X POST http://localhost:3444/api/refresh \
  -H "Content-Type: application/json" \
  -d '{}' >/dev/null 2>&1 &

# ── macOS notification on idle OR waiting ─────────────────────────────────
# Maestro (the menu bar app) fires its own richer alert + sound via the HUD
# when it detects the state transition over SSE. This osascript call is a
# SILENT fallback banner for when Maestro isn't running — no sound, so it
# never double-beeps against the HUD's alert sound.
if [ "$STATE" = "idle" ] || [ "$STATE" = "waiting" ]; then
  if [ "$STATE" = "idle" ]; then
    NOTIF_MSG="Claude finished in $REPO"
  else
    NOTIF_MSG="Claude is waiting — $REPO"
  fi
  # Silent banner (no `sound name`) — the HUD owns the alert sound.
  osascript -e "display notification \"$NOTIF_MSG\" with title \"Maestro\"" \
    2>/dev/null &
fi
