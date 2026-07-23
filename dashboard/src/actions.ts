import { SERVER_URL } from './config.js';
import { WorktreeInfo } from './types';

/** Pin or unpin a worktree on the server (updates tiers + rebroadcasts). */
export function setPinned(cwd: string, pinned: boolean): Promise<void> {
  return fetch(`${SERVER_URL}/api/${pinned ? 'pin' : 'unpin'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  }).then(() => undefined).catch(() => undefined);
}

/** Persist a new pin priority order (array of cwds). */
export function reorderPins(order: string[]): Promise<void> {
  return fetch(`${SERVER_URL}/api/pins/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  }).then(() => undefined).catch(() => undefined);
}

/** Set the full ordered pinned list — pin, unpin, and reorder in one call. */
export function setPins(order: string[]): Promise<void> {
  return fetch(`${SERVER_URL}/api/pins/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  }).then(() => undefined).catch(() => undefined);
}

/** The shell command that resumes this worktree's newest Claude session. */
export function resumeCommand(wt: WorktreeInfo): string {
  return wt.sessionId
    ? `cd "${wt.id}" && claude --resume ${wt.sessionId}`
    : `cd "${wt.id}" && claude`;
}
