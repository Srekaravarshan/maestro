/**
 * shells.ts — every shell-out in one place.
 * All functions return typed results or null/false; they never throw.
 * Callers decide what to do with a null.
 */
import { execSync, exec } from 'child_process';

const EXEC_TIMEOUT_MS = 5_000;

function run(cmd: string, cwd?: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf8',
      timeout: EXEC_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

// ── Git ────────────────────────────────────────────────────────────────────

export interface ParsedWorktree {
  /** Absolute path to the worktree */
  path: string;
  /** Full commit SHA */
  sha: string;
  /** Branch name (short, no refs/heads/). Null when detached. */
  branch: string | null;
  /** True when in detached-HEAD state */
  detached: boolean;
}

/**
 * Parses `git worktree list --porcelain` output into typed objects.
 * Returns null if the command fails (not a git repo, etc.).
 */
export function getWorktrees(repoPath: string): ParsedWorktree[] | null {
  const raw = run('git worktree list --porcelain', repoPath);
  if (raw === null) return null;

  const worktrees: ParsedWorktree[] = [];
  // Blocks are separated by a blank line
  for (const block of raw.split(/\n\n+/)) {
    const lines = block.trim().split('\n');
    let path: string | undefined;
    let sha: string | undefined;
    let branch: string | null = null;
    let detached = false;

    for (const line of lines) {
      if (line.startsWith('worktree '))      path     = line.slice('worktree '.length);
      else if (line.startsWith('HEAD '))     sha      = line.slice('HEAD '.length);
      else if (line.startsWith('branch '))   branch   = line.slice('branch '.length)
                                                              .replace(/^refs\/heads\//, '');
      else if (line === 'detached')          detached = true;
    }

    if (path && sha) worktrees.push({ path, sha, branch, detached });
  }

  return worktrees.length > 0 ? worktrees : null;
}

/**
 * Returns the resolved absolute path of a repo's toplevel.
 * Used to get a canonical repo name/root.
 */
export function getRepoRoot(repoPath: string): string | null {
  return run('git rev-parse --show-toplevel', repoPath);
}

/**
 * Returns true if the worktree has any uncommitted changes.
 * `git status --porcelain` prints nothing for a clean tree.
 */
export function isWorktreeDirty(worktreePath: string): boolean {
  const out = run('git status --porcelain', worktreePath);
  return out !== null && out.length > 0;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
  upstream: boolean;
}

/**
 * Returns how many commits the branch is ahead/behind its upstream.
 * Returns { upstream: false } when there is no tracking branch.
 */
export function getAheadBehind(worktreePath: string): AheadBehind {
  const out = run('git rev-list --left-right --count @{u}...HEAD', worktreePath);
  if (out === null) return { ahead: 0, behind: 0, upstream: false };

  const [leftStr, rightStr] = out.split(/\s+/);
  const behind = parseInt(leftStr ?? '0', 10);
  const ahead  = parseInt(rightStr ?? '0', 10);

  return {
    ahead:  isNaN(ahead)  ? 0 : ahead,
    behind: isNaN(behind) ? 0 : behind,
    upstream: true,
  };
}

// ── Networking ─────────────────────────────────────────────────────────────

/**
 * Returns true if something is listening on the given TCP port.
 * Uses lsof (macOS / Linux).
 */
export function isPortListening(port: number): boolean {
  const out = run(`lsof -nP -iTCP:${port} -sTCP:LISTEN`);
  return out !== null && out.length > 0;
}

// ── System ─────────────────────────────────────────────────────────────────

/**
 * Focuses (or opens) a folder in VS Code — fire-and-forget, as fast as possible.
 *
 * Two-phase approach:
 *   Phase 1 — instant visual snap (~50ms): use /usr/bin/osascript with full path
 *             so it's always found regardless of Node's stripped PATH.
 *             This brings VS Code's window to front immediately.
 *   Phase 2 — switch to the right folder: use the VS Code bundled `code` CLI
 *             at its fixed macOS install path, which talks directly to the
 *             running VS Code IPC socket. Falls back to `open` only if
 *             VS Code isn't installed at the standard location.
 *
 * Note: exec() inherits a stripped PATH from Node — never rely on bare `code`
 * or `osascript` without their absolute paths.
 */
export function focusInVSCode(worktreePath: string): void {
  const safe = worktreePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // Phase 1: snap VS Code to front NOW — osascript is always at /usr/bin on macOS
  exec(
    `/usr/bin/osascript -e 'tell application "Visual Studio Code" to activate'`,
    () => {}
  );

  // Phase 2: open the specific folder
  // The bundled `code` binary is at a fixed path for standard VS Code installs.
  // It communicates via IPC so it's ~200ms vs ~1500ms for open -a.
  const bundledCode = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
  exec(
    `"${bundledCode}" "${safe}" 2>/dev/null || /usr/bin/open -a "Visual Studio Code" "${safe}"`,
    { timeout: 10_000 },
    () => {}
  );
}

/**
 * Opens a URL in the browser, trying to focus an existing tab rather than
 * opening a new one.
 *
 * Strategy:
 *   1. Try AppleScript tab-focus for Chrome (full tab enumeration)
 *   2. For Firefox / other browsers: activate the app then open the URL
 *      (macOS `open` will reuse an existing tab when the browser is already
 *      showing that URL — reliable for Firefox with "switch to existing tab" pref)
 *
 * All fire-and-forget — caller never blocks.
 */
export function openInBrowser(url: string): void {
  const safeUrl = url.replace(/"/g, '\\"');

  // Chrome: enumerate tabs and focus matching one, or open new
  const chromeScript = `
    tell application "Google Chrome"
      set found to false
      repeat with w in windows
        repeat with t in tabs of w
          if URL of t starts with "${safeUrl}" then
            set active tab of w to t
            set index of w to 1
            set found to true
            exit repeat
          end if
        end repeat
        if found then exit repeat
      end repeat
      if not found then open location "${safeUrl}"
      activate
    end tell
  `.trim();

  // Detect which browser is the default and act accordingly
  exec(
    `/usr/bin/osascript -e 'path to frontmost application as text'`,
    { timeout: 2_000 },
    (_err, stdout) => {
      const front = (stdout ?? '').toLowerCase();

      if (front.includes('google chrome') || front.includes('chrome')) {
        exec(`/usr/bin/osascript << 'EOF'\n${chromeScript}\nEOF`, { timeout: 8_000 }, () => {});
      } else {
        // Firefox, Safari, Arc, etc. — activate app then open URL.
        // macOS reuses an existing tab when the browser already has it open.
        exec(`/usr/bin/open "${safeUrl}"`, { timeout: 5_000 }, () => {});
      }
    }
  );
}
