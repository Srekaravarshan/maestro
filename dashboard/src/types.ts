export interface GitInfo {
  dirty: boolean;
  ahead: number;
  behind: number;
  upstream: boolean;
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
  history: Array<{ event: string; message: string; timestamp: number }>;
}

export interface WorktreeInfo {
  id: string;
  branch: string;
  port: number | null;
  server: 'up' | 'down';
  claude: 'working' | 'idle' | 'waiting' | 'unknown';
  git: GitInfo;
  color: string;
  prunable?: true;
  /** Unix ms when hook last wrote state. Null = no hooks fired yet. */
  claude_updated_at: number | null;
  agent?: AgentData;

  // ── Dynamic-discovery fields ─────────────────────────────────────────────
  /** Newest Claude Code session id — used for `claude --resume`. */
  sessionId?: string;
  /** AI-generated session title, if present. */
  title?: string;
  /** Unix ms of newest session activity (transcript mtime). */
  lastActivity?: number | null;
  /** True if the user pinned this worktree. */
  pinned?: boolean;
  /** True if this is a desktop-managed pooled worktree. */
  pooled?: boolean;
  /** UI bucket. */
  tier?: 'pinned' | 'active' | 'other';
  /** Name of the main repo this worktree belongs to. */
  repoName?: string;
  /** Position within the user's pin order (lower = higher priority). */
  pinIndex?: number;
  /** Host app the session runs in: vscode | iterm | terminal | tmux | app. */
  host?: string;
}

export interface RepoGroup {
  repo: string;
  root: string;
  worktrees: WorktreeInfo[];
  error?: string;
}

export interface ActivityEntry {
  id:          string;
  ts:          number;
  worktree_id: string;
  branch:      string;
  repo:        string;
  event:       string;
  message:     string;
}

export interface DashState {
  repos:             RepoGroup[];
  generated_at:      number;
  activity?:         ActivityEntry[];
  openTerminals?:    Array<{ terminal_id: string; worktree_path: string }>;
  restoreTerminals?: string[]; // worktree_paths to restore on startup
}

/** A terminal slot in the UI — one per open terminal pane */
export interface OpenTerminal {
  /** Unique slot id (local, not the server terminal_id) */
  slotId:        string;
  worktree_path: string;
  /** Set after server confirms PTY was created */
  terminal_id:   string | null;
  branch:        string;
  color:         string;
}
