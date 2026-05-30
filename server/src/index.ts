/**
 * index.ts — MCP server + optional --list / --add-repo CLI modes.
 *
 * CLI modes (no MCP, just for testing):
 *   node dist/index.js --list                  → print JSON and exit
 *   node dist/index.js --add-repo /path/to/repo
 *   node dist/index.js --remove-repo /path/to/repo
 *   node dist/index.js --list-repos
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadRepos, addRepo, removeRepo } from './registry.js';
import { listWorktrees } from './discover.js';
import { focusInVSCode, openInBrowser } from './shells.js';
import { setWorktreeColors, clearWorktreeColors } from './vscode.js';

const SERVER_BASE = 'http://localhost:3444';

async function agentPost(endpoint: string, body: Record<string, string>): Promise<unknown> {
  try {
    const res = await fetch(`${SERVER_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { ok: false, error: `Could not reach maestro server at ${SERVER_BASE}. Is it running? (cd server && npm start)` };
  }
}

process.stdin.resume();
process.on('uncaughtException',   err    => process.stderr.write(`[maestro] uncaughtException: ${err.message}\n`));
process.on('unhandledRejection',  reason => process.stderr.write(`[maestro] unhandledRejection: ${String(reason)}\n`));

// ── CLI shortcut modes ─────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args[0] === '--list') {
  const repos = loadRepos();
  if (repos.length === 0) {
    console.log('No repos registered. Add one with:');
    console.log('  node dist/index.js --add-repo /absolute/path/to/repo');
    process.exit(0);
  }
  const result = listWorktrees(repos);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (args[0] === '--add-repo' && args[1]) {
  const result = addRepo(args[1]);
  console.log(result.message);
  process.exit(result.added ? 0 : 1);
}

if (args[0] === '--remove-repo' && args[1]) {
  const result = removeRepo(args[1]);
  console.log(result.message);
  process.exit(result.removed ? 0 : 1);
}

if (args[0] === '--list-repos') {
  const repos = loadRepos();
  if (repos.length === 0) console.log('(no repos registered)');
  else repos.forEach(r => console.log(r));
  process.exit(0);
}

if (args[0] === '--clear-colors-all') {
  const repos  = loadRepos();
  const result = listWorktrees(repos);
  let ok = 0, fail = 0;
  for (const repo of result.repos) {
    for (const wt of repo.worktrees) {
      if (wt.prunable) continue;
      const r = clearWorktreeColors(wt.id);
      if (r.ok) { ok++;  console.log(`  ✓  ${wt.branch}  →  cleared`); }
      else       { fail++; console.log(`  ✗  ${wt.branch}  →  ${r.error}`); }
    }
  }
  console.log(`\nDone: ${ok} cleared, ${fail} failed.`);
  console.log('Reload each VS Code window (Cmd+Shift+P → "Reload Window") to apply.');
  process.exit(fail > 0 ? 1 : 0);
}

if (args[0] === '--set-colors-all') {
  const repos  = loadRepos();
  const result = listWorktrees(repos);
  let ok = 0, fail = 0;
  for (const repo of result.repos) {
    for (const wt of repo.worktrees) {
      if (wt.prunable) continue;
      const r = setWorktreeColors(wt.id, repo.repo, wt.branch, wt.color);
      if (r.ok) { ok++;  console.log(`  ✓  ${wt.branch}  →  ${wt.id}/.vscode/settings.json`); }
      else       { fail++; console.log(`  ✗  ${wt.branch}  →  ${r.error}`); }
    }
  }
  console.log(`\nDone: ${ok} updated, ${fail} failed.`);
  console.log('Reload each VS Code window (Cmd+Shift+P → "Reload Window") to apply.');
  process.exit(fail > 0 ? 1 : 0);
}

// ── MCP Server ─────────────────────────────────────────────────────────────

const mcp = new McpServer({
  name:    'maestro',
  version: '0.1.0',
});

// ─── list_worktrees ────────────────────────────────────────────────────────
mcp.tool(
  'list_worktrees',
  'Returns all worktrees across registered repos, grouped by repo. ' +
  'Each worktree shows branch, port, server up/down, Claude session state, ' +
  'and git status (dirty, ahead, behind).',
  {},
  async () => {
    const repos = loadRepos();
    if (repos.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No repos registered. Use add_repo first.',
        }],
      };
    }
    const result = listWorktrees(repos);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── add_repo ──────────────────────────────────────────────────────────────
mcp.tool(
  'add_repo',
  'Register a git repo root path in the dashboard. ' +
  'All worktrees under this repo will appear in list_worktrees.',
  {
    path: z.string().describe('Absolute path to the git repo root (the folder containing .git)'),
  },
  async ({ path }) => {
    const result = addRepo(path);
    return { content: [{ type: 'text', text: result.message }] };
  }
);

// ─── remove_repo ───────────────────────────────────────────────────────────
mcp.tool(
  'remove_repo',
  'Remove a repo from the dashboard registry.',
  {
    path: z.string().describe('Absolute path to the repo root to remove'),
  },
  async ({ path }) => {
    const result = removeRepo(path);
    return { content: [{ type: 'text', text: result.message }] };
  }
);

// ─── list_repos ────────────────────────────────────────────────────────────
mcp.tool(
  'list_repos',
  'List all repo root paths currently registered in the dashboard.',
  {},
  async () => {
    const repos = loadRepos();
    return {
      content: [{
        type: 'text',
        text: repos.length > 0 ? repos.join('\n') : '(no repos registered)',
      }],
    };
  }
);

// ─── refresh ───────────────────────────────────────────────────────────────
mcp.tool(
  'refresh',
  'Force a fresh poll of all worktree states. Equivalent to calling list_worktrees.',
  {},
  async () => {
    const repos = loadRepos();
    const result = listWorktrees(repos);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── set_worktree_colors ───────────────────────────────────────────────────
mcp.tool(
  'set_worktree_colors',
  'Write stable color identity into .vscode/settings.json for one or all worktrees. ' +
  'Pass id to update one worktree; omit id to update all. ' +
  'After running, reload each VS Code window (Cmd+Shift+P → Reload Window).',
  {
    id: z.string().optional().describe('Worktree id (absolute path). Omit to apply to all.'),
  },
  async ({ id }) => {
    const repos  = loadRepos();
    const result = listWorktrees(repos);
    const all    = result.repos.flatMap(r =>
      r.worktrees.filter(w => !w.prunable).map(w => ({ ...w, repoName: r.repo }))
    );

    const targets = id ? all.filter(w => w.id === id) : all;
    if (targets.length === 0) {
      return { content: [{ type: 'text', text: id ? `Worktree not found: ${id}` : 'No worktrees registered.' }] };
    }

    const results = targets.map(w =>
      setWorktreeColors(w.id, w.repoName, w.branch, w.color)
    );
    const ok   = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok);

    const lines = results.map(r =>
      r.ok ? `✓ ${r.id}` : `✗ ${r.id}: ${r.error}`
    );
    lines.push(`\n${ok} updated${fail.length > 0 ? `, ${fail.length} failed` : ''}.`);
    lines.push('Reload each VS Code window to apply (Cmd+Shift+P → Reload Window).');

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ─── focus_worktree ────────────────────────────────────────────────────────
mcp.tool(
  'focus_worktree',
  'Bring the VS Code window for a worktree into focus (or open it if not running). ' +
  'Pass the worktree id (absolute path) from list_worktrees.',
  {
    id: z.string().describe('Absolute path to the worktree (the id field from list_worktrees)'),
  },
  async ({ id }) => {
    focusInVSCode(id); // fire-and-forget
    return { content: [{ type: 'text', text: `Focusing: ${id}` }] };
  }
);

// ─── open_in_browser ───────────────────────────────────────────────────────
mcp.tool(
  'open_in_browser',
  'Open the dev server for a worktree in the default browser. ' +
  'The worktree must have a port declared in .dashboard/port.',
  {
    id: z.string().describe('Absolute path to the worktree (the id field from list_worktrees)'),
  },
  async ({ id }) => {
    const repos = loadRepos();
    const result = listWorktrees(repos);
    const worktree = result.repos.flatMap(r => r.worktrees).find(w => w.id === id);
    if (!worktree)          return { content: [{ type: 'text', text: `Worktree not found: ${id}` }] };
    if (worktree.port === null) return { content: [{ type: 'text', text: `No port declared for ${id}. Add a .dashboard/port file.` }] };
    const url = `http://localhost:${worktree.port}`;
    openInBrowser(url); // fire-and-forget
    return { content: [{ type: 'text', text: `Opening ${url}` }] };
  }
);

// ── Agent self-reporting tools (merged from agent-command-center) ──────────

mcp.tool(
  'register_agent',
  'Register this Claude session with the worktree dashboard. ' +
  'Call ONCE at session start. Returns your agent_id — store it and pass it to all other report_* calls.',
  {
    project_path: z.string().describe('Absolute path to the project you are working in (use the cwd you started in)'),
    task: z.string().describe('One sentence: what this session will accomplish'),
  },
  async ({ project_path, task }) => {
    const result = await agentPost('/api/agent/register', { project_path, task });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

mcp.tool(
  'report_status',
  'Report what you are currently doing. Call after each significant action so the dashboard stays live.',
  {
    agent_id: z.string().describe('Your agent_id (the project_path returned by register_agent)'),
    message:  z.string().describe('Short description of the current action, e.g. "writing migration for users table"'),
  },
  async ({ agent_id, message }) => {
    const result = await agentPost('/api/agent/status', { agent_id, message });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

mcp.tool(
  'report_done',
  'Report that your task is complete. Call when finished.',
  {
    agent_id: z.string().describe('Your agent_id'),
    summary:  z.string().describe('What was accomplished, e.g. "POST /deals built with pagination. All tests passing."'),
  },
  async ({ agent_id, summary }) => {
    const result = await agentPost('/api/agent/done', { agent_id, summary });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

mcp.tool(
  'report_blocked',
  'Report that you need developer input to continue.',
  {
    agent_id: z.string().describe('Your agent_id'),
    question: z.string().describe('Specific question or decision you need, e.g. "should token refresh be silent or force re-login?"'),
  },
  async ({ agent_id, question }) => {
    const result = await agentPost('/api/agent/blocked', { agent_id, question });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

mcp.tool(
  'report_error',
  'Report an unrecoverable error that requires developer intervention.',
  {
    agent_id: z.string().describe('Your agent_id'),
    error:    z.string().describe('Description of the error and what was attempted'),
  },
  async ({ agent_id, error }) => {
    const result = await agentPost('/api/agent/error', { agent_id, error });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
process.stderr.write('[maestro] MCP server ready on stdio\n');
