/**
 * pins.ts — user-pinned worktrees, persisted to ~/.worktree-dash/pins.json.
 *
 * Pins are keyed by absolute cwd (= worktree id), so they survive forever —
 * across sessions, restarts, and even after the session transcript is gone.
 * Pinning replaces the old static repo registry: instead of "register a repo",
 * the user just pins the worktrees they reuse.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DASH_DIR } from './registry.js';

const PINS_FILE = path.join(DASH_DIR, 'pins.json');

interface PinsFile { pins: string[]; }

function read(): string[] {
  try {
    const raw = fs.readFileSync(PINS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PinsFile;
    return Array.isArray(parsed.pins) ? parsed.pins : [];
  } catch {
    return [];
  }
}

function write(pins: string[]): void {
  try {
    fs.mkdirSync(DASH_DIR, { recursive: true });
    fs.writeFileSync(PINS_FILE, JSON.stringify({ pins }, null, 2));
  } catch { /* ignore */ }
}

/** Current pins as a Set for O(1) membership checks. */
export function getPins(): Set<string> {
  return new Set(read());
}

/** Current pins in priority order (the order the user arranged them). */
export function getPinsList(): string[] {
  return read();
}

/** Set the full pinned list (ordered) — pins, unpins, and reorders in one shot. */
export function setPins(order: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const cwd of order) if (cwd && !seen.has(cwd)) { seen.add(cwd); next.push(cwd); }
  write(next);
  return next;
}

/** Replace the pin order. Keeps only cwds that are already pinned. */
export function reorderPins(order: string[]): string[] {
  const current = new Set(read());
  const next = order.filter(cwd => current.has(cwd));
  // Append any pins missing from `order` (defensive) so none are lost.
  for (const cwd of current) if (!next.includes(cwd)) next.push(cwd);
  write(next);
  return next;
}

/** Pin a worktree. Returns the full updated list. */
export function addPin(cwd: string): string[] {
  const pins = read();
  if (!pins.includes(cwd)) { pins.push(cwd); write(pins); }
  return pins;
}

/** Unpin a worktree. Returns the full updated list. */
export function removePin(cwd: string): string[] {
  const pins = read().filter(p => p !== cwd);
  write(pins);
  return pins;
}
