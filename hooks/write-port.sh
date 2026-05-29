#!/bin/bash
# write-port.sh — writes the dev server port into .dashboard/port
# so the worktree dashboard can show server up/down status.
#
# Usage:
#   bash write-port.sh 3000          # write port 3000 in current dir
#   bash write-port.sh 3000 /path    # write port 3000 for a specific path
#
# Add to your package.json dev script:
#   "dev": "bash ~/.worktree-dash/hooks/write-port.sh 3000 && vite"
#
# Or with a variable port (e.g. Vite picks its own):
#   "dev": "vite"
# and add a vite.config.ts hook (see below)

PORT="${1:-3000}"
DIR="${2:-$(pwd)}"

mkdir -p "$DIR/.dashboard"
echo "$PORT" > "$DIR/.dashboard/port"
echo "[worktree-dash] port $PORT written to $DIR/.dashboard/port"
