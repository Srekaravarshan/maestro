/**
 * claude-sessions.ts — DYNAMIC discovery of every Claude Code session.
 *
 * There is no static registry. Claude Code writes a transcript for every
 * session it has ever run to:
 *
 *     ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 *
 * That directory is a self-maintaining index of every folder you've used
 * Claude Code in. We scan it, read the *real* cwd out of each newest
 * transcript (the encoded dir name is lossy — '/' and '.' both become '-'),
 * group worktrees under their main repo via `git --git-common-dir`, and tag
 * desktop-managed pooled worktrees using the desktop app's git-worktrees.json.
 *
 * Cost control: a cheap signature (dir + newest-mtime) is computed first; if
 * nothing changed since the last scan we return the cached result untouched.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { stableColor } from './color.js';
import type { WorktreeInfo, RepoGroup, ListWorktreesResult } from './discover.js';

// ── Paths (env-overridable for testing) ────────────────────────────────────

const PROJECTS_DIR = process.env['MAESTRO_CLAUDE_PROJECTS']
  || path.join(os.homedir(), '.claude', 'projects');

const WORKTREES_JSON = process.env['MAESTRO_WORKTREES_JSON']
  || path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'git-worktrees.json');

// ── Caches ──────────────────────────────────────────────────────────────────

interface SessionMeta { cwd: string | null; branch: string | null; title: string | null; sessionId: string; }

/** Parsed-transcript cache, keyed by `${file}:${mtimeMs}`. */
const parseCache = new Map<string, SessionMeta>();
/** cwd → { repoRoot, repoName }, stable across a process lifetime. */
const repoCache  = new Map<string, { root: string; name: string }>();

let lastSignature = '';
let lastResult: ListWorktreesResult = { repos: [], generated_at: 0 };

// ── Helpers ───────────────────────────────────────────────────────────────

function execGit(cwd: string, args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd, encoding: 'utf8', timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Read the first `bytes` of a file without loading a huge transcript fully. */
function readHead(file: string, bytes = 65536): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/** Extract cwd / gitBranch / ai-title from a transcript's head. */
function parseSession(file: string): SessionMeta {
  const sessionId = path.basename(file, '.jsonl');
  const meta: SessionMeta = { cwd: null, branch: null, title: null, sessionId };
  let head = '';
  try { head = readHead(file); } catch { return meta; }

  for (const line of head.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(trimmed); } catch { continue; } // last line may be truncated

    if (!meta.cwd && typeof obj['cwd'] === 'string') meta.cwd = obj['cwd'] as string;
    if (!meta.branch && typeof obj['gitBranch'] === 'string') meta.branch = obj['gitBranch'] as string;
    if (!meta.title && obj['type'] === 'ai-title' && typeof obj['aiTitle'] === 'string') {
      meta.title = obj['aiTitle'] as string;
    }
    if (meta.cwd && meta.branch && meta.title) break;
  }
  return meta;
}

/** Newest .jsonl in a project dir, with its mtime (ms). */
function newestTranscript(dir: string): { file: string; mtimeMs: number } | null {
  let best: { file: string; mtimeMs: number } | null = null;
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      if (!best || st.mtimeMs > best.mtimeMs) best = { file, mtimeMs: st.mtimeMs };
    } catch { /* skip */ }
  }
  return best;
}

/** Resolve the MAIN repo (root + name) for a cwd, grouping worktrees together. */
function repoFor(cwd: string): { root: string; name: string } {
  const cached = repoCache.get(cwd);
  if (cached) return cached;

  let root = cwd;
  const common = execGit(cwd, 'rev-parse --git-common-dir');
  if (common) {
    const abs = path.isAbsolute(common) ? common : path.resolve(cwd, common);
    // abs ends in `.git` (or a worktrees/… path under it) → main worktree is its parent.
    root = path.dirname(abs.replace(/\/\.git.*$/, '/.git'));
  }
  const result = { root, name: path.basename(root) || root };
  repoCache.set(cwd, result);
  return result;
}

/** Absolute paths of desktop-managed pooled worktrees, from git-worktrees.json. */
function pooledPaths(): Set<string> {
  try {
    const raw = fs.readFileSync(WORKTREES_JSON, 'utf8');
    const parsed = JSON.parse(raw) as { worktrees?: Record<string, { path?: string }> };
    const set = new Set<string>();
    for (const wt of Object.values(parsed.worktrees ?? {})) {
      if (wt.path) set.add(wt.path);
    }
    return set;
  } catch {
    return new Set();
  }
}

function emptyWorktree(cwd: string, branch: string, repoName: string): WorktreeInfo {
  return {
    id: cwd,
    branch,
    port: null,
    server: 'down',
    claude: 'unknown',
    git: { dirty: false, ahead: 0, behind: 0, upstream: false },
    color: stableColor(repoName, branch),
    claude_updated_at: null,
  };
}

// ── Discovery ─────────────────────────────────────────────────────────────

export function discoverSessions(): ListWorktreesResult {
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(PROJECTS_DIR)
      .map(n => path.join(PROJECTS_DIR, n))
      .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  } catch {
    return { repos: [], generated_at: Math.floor(Date.now() / 1000) };
  }

  // Cheap signature: skip the full scan if nothing changed.
  const newest = new Map<string, { file: string; mtimeMs: number }>();
  for (const dir of projectDirs) {
    const n = newestTranscript(dir);
    if (n) newest.set(dir, n);
  }
  const signature = JSON.stringify(
    [...newest.entries()].map(([d, n]) => [d, n.mtimeMs]).sort()
  );
  if (signature === lastSignature) return lastResult;

  const pooled = pooledPaths();
  const groups = new Map<string, RepoGroup>();

  for (const [, n] of newest) {
    const key = `${n.file}:${n.mtimeMs}`;
    let meta = parseCache.get(key);
    if (!meta) { meta = parseSession(n.file); parseCache.set(key, meta); }
    if (!meta.cwd) continue; // can't place a session with no cwd

    const cwd = meta.cwd;
    const { root, name } = repoFor(cwd);
    const branch = meta.branch || path.basename(cwd) || 'unknown';

    const wt = emptyWorktree(cwd, branch, name);
    wt.sessionId    = meta.sessionId;
    wt.title        = meta.title ?? undefined;
    wt.lastActivity = n.mtimeMs;
    wt.repoName     = name;
    wt.pooled       = pooled.has(cwd) || cwd.includes('/.claude/worktrees/');

    let group = groups.get(root);
    if (!group) { group = { repo: name, root, worktrees: [] }; groups.set(root, group); }
    // De-dupe by cwd (one row per worktree, newest session wins)
    if (!group.worktrees.some(w => w.id === cwd)) group.worktrees.push(wt);
  }

  // Sort worktrees within a repo by recency; repos by their most-recent worktree.
  const repos = [...groups.values()]
    .map(g => ({
      ...g,
      worktrees: g.worktrees.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0)),
    }))
    .sort((a, b) =>
      (b.worktrees[0]?.lastActivity ?? 0) - (a.worktrees[0]?.lastActivity ?? 0)
    );

  lastSignature = signature;
  lastResult = { repos, generated_at: Math.floor(Date.now() / 1000) };
  return lastResult;
}
