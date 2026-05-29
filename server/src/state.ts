/**
 * state.ts — reads Claude session state from ~/.worktree-dash/status/*.json
 *
 * State files are written by the Claude Code hooks set-state.sh script.
 * Shape: { id: <worktree-path>, repo, branch, state: working|idle|waiting, ts: <unix-seconds> }
 */
import * as fs from 'fs';
import * as path from 'path';
import { STATUS_DIR } from './registry.js';

const STALE_SECONDS = 600; // 10 minutes

export type ClaudeState = 'working' | 'idle' | 'waiting' | 'unknown';

export interface ClaudeStateResult {
  state: ClaudeState;
  /** Unix ms timestamp of when the state was written. Null if unknown/missing. */
  updated_at: number | null;
}

interface StatusFile {
  id: string;
  repo?: string;
  branch?: string;
  state: ClaudeState;
  ts: number; // unix seconds
}

function readStatusFiles(): StatusFile[] {
  try {
    const files = fs.readdirSync(STATUS_DIR).filter(f => f.endsWith('.json'));
    const results: StatusFile[] = [];
    for (const file of files) {
      try {
        const raw    = fs.readFileSync(path.join(STATUS_DIR, file), 'utf8');
        const parsed = JSON.parse(raw) as StatusFile;
        if (parsed.id && parsed.state && typeof parsed.ts === 'number') {
          results.push(parsed);
        }
      } catch { /* malformed — skip */ }
    }
    return results;
  } catch {
    return [];
  }
}

export function getClaudeStateResult(worktreePath: string): ClaudeStateResult {
  const nowSecs = Math.floor(Date.now() / 1000);
  const match   = readStatusFiles().find(f => f.id === worktreePath);

  if (!match) return { state: 'unknown', updated_at: null };

  const ageSecs = nowSecs - match.ts;
  if (match.state === 'working' && ageSecs > STALE_SECONDS) {
    return { state: 'unknown', updated_at: null };
  }

  return { state: match.state, updated_at: match.ts * 1000 };
}

/** Convenience — state only, no timestamp */
export function getClaudeState(worktreePath: string): ClaudeState {
  return getClaudeStateResult(worktreePath).state;
}

export function getAllClaudeStates(): StatusFile[] {
  return readStatusFiles();
}
