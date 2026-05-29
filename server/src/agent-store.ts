/**
 * agent-store.ts — in-memory store for active Claude agent sessions.
 *
 * Keyed by project_path (= worktree absolute path = worktree id).
 * Persisted to ~/.worktree-dash/sessions.json so data survives server restarts.
 *
 * Stale cleanup: sessions stuck on 'running' with no activity for
 * STALE_TIMEOUT_MS are removed — handles crashed/killed Claude sessions.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SESSIONS_FILE    = path.join(os.homedir(), '.worktree-dash', 'sessions.json');
const STALE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export interface AgentHistoryEntry {
  event: 'registered' | 'status' | 'done' | 'blocked' | 'error';
  message: string;
  timestamp: number;
}

export interface AgentData {
  project_path: string;
  task: string;
  current_activity: string;
  status: 'running' | 'done' | 'blocked' | 'error';
  summary?: string;
  question?: string;
  error_msg?: string;
  registered_at: number;
  last_updated_at: number;
  history: AgentHistoryEntry[];
}

class AgentStore {
  private sessions = new Map<string, AgentData>();

  // ── Persistence ────────────────────────────────────────────────────────

  load(): void {
    try {
      const raw  = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const list = JSON.parse(raw) as AgentData[];
      if (Array.isArray(list)) {
        for (const session of list) {
          if (session.project_path) {
            this.sessions.set(session.project_path, session);
          }
        }
      }
      process.stderr.write(`[agent-store] loaded ${this.sessions.size} sessions from disk\n`);
    } catch {
      // File doesn't exist yet — that's fine
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(SESSIONS_FILE);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(this.getAll(), null, 2) + '\n');
    } catch (err) {
      process.stderr.write(`[agent-store] save error: ${String(err)}\n`);
    }
  }

  // ── Stale cleanup ──────────────────────────────────────────────────────

  /**
   * Remove sessions that have been stuck on 'running' without any activity
   * for longer than STALE_TIMEOUT_MS. Returns the count removed.
   */
  cleanupStale(): number {
    const cutoff = Date.now() - STALE_TIMEOUT_MS;
    let removed  = 0;
    for (const [key, session] of this.sessions) {
      if (session.status === 'running' && session.last_updated_at < cutoff) {
        this.sessions.delete(key);
        removed++;
        process.stderr.write(`[agent-store] removed stale session: ${session.project_path}\n`);
      }
    }
    if (removed > 0) this.save();
    return removed;
  }

  // ── Mutations ──────────────────────────────────────────────────────────

  register(project_path: string, task: string): AgentData {
    const now  = Date.now();
    const prev = this.sessions.get(project_path);

    const session: AgentData = {
      project_path,
      task,
      current_activity: 'Starting...',
      status:           'running',
      summary:          undefined,
      question:         undefined,
      error_msg:        undefined,
      registered_at:    prev?.registered_at ?? now,
      last_updated_at:  now,
      history: [
        ...(prev?.history ?? []),
        { event: 'registered', message: task, timestamp: now },
      ],
    };

    this.sessions.set(project_path, session);
    this.save();
    return session;
  }

  updateStatus(project_path: string, message: string): boolean {
    const s = this.sessions.get(project_path);
    if (!s) return false;
    s.current_activity = message;
    s.last_updated_at  = Date.now();
    s.history.push({ event: 'status', message, timestamp: Date.now() });
    this.save();
    return true;
  }

  markDone(project_path: string, summary: string): boolean {
    const s = this.sessions.get(project_path);
    if (!s) return false;
    s.status           = 'done';
    s.summary          = summary;
    s.current_activity = summary;
    s.last_updated_at  = Date.now();
    s.history.push({ event: 'done', message: summary, timestamp: Date.now() });
    this.save();
    return true;
  }

  markBlocked(project_path: string, question: string): boolean {
    const s = this.sessions.get(project_path);
    if (!s) return false;
    s.status           = 'blocked';
    s.question         = question;
    s.current_activity = question;
    s.last_updated_at  = Date.now();
    s.history.push({ event: 'blocked', message: question, timestamp: Date.now() });
    this.save();
    return true;
  }

  markError(project_path: string, error: string): boolean {
    const s = this.sessions.get(project_path);
    if (!s) return false;
    s.status           = 'error';
    s.error_msg        = error;
    s.current_activity = error;
    s.last_updated_at  = Date.now();
    s.history.push({ event: 'error', message: error, timestamp: Date.now() });
    this.save();
    return true;
  }

  get(project_path: string): AgentData | undefined {
    return this.sessions.get(project_path);
  }

  getAll(): AgentData[] {
    return Array.from(this.sessions.values());
  }
}

export const agentStore = new AgentStore();
