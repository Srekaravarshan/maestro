/**
 * discover.ts — orchestrates discovery across all registered repos.
 *
 * Produces the exact JSON shape from the HANDOFF spec:
 * { repos: [ { repo, root, worktrees: [ { id, branch, port, server, claude, git, color } ] } ], generated_at }
 *
 * Every failure mode from the spec is handled here:
 *  1. Stale Claude status → state.ts handles it; returns 'unknown'
 *  2. Ghost worktree (path deleted but still listed) → flagged as prunable, skipped from normal output
 *  3. Detached HEAD / no branch → falls back to short SHA or folder basename
 *  4. No upstream → git.upstream=false, ahead/behind=0, no throw
 *  5. Port held by something else → trust .dashboard/port; lsof is truth for up/down only
 *  6. Per-repo isolation → one bad repo logs a warning; others continue
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getWorktrees,
  getRepoRoot,
  isWorktreeDirty,
  getAheadBehind,
  isPortListening,
} from './shells.js';
import { getClaudeStateResult } from './state.js';
import { stableColor } from './color.js';
import type { AgentData } from './agent-store.js';

// ── Types (contract — keep stable) ────────────────────────────────────────

export interface GitInfo {
  dirty: boolean;
  ahead: number;
  behind: number;
  upstream: boolean;
}

export interface WorktreeInfo {
  /** Absolute path = globally unique key across all repos */
  id: string;
  /** Display branch name, short SHA, or folder basename — never empty */
  branch: string;
  /** Port from .dashboard/port, or null if not declared */
  port: number | null;
  /** Whether something is listening on port */
  server: 'up' | 'down';
  /** Claude session state from status file */
  claude: 'working' | 'idle' | 'waiting' | 'unknown';
  git: GitInfo;
  /** Stable color derived from repo+branch */
  color: string;
  /** True when the path no longer exists on disk — worktree needs pruning */
  prunable?: true;
  /** Unix ms when the hook last wrote a state file. Null if no hook data yet. */
  claude_updated_at: number | null;
  /**
   * Agent data from active Claude session — populated by the HTTP server
   * after merging with the agent store. Never set by discovery itself.
   */
  agent?: AgentData;

  // ── Dynamic-discovery fields (populated by claude-sessions.ts) ──────────
  /** Newest Claude Code session id for this cwd — used for `claude --resume`. */
  sessionId?: string;
  /** AI-generated session title, if present in the transcript. */
  title?: string;
  /** Unix ms of the newest session activity (transcript mtime). */
  lastActivity?: number | null;
  /** True if the user pinned this worktree (computed in the HTTP server). */
  pinned?: boolean;
  /** True if this is a desktop-managed pooled worktree (.claude/worktrees/…). */
  pooled?: boolean;
  /** Which bucket the UI should file this under (computed in the HTTP server). */
  tier?: 'pinned' | 'active' | 'other';
  /** Name of the main repo this worktree belongs to (basename of repo root). */
  repoName?: string;
  /** Position within the user's pin order (lower = higher priority). */
  pinIndex?: number;
  /** Host app the session runs in: vscode | iterm | terminal | tmux | app. */
  host?: string;
}

export interface RepoGroup {
  /** Short name of the repo (basename of root) */
  repo: string;
  /** Resolved absolute path */
  root: string;
  worktrees: WorktreeInfo[];
  /** Present only if the whole repo failed to discover */
  error?: string;
}

export interface ListWorktreesResult {
  repos: RepoGroup[];
  generated_at: number; // unix seconds
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Read declared port from <worktree>/.dashboard/port */
function readDeclaredPort(worktreePath: string): number | null {
  try {
    const raw = fs.readFileSync(path.join(worktreePath, '.dashboard', 'port'), 'utf8').trim();
    const p = parseInt(raw, 10);
    return isNaN(p) || p <= 0 ? null : p;
  } catch {
    return null;
  }
}

/** Produce a display branch name that is never blank */
function displayBranch(raw: { branch: string | null; sha: string; detached: boolean; path: string }): string {
  if (raw.branch && raw.branch.length > 0) return raw.branch;
  if (raw.detached && raw.sha.length >= 8)  return raw.sha.slice(0, 8);
  return path.basename(raw.path) || 'unknown';
}

// ── Per-worktree discovery ─────────────────────────────────────────────────

function discoverWorktree(
  wt: { path: string; sha: string; branch: string | null; detached: boolean },
  repoName: string,
): WorktreeInfo {
  const branch = displayBranch({ ...wt });

  // Failure mode #2: ghost worktree — path doesn't exist
  if (!fs.existsSync(wt.path)) {
    return {
      id:               wt.path,
      branch,
      port:             null,
      server:           'down',
      claude:           'unknown',
      claude_updated_at: null,
      git:              { dirty: false, ahead: 0, behind: 0, upstream: false },
      color:            stableColor(repoName, branch),
      prunable:         true,
    };
  }

  // Port (trust declared file; only use lsof for up/down check on that port)
  const port   = readDeclaredPort(wt.path);
  const server: 'up' | 'down' = port !== null && isPortListening(port) ? 'up' : 'down';

  // Claude state (failure mode #1 — stale handled in state.ts)
  const { state: claude, updated_at: claude_updated_at } = getClaudeStateResult(wt.path);

  // Git (failure modes #3 + #4 handled in shells.ts)
  const dirty      = isWorktreeDirty(wt.path);
  const { ahead, behind, upstream } = getAheadBehind(wt.path);

  return {
    id:               wt.path,
    branch,
    port,
    server,
    claude,
    claude_updated_at,
    git:              { dirty, ahead, behind, upstream },
    color:            stableColor(repoName, branch),
  };
}

// ── Per-repo discovery ─────────────────────────────────────────────────────

/**
 * Returns true for worktrees that are managed by IDE tooling, not by the developer.
 * These should not appear in the dashboard.
 *   ~/.cursor/worktrees/...  — Cursor IDE internal worktrees
 *   .../.claude/worktrees/...  — Claude Code worktrees
 */
function isToolManagedWorktree(worktreePath: string): boolean {
  const home = os.homedir();
  const cursorInternal = path.join(home, '.cursor', 'worktrees');
  if (worktreePath.startsWith(cursorInternal)) return true;
  if (worktreePath.includes('/.claude/worktrees/')) return true;
  return false;
}

function discoverRepo(repoPath: string): RepoGroup {
  const repoName = path.basename(repoPath);

  // Resolve canonical root (handles symlinks etc.)
  const root = getRepoRoot(repoPath) ?? repoPath;

  const rawWorktrees = getWorktrees(root);
  if (!rawWorktrees) {
    return {
      repo:      repoName,
      root,
      worktrees: [],
      error:     `Could not list worktrees — is "${root}" a git repo?`,
    };
  }

  const worktrees = rawWorktrees
    .filter(wt => !isToolManagedWorktree(wt.path))
    .map(wt => discoverWorktree(wt, repoName));

  return { repo: repoName, root, worktrees };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Main entry point.
 * Failure mode #6: each repo is isolated — one bad entry emits an error field
 * but never aborts discovery of the others.
 */
export function listWorktrees(repoPaths: string[]): ListWorktreesResult {
  const repos: RepoGroup[] = [];

  for (const repoPath of repoPaths) {
    try {
      repos.push(discoverRepo(repoPath));
    } catch (err) {
      repos.push({
        repo:      path.basename(repoPath),
        root:      repoPath,
        worktrees: [],
        error:     err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { repos, generated_at: Math.floor(Date.now() / 1000) };
}
