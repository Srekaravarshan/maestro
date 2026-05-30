/**
 * pty-manager.ts — spawns and manages PTY processes per worktree.
 *
 * Each terminal session is a real PTY (pseudo-terminal) running the user's
 * default shell in the worktree directory. This is what VS Code's integrated
 * terminal uses under the hood.
 *
 * Sessions are identified by a terminal_id (random string). Multiple sessions
 * can exist for the same worktree_path.
 */
import * as pty from 'node-pty';
import * as os from 'os';
import * as fs from 'fs';

export interface TerminalSession {
  terminal_id:  string;
  worktree_path: string;
  cols:         number;
  rows:         number;
}

type DataCallback = (data: string) => void;
type ExitCallback = (code: number) => void;

interface InternalSession extends TerminalSession {
  process: pty.IPty;
}

class PTYManager {
  private sessions = new Map<string, InternalSession>();

  create(
    worktree_path: string,
    cols:          number,
    rows:          number,
    onData:        DataCallback,
    onExit:        ExitCallback,
  ): string {
    const terminal_id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Resolve shell — prefer user's $SHELL, fall back to known macOS paths
    const shell = (() => {
      const s = process.env['SHELL'];
      if (s && fs.existsSync(s)) return s;
      for (const p of ['/bin/zsh', '/bin/bash', '/usr/bin/bash']) {
        if (fs.existsSync(p)) return p;
      }
      return '/bin/sh';
    })();

    // Verify worktree path exists
    if (!fs.existsSync(worktree_path)) {
      throw new Error(`Worktree path does not exist: ${worktree_path}`);
    }

    // node-pty's native code crashes if any env value is undefined or non-string.
    // Filter strictly and ensure HOME/USER/PATH are always present.
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') cleanEnv[k] = v;
    }
    cleanEnv['TERM']      = 'xterm-256color';
    cleanEnv['HOME']      ??= os.homedir();
    cleanEnv['USER']      ??= os.userInfo().username;
    cleanEnv['SHELL']     ??= shell;
    cleanEnv['TERM_PROGRAM'] = 'maestro';

    process.stderr.write(`[pty] spawning ${shell} in ${worktree_path} (${cols}x${rows})\n`);

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: worktree_path,
      env: cleanEnv,
    });

    proc.onData(onData);
    proc.onExit(({ exitCode }: { exitCode: number }) => {
      this.sessions.delete(terminal_id);
      onExit(exitCode ?? 0);
    });

    this.sessions.set(terminal_id, {
      terminal_id,
      worktree_path,
      cols,
      rows,
      process: proc,
    });

    return terminal_id;
  }

  write(terminal_id: string, data: string): void {
    this.sessions.get(terminal_id)?.process.write(data);
  }

  resize(terminal_id: string, cols: number, rows: number): void {
    const s = this.sessions.get(terminal_id);
    if (!s) return;
    s.cols = cols;
    s.rows = rows;
    try { s.process.resize(cols, rows); } catch { /* ignore resize race */ }
  }

  kill(terminal_id: string): void {
    const s = this.sessions.get(terminal_id);
    if (!s) return;
    try { s.process.kill(); } catch { /* already dead */ }
    this.sessions.delete(terminal_id);
  }

  killAll(): void {
    for (const id of this.sessions.keys()) this.kill(id);
  }

  getAll(): TerminalSession[] {
    return Array.from(this.sessions.values()).map(({ terminal_id, worktree_path, cols, rows }) => ({
      terminal_id, worktree_path, cols, rows,
    }));
  }

  has(terminal_id: string): boolean {
    return this.sessions.has(terminal_id);
  }
}

export const ptyManager = new PTYManager();

// Clean up all PTYs when the process exits
process.on('exit',    () => ptyManager.killAll());
process.on('SIGINT',  () => { ptyManager.killAll(); process.exit(0); });
process.on('SIGTERM', () => { ptyManager.killAll(); process.exit(0); });
