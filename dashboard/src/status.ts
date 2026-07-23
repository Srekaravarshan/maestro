import { WorktreeInfo } from './types';

// Shared status logic — used by both the tray popup (App.tsx) and the HUD pill
// (HudApp.tsx) so the two surfaces can never disagree about a worktree's state.

export type AgentStatus = 'working' | 'waiting' | 'done' | 'blocked' | 'error' | 'idle';

export function getWorktreeStatus(wt: WorktreeInfo): AgentStatus {
  // The lifecycle hooks are the source of truth for live state. Old MCP
  // agent data (persisted in sessions.json) must NOT override a live hook —
  // otherwise a worktree Claude is actively working in shows a stale
  // "done"/"block". Derive status purely from the hook signal.
  switch (wt.claude) {          // 'working' | 'idle' | 'waiting' | 'unknown'
    case 'working': return 'working';
    case 'waiting': return 'waiting';
    case 'idle':    return 'idle';
    default:        return 'idle'; // 'unknown' → not being tracked → idle
  }
}

export function worstStatus(statuses: AgentStatus[]): 'idle' | 'attention' | 'done' {
  if (statuses.some(s => s === 'waiting' || s === 'blocked' || s === 'error')) return 'attention';
  if (statuses.some(s => s === 'done')) return 'done';
  return 'idle';
}

/** Split a flat worktree list into the three UI buckets. */
export function bucket(all: WorktreeInfo[]): {
  pinned: WorktreeInfo[]; active: WorktreeInfo[]; other: WorktreeInfo[];
} {
  return {
    // Pinned in the user's manual priority order (pinIndex); others by recency.
    pinned: all.filter(w => w.tier === 'pinned')
               .sort((a, b) => (a.pinIndex ?? 0) - (b.pinIndex ?? 0)),
    active: all.filter(w => w.tier === 'active'),
    other:  all.filter(w => !w.tier || w.tier === 'other'),
  };
}

export const STATUS_DOT: Record<AgentStatus, { color: string; label: string; pulse: boolean }> = {
  working:  { color: '#22c55e', label: 'working',     pulse: true  },
  waiting:  { color: '#f59e0b', label: 'needs input', pulse: true  },
  done:     { color: '#3b82f6', label: 'done',        pulse: false },
  blocked:  { color: '#f59e0b', label: 'blocked',     pulse: true  },
  error:    { color: '#ef4444', label: 'error',       pulse: false },
  idle:     { color: '#444',    label: 'idle',        pulse: false },
};
