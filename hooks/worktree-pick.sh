#!/bin/bash
# ~/.worktree-dash/hooks/worktree-pick.sh
#
# Fuzzy worktree switcher — assign a global hotkey to this script.
#
# Shows all worktrees with branch, claude state, and git info.
# Selecting one focuses its VS Code window.
#
# Uses fzf if available (fuzzy, fast), otherwise AppleScript choose from list.
#
# Setup: see hotkey instructions at the bottom of this file.

DASH_SERVER="$HOME/Documents/personal/worktree-dash/server"

# ── Get worktree list ──────────────────────────────────────────────────────
JSON=$(node "$DASH_SERVER/dist/index.js" --list 2>/dev/null)

if [ -z "$JSON" ]; then
  osascript -e 'display alert "Worktree Dash" message "Could not load worktree list. Is the server set up?"'
  exit 1
fi

# Build tab-separated "display label \t path" list
ITEMS=$(echo "$JSON" | python3 - <<'PYEOF'
import sys, json

data = json.load(sys.stdin)
for repo in data.get('repos', []):
    repo_name = repo.get('repo', '?')
    for wt in repo.get('worktrees', []):
        if wt.get('prunable'):
            continue
        branch  = wt.get('branch', '?')
        wt_path = wt.get('id', '')
        claude  = wt.get('claude', 'unknown')
        git     = wt.get('git', {})
        dirty   = '●' if git.get('dirty') else '○'
        ahead   = git.get('ahead', 0)
        behind  = git.get('behind', 0)
        server  = '↗' if wt.get('server') == 'up' else ''

        state_icon = {'working': '⚙', 'idle': '·', 'waiting': '⚠', 'unknown': '?'}.get(claude, '?')

        sync = ''
        if ahead  > 0: sync += f'↑{ahead}'
        if behind > 0: sync += f'↓{behind}'

        label = f'{state_icon}  {repo_name} · {branch:<40}  {dirty} {sync:<6}  {server}'
        print(f'{label}\t{wt_path}')
PYEOF
)

if [ -z "$ITEMS" ]; then
  osascript -e 'display alert "Worktree Dash" message "No worktrees found."'
  exit 1
fi

# ── Picker ─────────────────────────────────────────────────────────────────

if command -v fzf &>/dev/null; then
  # fzf in a floating Terminal window
  SELECTED=$(
    osascript -e "
      tell application \"Terminal\"
        activate
        set w to do script \"echo '$ITEMS' | fzf --with-nth=1 --delimiter='\\t' --prompt='jump to worktree > ' --height=50% --reverse --no-info | cut -f2 > /tmp/worktree-pick-result; exit\"
        delay 0.3
        repeat while busy of w
          delay 0.2
        end repeat
      end tell
    " 2>/dev/null
    sleep 0.5
    cat /tmp/worktree-pick-result 2>/dev/null
    rm -f /tmp/worktree-pick-result
  )
else
  # AppleScript choose from list (no fuzzy, but zero deps)
  LABELS=$(echo "$ITEMS" | cut -f1)
  AS_LIST=$(python3 -c "
import sys
items = [l.strip() for l in '''$LABELS'''.splitlines() if l.strip()]
print('{' + ', '.join('\"' + i.replace('\"', '') + '\"' for i in items) + '}')
")
  CHOSEN=$(osascript -e "choose from list $AS_LIST with title \"Jump to Worktree\" with prompt \"Select a worktree:\" without multiple selections allowed" 2>/dev/null)
  [ "$CHOSEN" = "false" ] || [ -z "$CHOSEN" ] && exit 0
  SELECTED=$(echo "$ITEMS" | grep -F "$CHOSEN" | head -1 | cut -f2)
fi

[ -z "$SELECTED" ] && exit 0

# Focus the selected worktree in VS Code
open -a "Visual Studio Code" "$SELECTED"

# Also ping the dashboard to refresh
curl -s -X POST http://localhost:3444/api/refresh \
  -H "Content-Type: application/json" -d '{}' &>/dev/null &

# ──────────────────────────────────────────────────────────────────────────
# HOTKEY SETUP (one-time):
#
# Option A — Automator (no extra apps):
#   1. Open Automator → New Document → Quick Action
#   2. Set "Workflow receives" to "no input" in "any application"
#   3. Add action: Run Shell Script
#      Shell: /bin/bash
#      Pass input: to stdin
#      Script: bash ~/.worktree-dash/hooks/worktree-pick.sh
#   4. Save as "Jump to Worktree"
#   5. System Settings → Keyboard → Keyboard Shortcuts → Services
#      → General → "Jump to Worktree" → assign e.g. Cmd+Shift+W
#
# Option B — Raycast (if installed):
#   1. Raycast Settings → Extensions → + → New Script Command
#   2. Script: bash ~/.worktree-dash/hooks/worktree-pick.sh
#   3. Mode: Silent    Trigger: your hotkey (e.g. Cmd+Shift+W)
#
# Option C — install fzf for better UX:
#   brew install fzf
# ──────────────────────────────────────────────────────────────────────────
