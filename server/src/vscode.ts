/**
 * vscode.ts — writes VS Code window identity into each worktree's .vscode/settings.json.
 *
 * Sets:
 *   - window.title        → "repo · branch"
 *   - workbench.colorCustomizations → title bar, activity bar, status bar
 *
 * Merges non-destructively: any existing .vscode/settings.json keys are preserved.
 * Safe to re-run; calling it again updates the color if the branch changes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { darkenColor } from './color.js';

export interface SetColorsResult {
  id: string;
  ok: boolean;
  error?: string;
}

export function setWorktreeColors(
  worktreePath: string,
  repo: string,
  branch: string,
  color: string,
): SetColorsResult {
  const vscodeDir    = path.join(worktreePath, '.vscode');
  const settingsPath = path.join(vscodeDir, 'settings.json');
  const dimColor     = darkenColor(color, 0.65);   // inactive chrome
  const textColor    = '#ffffff';
  const dimText      = '#ffffff88';

  // Read existing settings (non-destructive merge)
  let existing: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    existing  = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist yet — start fresh
  }

  // Window title: always shows identity regardless of active file
  existing['window.title'] = `${repo} · ${branch}\${separator}\${dirty}\${activeEditorShort}`;

  // Merge color customizations (preserve any user overrides for other keys)
  const prev = (existing['workbench.colorCustomizations'] as Record<string, string>) ?? {};
  existing['workbench.colorCustomizations'] = {
    ...prev,
    // Title bar
    'titleBar.activeBackground':   color,
    'titleBar.activeForeground':   textColor,
    'titleBar.inactiveBackground': dimColor,
    'titleBar.inactiveForeground': dimText,
    'titleBar.border':             '#00000000',
    // Activity bar
    'activityBar.background':      color,
    'activityBar.foreground':      textColor,
    'activityBar.inactiveForeground': dimText,
    'activityBar.border':          '#00000000',
    // Status bar
    'statusBar.background':        color,
    'statusBar.foreground':        textColor,
    'statusBar.border':            '#00000000',
    'statusBar.debuggingBackground': dimColor,
    'statusBar.noFolderBackground':  dimColor,
  };

  try {
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n');
    return { id: worktreePath, ok: true };
  } catch (err) {
    return { id: worktreePath, ok: false, error: String(err) };
  }
}

/** Keys we own — used to remove our additions without touching anything else */
const OUR_COLOR_KEYS = [
  'titleBar.activeBackground', 'titleBar.activeForeground',
  'titleBar.inactiveBackground', 'titleBar.inactiveForeground', 'titleBar.border',
  'activityBar.background', 'activityBar.foreground',
  'activityBar.inactiveForeground', 'activityBar.border',
  'statusBar.background', 'statusBar.foreground', 'statusBar.border',
  'statusBar.debuggingBackground', 'statusBar.noFolderBackground',
];

/**
 * Remove only the keys this tool wrote. Leaves everything else in
 * .vscode/settings.json untouched. If colorCustomizations becomes
 * empty after removal, deletes that key too.
 */
export function clearWorktreeColors(worktreePath: string): SetColorsResult {
  const settingsPath = path.join(worktreePath, '.vscode', 'settings.json');

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { id: worktreePath, ok: true }; // nothing to clear
  }

  // Remove window.title only if it looks like ours (repo · branch format)
  const title = existing['window.title'] as string | undefined;
  if (title && title.includes(' · ')) delete existing['window.title'];

  // Strip our color keys from colorCustomizations
  const cc = existing['workbench.colorCustomizations'] as Record<string, string> | undefined;
  if (cc) {
    for (const key of OUR_COLOR_KEYS) delete cc[key];
    if (Object.keys(cc).length === 0) delete existing['workbench.colorCustomizations'];
    else existing['workbench.colorCustomizations'] = cc;
  }

  try {
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n');
    return { id: worktreePath, ok: true };
  } catch (err) {
    return { id: worktreePath, ok: false, error: String(err) };
  }
}
