import { SERVER_URL } from '../config.js';
import { useState, useRef } from 'react';
import { WorktreeInfo } from '../types';

interface Props {
  worktree: WorktreeInfo;
  /** id of the worktree currently being focused — disables all other cards */
  focusingId: string | null;
  onFocusStart: (id: string) => void;
  onFocusDone:  () => void;
}

const HOOK_COLOR: Record<string, string> = {
  working: '#22c55e',
  idle:    '#3b82f6',
  waiting: '#f59e0b',
  unknown: '#444',
};
const HOOK_LABEL: Record<string, string> = {
  working: '⚙ working',
  idle:    '· idle',
  waiting: '⚠ needs input',   // clearer than "waiting"
  unknown: '· —',
};
const HOOK_TITLE: Record<string, string> = {
  working: 'Claude is actively running in this terminal',
  idle:    'Claude finished its last turn',
  waiting: 'Claude has a question — go look at this terminal',
  unknown: 'No hook data yet — hooks may not be installed',
};

const AGENT_COLOR: Record<string, string> = {
  running: '#22c55e',
  done:    '#3b82f6',
  blocked: '#f59e0b',
  error:   '#ef4444',
};
const AGENT_LABEL: Record<string, string> = {
  running: '⚙ running',
  done:    '✓ done',
  blocked: '⚠ blocked',
  error:   '✗ error',
};

async function postFocus(id: string) {
  await fetch(`${SERVER_URL}/api/focus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

function timeAgo(ms: number | null | undefined): string {
  if (!ms) return '';
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 10)  return 'just now';
  if (secs < 60)  return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

async function postOpenBrowser(port: number) {
  await fetch(`${SERVER_URL}/api/open-browser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port }),
  });
}

export default function WorktreeRow({ worktree: wt, focusingId, onFocusStart, onFocusDone }: Props) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMeFocusing  = focusingId === wt.id;
  const isOtherFocus  = focusingId !== null && focusingId !== wt.id;
  // Blocked while any focus is in flight — prevents the queue-up problem
  const clickDisabled = focusingId !== null;

  async function handleFocus(e: React.MouseEvent) {
    e.stopPropagation();
    if (clickDisabled) return;

    onFocusStart(wt.id);

    // Lock for at least 1500ms so the user can't accidentally re-click while
    // VS Code is coming to front. The server responds in ~10ms (fire-and-forget),
    // but the OS still needs ~50-1500ms to actually focus the right window.
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onFocusDone(), 1500);

    // Fire — don't await
    postFocus(wt.id);
  }

  const parts      = wt.id.split('/');
  const folderName = parts[parts.length - 1] ?? wt.id;
  const agent      = wt.agent;

  const statusColor   = agent ? AGENT_COLOR[agent.status] : HOOK_COLOR[wt.claude];
  const statusLabel   = agent ? AGENT_LABEL[agent.status] : HOOK_LABEL[wt.claude];
  const statusTitle   = agent
    ? `MCP connected — task: ${agent.task}`
    : HOOK_TITLE[wt.claude] ?? '';
  const statusUpdated = agent?.last_updated_at ?? wt.claude_updated_at ?? null;
  const statusAge     = timeAgo(statusUpdated);

  const needsAttention = agent?.status === 'blocked' || agent?.status === 'done'
    || agent?.status === 'error' || wt.claude === 'waiting';

  return (
    <div
      onClick={handleFocus}
      title={clickDisabled && !isMeFocusing ? 'Waiting for previous focus to complete…' : `Click to focus in VS Code`}
      style={{
        display: 'grid',
        gridTemplateColumns: '3px 1fr auto',
        background: isMeFocusing ? '#202020' : '#141414',
        borderRadius: 5,
        overflow: 'hidden',
        cursor: clickDisabled ? 'not-allowed' : 'pointer',
        opacity: isOtherFocus ? 0.5 : 1,
        transition: 'opacity 0.2s, background 0.15s',
        border: `1px solid ${needsAttention ? `${statusColor}55` : '#1e1e1e'}`,
        pointerEvents: clickDisabled ? 'none' : 'auto',
      }}
      onMouseEnter={e => { if (!clickDisabled) e.currentTarget.style.background = '#1c1c1c'; }}
      onMouseLeave={e => { if (!isMeFocusing) e.currentTarget.style.background = '#141414'; }}
    >
      <div style={{ background: wt.color, alignSelf: 'stretch' }} />

      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        {/* Row 1 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 600, color: '#e2e2e2', fontSize: 13 }}>{wt.branch}</span>
            {folderName !== wt.branch && (
              <span style={{ color: '#3a3a3a', fontSize: 11, marginLeft: 6 }}>{folderName}</span>
            )}
            {/* MCP connected dot */}
            {agent && (
              <span
                title={`MCP connected · registered ${new Date(agent.registered_at).toLocaleTimeString()}`}
                style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#22c55e', marginLeft: 7, verticalAlign: 'middle' }}
              />
            )}
          </div>

          {/* Git badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            {wt.git.dirty && <Badge color="#f59e0b" bg="#f59e0b15">M</Badge>}
            {wt.git.upstream ? (
              <>
                {wt.git.ahead  > 0 && <Badge color="#22c55e" bg="#22c55e15">↑{wt.git.ahead}</Badge>}
                {wt.git.behind > 0 && <Badge color="#ef4444" bg="#ef444415">↓{wt.git.behind}</Badge>}
                {wt.git.ahead === 0 && wt.git.behind === 0 && !wt.git.dirty && (
                  <span style={{ color: '#2a2a2a', fontSize: 11 }}>clean</span>
                )}
              </>
            ) : (
              <span style={{ color: '#2a2a2a', fontSize: 11 }}>no upstream</span>
            )}
          </div>

          {/* Status + timestamp */}
          <div
            title={statusTitle}
            style={{ flexShrink: 0, textAlign: 'right' }}
          >
            <div style={{ fontSize: 11, color: statusColor, fontWeight: needsAttention ? 700 : 400 }}>
              {statusLabel}
            </div>
            {statusAge && (
              <div style={{ fontSize: 10, color: '#3a3a3a', marginTop: 1 }}>{statusAge}</div>
            )}
          </div>

          {/* Port */}
          {wt.port !== null && (
            <div
              onClick={e => { e.stopPropagation(); if (wt.port) postOpenBrowser(wt.port); }}
              title={`Open http://localhost:${wt.port}`}
              style={{
                flexShrink: 0, fontSize: 11, padding: '2px 7px', borderRadius: 4,
                background: wt.server === 'up' ? '#3b82f615' : '#1e1e1e',
                color:      wt.server === 'up' ? '#3b82f6'   : '#333',
                border:     `1px solid ${wt.server === 'up' ? '#3b82f633' : '#252525'}`,
                cursor:     wt.server === 'up' ? 'pointer' : 'default',
                pointerEvents: 'auto', // always clickable regardless of focus lock
              }}
            >
              :{wt.port} {wt.server === 'up' ? '↗' : '○'}
            </div>
          )}
        </div>

        {/* Row 2: agent data */}
        {agent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 2 }}>
            <div style={{ fontSize: 11, color: '#4a4a4a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agent.task}
            </div>
            {agent.current_activity && agent.current_activity !== 'Starting...' && (
              <div style={{
                fontSize: 11,
                color: agent.status === 'blocked' ? '#f59e0b'
                     : agent.status === 'error'   ? '#ef4444'
                     : agent.status === 'done'    ? '#3b82f6'
                     : '#777',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {agent.status === 'blocked' && '❓ '}
                {agent.status === 'error'   && '💥 '}
                {agent.status === 'done'    && '✓ '}
                {agent.current_activity}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Focus indicator */}
      <div style={{ paddingRight: 10, color: isMeFocusing ? '#555' : '#252525', fontSize: 12, flexShrink: 0, alignSelf: 'center' }}>
        {isMeFocusing ? '…' : '→'}
      </div>
    </div>
  );
}

function Badge({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 3, color, background: bg, fontWeight: 600 }}>
      {children}
    </span>
  );
}
