/**
 * http-server.ts — always-on HTTP server.
 * Serves the React dashboard, pushes live worktree state via SSE,
 * and handles action POSTs (focus, open-browser) from the UI.
 *
 * Port: 3444 (to avoid conflict with agent-command-center at 3333)
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Response } from 'express';
import { loadRepos } from './registry.js';
import { listWorktrees, type ListWorktreesResult } from './discover.js';
import { discoverSessions } from './claude-sessions.js';
import { getPins, getPinsList, addPin, removePin, reorderPins, setPins } from './pins.js';
import { getClaudeStateResult } from './state.js';
import { focusInVSCode, openInBrowser, switchToSpace } from './shells.js';
import { setWorktreeColors, clearWorktreeColors } from './vscode.js';
import { agentStore } from './agent-store.js';
import { ptyManager } from './pty-manager.js';

const OPEN_TERMINALS_FILE = path.join(os.homedir(), '.worktree-dash', 'open-terminals.json');

function loadOpenTerminals(): string[] {
  try { return JSON.parse(fs.readFileSync(OPEN_TERMINALS_FILE, 'utf8')) as string[]; }
  catch { return []; }
}

function saveOpenTerminals(paths: string[]): void {
  try {
    fs.mkdirSync(path.dirname(OPEN_TERMINALS_FILE), { recursive: true });
    fs.writeFileSync(OPEN_TERMINALS_FILE, JSON.stringify(paths, null, 2));
  } catch { /* ignore */ }
}

function getOpenTerminalPaths(): string[] {
  return ptyManager.getAll().map(s => s.worktree_path);
}

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const HTTP_PORT    = 3444;
const POLL_MS      = 5_000;
const MAX_EVENTS   = 200;

// ── Activity log ───────────────────────────────────────────────────────────

export interface ActivityEntry {
  id:          string;   // unique — ts + worktree hash
  ts:          number;   // unix ms
  worktree_id: string;
  branch:      string;
  repo:        string;
  event:       string;
  message:     string;
}

const activityLog: ActivityEntry[] = [];

function addActivity(entry: Omit<ActivityEntry, 'id'>): void {
  const id = `${entry.ts}-${entry.worktree_id.slice(-8)}`;
  // Deduplicate — don't add the exact same event twice in rapid succession
  if (activityLog.length > 0) {
    const last = activityLog[activityLog.length - 1];
    if (last && last.worktree_id === entry.worktree_id && last.event === entry.event && last.message === entry.message) return;
  }
  activityLog.push({ id, ...entry });
  if (activityLog.length > MAX_EVENTS) activityLog.splice(0, activityLog.length - MAX_EVENTS);
}

// ── SSE client set ─────────────────────────────────────────────────────────

const clients = new Set<Response>();

function addClient(res: Response): void {
  res.socket?.setNoDelay(true);
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      if (client.writable) client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

// ── Poll loop (two tiers) ────────────────────────────────────────────────────
//
//   • refreshDiscovery() — EXPENSIVE. Shells out to git for every worktree.
//     Runs once at startup and on the POLL_MS interval only.
//   • poll() — CHEAP. Overlays fresh Claude state (read from the tiny status
//     JSON files) onto the cached git discovery, merges agent data, and
//     broadcasts. This is what the /api/refresh hook and the agent endpoints
//     call — so a hook fire never triggers an N-worktree git sweep.

let lastSnapshot = '';

/** Cached result of the last expensive git discovery. */
let cachedRaw: ListWorktreesResult = { repos: [], generated_at: 0 };

/** EXPENSIVE: dynamic discovery from ~/.claude/projects/. Updates the cache. */
function refreshDiscovery(): void {
  try {
    cachedRaw = discoverSessions();
  } catch (err) {
    process.stderr.write(`[maestro] discovery error: ${String(err)}\n`);
  }
}

const ACTIVE_WINDOW_MS = 15 * 60 * 1000; // "active" = touched in the last 15 min

/** Tag each worktree with pinned + tier so the UI can bucket them. */
function addTiers(result: ListWorktreesResult, pinsOrder: string[]): ListWorktreesResult {
  const now = Date.now();
  return {
    ...result,
    repos: result.repos.map(repo => ({
      ...repo,
      worktrees: repo.worktrees.map(wt => {
        const pinIndex = pinsOrder.indexOf(wt.id);
        const pinned = pinIndex >= 0;
        const liveHook = wt.claude === 'working' || wt.claude === 'waiting';
        const liveAgent = wt.agent != null && wt.agent.status !== 'done';
        const recent = wt.lastActivity != null && (now - wt.lastActivity) < ACTIVE_WINDOW_MS;
        const active = liveHook || liveAgent || recent;
        const tier: 'pinned' | 'active' | 'other' = pinned ? 'pinned' : active ? 'active' : 'other';
        return { ...wt, pinned, tier, pinIndex: pinned ? pinIndex : undefined };
      }),
    })),
  };
}

/** Overlay fresh Claude state (from status files) onto cached git discovery. */
function withFreshClaudeState(raw: ListWorktreesResult): ListWorktreesResult {
  return {
    ...raw,
    repos: raw.repos.map(repo => ({
      ...repo,
      worktrees: repo.worktrees.map(wt => {
        const cs = getClaudeStateResult(wt.id);
        return { ...wt, claude: cs.state, claude_updated_at: cs.updated_at, host: cs.host };
      }),
    })),
  };
}

/** Merge agent store data into the discovery result before broadcasting. */
function mergeAgentData(result: ListWorktreesResult): ListWorktreesResult {
  return {
    ...result,
    repos: result.repos.map(repo => ({
      ...repo,
      worktrees: repo.worktrees.map(wt => ({
        ...wt,
        agent: agentStore.get(wt.id),
      })),
    })),
  };
}

/** Track previous claude states so we can detect hook-based transitions */
const prevClaudeState = new Map<string, string>();

/** Mutates activityLog + prevClaudeState. Call only from poll(). */
function detectActivityTransitions(result: ListWorktreesResult): void {
  for (const repo of result.repos) {
    for (const wt of repo.worktrees) {
      const prev = prevClaudeState.get(wt.id);
      if (prev !== wt.claude && wt.claude !== 'unknown') {
        prevClaudeState.set(wt.id, wt.claude);
        if (prev !== undefined) { // skip the initial population
          addActivity({
            ts:          Date.now(),
            worktree_id: wt.id,
            branch:      wt.branch,
            repo:        repo.repo,
            event:       wt.claude,
            message:     wt.claude === 'waiting' ? 'Claude needs input' : `Claude is ${wt.claude}`,
          });
        }
      } else if (!prevClaudeState.has(wt.id)) {
        prevClaudeState.set(wt.id, wt.claude);
      }
    }
  }
}

/** Assemble the SSE broadcast payload (pure — no mutation). */
function assemblePayload(result: ListWorktreesResult) {
  return {
    ...result,
    activity:         activityLog.slice().reverse(),
    openTerminals:    getOpenTerminalsForBroadcast(),
    restoreTerminals: previousTerminals,
  };
}

/** CHEAP: overlay fresh state onto cached discovery, diff, broadcast. */
function poll(): void {
  try {
    const result = addTiers(mergeAgentData(withFreshClaudeState(cachedRaw)), getPinsList());
    detectActivityTransitions(result);
    const payload = assemblePayload(result);
    const snap = JSON.stringify(payload);
    if (snap !== lastSnapshot) {
      lastSnapshot = snap;
      broadcast('state', payload);
    }
  } catch (err) {
    process.stderr.write(`[maestro] poll error: ${String(err)}\n`);
  }
}

// ── Express app ────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// SSE endpoint
app.get('/events', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  addClient(res);

  // Send current state immediately on connect (from cache — no git sweep)
  const result  = addTiers(mergeAgentData(withFreshClaudeState(cachedRaw)), getPinsList());
  const payload = assemblePayload(result);
  res.write(`event: state\ndata: ${JSON.stringify(payload)}\n\n`);
});

// REST snapshot
app.get('/api/state', (_req, res) => {
  const repos  = loadRepos();
  const result = repos.length > 0 ? listWorktrees(repos) : { repos: [], generated_at: 0 };
  res.json(result);
});

// ── Agent endpoints (called by MCP tools in index.ts) ─────────────────────

function agentBranch(agent_id: string): { branch: string; repo: string } {
  const parts = agent_id.split('/').filter(Boolean);
  return { branch: parts[parts.length - 1] ?? agent_id, repo: parts[parts.length - 2] ?? '' };
}

app.post('/api/agent/register', (req, res) => {
  const { project_path, task } = req.body as { project_path?: string; task?: string };
  if (!project_path || !task) return res.status(400).json({ ok: false, error: 'project_path and task required' });
  const session = agentStore.register(project_path, task);
  const { branch, repo } = agentBranch(project_path);
  addActivity({ ts: Date.now(), worktree_id: project_path, branch, repo, event: 'registered', message: task });
  poll();
  return res.json({ agent_id: session.project_path, message: 'registered' });
});

app.post('/api/agent/status', (req, res) => {
  const { agent_id, message } = req.body as { agent_id?: string; message?: string };
  if (!agent_id || !message) return res.status(400).json({ ok: false });
  const ok = agentStore.updateStatus(agent_id, message);
  if (ok) {
    const { branch, repo } = agentBranch(agent_id);
    addActivity({ ts: Date.now(), worktree_id: agent_id, branch, repo, event: 'status', message });
    poll();
  }
  return res.json({ ok });
});

app.post('/api/agent/done', (req, res) => {
  const { agent_id, summary } = req.body as { agent_id?: string; summary?: string };
  if (!agent_id || !summary) return res.status(400).json({ ok: false });
  const ok = agentStore.markDone(agent_id, summary);
  if (ok) {
    const { branch, repo } = agentBranch(agent_id);
    addActivity({ ts: Date.now(), worktree_id: agent_id, branch, repo, event: 'done', message: summary });
    poll();
  }
  return res.json({ ok });
});

app.post('/api/agent/blocked', (req, res) => {
  const { agent_id, question } = req.body as { agent_id?: string; question?: string };
  if (!agent_id || !question) return res.status(400).json({ ok: false });
  const ok = agentStore.markBlocked(agent_id, question);
  if (ok) {
    const { branch, repo } = agentBranch(agent_id);
    addActivity({ ts: Date.now(), worktree_id: agent_id, branch, repo, event: 'blocked', message: question });
    poll();
  }
  return res.json({ ok });
});

app.post('/api/agent/error', (req, res) => {
  const { agent_id, error } = req.body as { agent_id?: string; error?: string };
  if (!agent_id || !error) return res.status(400).json({ ok: false });
  const ok = agentStore.markError(agent_id, error);
  if (ok) {
    const { branch, repo } = agentBranch(agent_id);
    addActivity({ ts: Date.now(), worktree_id: agent_id, branch, repo, event: 'error', message: error });
    poll();
  }
  return res.json({ ok });
});

// ── Pins ────────────────────────────────────────────────────────────────────

app.post('/api/pin', (req, res) => {
  const { cwd } = req.body as { cwd?: string };
  if (!cwd) return res.status(400).json({ ok: false, error: 'cwd required' });
  addPin(cwd);
  poll(); // recompute tiers + broadcast immediately
  return res.json({ ok: true, pins: [...getPins()] });
});

app.post('/api/unpin', (req, res) => {
  const { cwd } = req.body as { cwd?: string };
  if (!cwd) return res.status(400).json({ ok: false, error: 'cwd required' });
  removePin(cwd);
  poll();
  return res.json({ ok: true, pins: [...getPins()] });
});

app.post('/api/pins/reorder', (req, res) => {
  const { order } = req.body as { order?: string[] };
  if (!Array.isArray(order)) return res.status(400).json({ ok: false, error: 'order[] required' });
  const pins = reorderPins(order);
  poll();
  return res.json({ ok: true, pins });
});

// Set the full ordered pinned list — handles pin + unpin + reorder in one call.
app.post('/api/pins/set', (req, res) => {
  const { order } = req.body as { order?: string[] };
  if (!Array.isArray(order)) return res.status(400).json({ ok: false, error: 'order[] required' });
  const pins = setPins(order);
  poll();
  return res.json({ ok: true, pins });
});

// Action: write VS Code color identity for all worktrees
app.post('/api/set-colors-all', (_req, res) => {
  const repos  = loadRepos();
  const result = repos.length > 0 ? listWorktrees(repos) : { repos: [], generated_at: 0 };
  const results = result.repos.flatMap(r =>
    r.worktrees.filter(w => !w.prunable).map(w =>
      setWorktreeColors(w.id, r.repo, w.branch, w.color)
    )
  );
  const ok   = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  res.json({ ok: true, updated: ok, failed: fail });
});

// Action: clear VS Code color identity for all worktrees
app.post('/api/clear-colors-all', (_req, res) => {
  const repos  = loadRepos();
  const result = repos.length > 0 ? listWorktrees(repos) : { repos: [], generated_at: 0 };
  const results = result.repos.flatMap(r =>
    r.worktrees.filter(w => !w.prunable).map(w => clearWorktreeColors(w.id))
  );
  res.json({ ok: true, cleared: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
});

// Action: force an immediate poll + SSE broadcast (called by the hook script)
app.post('/api/refresh', (_req, res) => {
  poll();
  res.json({ ok: true });
});

// Action: focus a worktree in VS Code
// Responds immediately — shell command runs async so the browser isn't blocked.
app.post('/api/focus', (req, res) => {
  const { id } = req.body as { id?: string };
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  res.json({ ok: true }); // respond BEFORE the shell call
  focusInVSCode(id);
});

// Action: open browser tab for a worktree's dev server
app.post('/api/open-browser', (req, res) => {
  const { port } = req.body as { port?: number };
  if (!port) return res.status(400).json({ ok: false, error: 'port required' });
  res.json({ ok: true });
  openInBrowser(`http://localhost:${port}`);
});

// Dashboard static files
const dashboardDist = path.join(__dirname, '../../dashboard/dist');
app.use(express.static(dashboardDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(dashboardDist, 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────

// ── WebSocket server — terminal I/O ───────────────────────────────────────

const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer, path: '/terminal' });

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;

      if (msg['type'] === 'create') {
        const worktree_path = msg['worktree_path'] as string;
        const cols = (msg['cols'] as number) || 120;
        const rows = (msg['rows'] as number) || 40;

        let terminal_id: string;
        try {
          terminal_id = ptyManager.create(
            worktree_path, cols, rows,
            (data) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'output', terminal_id, data }));
              }
            },
            (code) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'exit', terminal_id, code }));
              }
              saveOpenTerminals(getOpenTerminalPaths());
            },
          );
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: String(err) }));
          process.stderr.write(`[pty] spawn failed: ${String(err)}\n`);
          return;
        }

        ws.send(JSON.stringify({ type: 'created', terminal_id, worktree_path }));
        saveOpenTerminals(getOpenTerminalPaths());

      } else if (msg['type'] === 'input') {
        ptyManager.write(msg['terminal_id'] as string, msg['data'] as string);

      } else if (msg['type'] === 'resize') {
        ptyManager.resize(
          msg['terminal_id'] as string,
          (msg['cols'] as number) || 120,
          (msg['rows'] as number) || 40,
        );

      } else if (msg['type'] === 'kill') {
        ptyManager.kill(msg['terminal_id'] as string);
        saveOpenTerminals(getOpenTerminalPaths());
      }
    } catch (err) {
      process.stderr.write(`[ws] message error: ${String(err)}\n`);
    }
  });
});

// Include open terminal paths in the SSE broadcast so dashboard can restore
function getOpenTerminalsForBroadcast() {
  return ptyManager.getAll().map(s => ({
    terminal_id:   s.terminal_id,
    worktree_path: s.worktree_path,
  }));
}

// ── Start ──────────────────────────────────────────────────────────────────

// Load persisted state
agentStore.load();
const previousTerminals = loadOpenTerminals();

httpServer.listen(HTTP_PORT, () => {
  console.log(`[maestro] Dashboard  →  http://localhost:${HTTP_PORT}`);
  console.log(`[maestro] WebSocket  →  ws://localhost:${HTTP_PORT}/terminal`);

  if (previousTerminals.length > 0) {
    console.log(`[maestro] Restoring ${previousTerminals.length} terminal(s) from last session`);
  }

  // Heartbeat
  setInterval(() => {
    for (const client of clients) {
      try { if (client.writable) client.write(': ping\n\n'); } catch { clients.delete(client); }
    }
  }, 15_000);

  // Stale session cleanup — every 2 minutes
  setInterval(() => {
    const removed = agentStore.cleanupStale();
    if (removed > 0) poll();
  }, 2 * 60 * 1000);

  // Initial discovery + broadcast
  refreshDiscovery();
  poll();
  // Expensive git discovery on the interval; cheap poll overlays fresh state.
  // Hook fires and agent endpoints call poll() only — no git sweep per event.
  setInterval(() => { refreshDiscovery(); poll(); }, POLL_MS);
});
