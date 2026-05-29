/**
 * registry.ts — manages ~/.worktree-dash/repos.json
 * The registry is just an array of absolute repo root paths.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const DASH_DIR     = path.join(os.homedir(), '.worktree-dash');
export const REPOS_FILE   = path.join(DASH_DIR, 'repos.json');
export const STATUS_DIR   = path.join(DASH_DIR, 'status');
export const HOOKS_DIR    = path.join(DASH_DIR, 'hooks');

function ensureDashDir(): void {
  fs.mkdirSync(DASH_DIR,   { recursive: true });
  fs.mkdirSync(STATUS_DIR, { recursive: true });
  fs.mkdirSync(HOOKS_DIR,  { recursive: true });
}

export function loadRepos(): string[] {
  try {
    const raw = fs.readFileSync(REPOS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(p => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRepos(repos: string[]): void {
  ensureDashDir();
  fs.writeFileSync(REPOS_FILE, JSON.stringify(repos, null, 2) + '\n');
}

export function addRepo(repoPath: string): { added: boolean; message: string } {
  const abs = path.resolve(repoPath);
  const repos = loadRepos();
  if (repos.includes(abs)) {
    return { added: false, message: `Already registered: ${abs}` };
  }
  repos.push(abs);
  saveRepos(repos);
  return { added: true, message: `Registered: ${abs}` };
}

export function removeRepo(repoPath: string): { removed: boolean; message: string } {
  const abs = path.resolve(repoPath);
  const repos = loadRepos();
  const filtered = repos.filter(r => r !== abs);
  if (filtered.length === repos.length) {
    return { removed: false, message: `Not found: ${abs}` };
  }
  saveRepos(filtered);
  return { removed: true, message: `Removed: ${abs}` };
}
