/**
 * Sidebar — 300px left panel.
 * Contains all monitoring: stats, attention queue, worktree list, activity feed.
 * Clicking a worktree row opens a terminal for it (instead of focusing VS Code).
 */
import { DashState, WorktreeInfo } from '../types';
import AttentionQueue from './AttentionQueue';

// ── Status colors ──────────────────────────────────────────────────────────

const HOOK_COLOR: Record<string, string> = {
  working: '#22c55e', idle: '#3b82f6', waiting: '#f59e0b', unknown: '#333',
};
const HOOK_ICON: Record<string, string> = {
  working: '⚙', idle: '·', waiting: '⚠', unknown: '·',
};

function timeAgo(ms: number | null): string {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

// ── Compact worktree row ───────────────────────────────────────────────────

function SidebarRow({
  wt,
  shortcutKey,
  isOpen,
  onOpen,
  onFocusVSCode,
  focusingId,
}: {
  wt:            WorktreeInfo;
  shortcutKey:   number | null;
  isOpen:        boolean;
  onOpen:        () => void;
  onFocusVSCode: () => void;
  focusingId:    string | null;
}) {
  const agent      = wt.agent;
  const statusColor = agent ? (
    agent.status === 'done'    ? '#3b82f6' :
    agent.status === 'blocked' ? '#f59e0b' :
    agent.status === 'error'   ? '#ef4444' : '#22c55e'
  ) : HOOK_COLOR[wt.claude] ?? '#333';

  const statusIcon = agent ? (
    agent.status === 'done'    ? '✓' :
    agent.status === 'blocked' ? '⚠' :
    agent.status === 'error'   ? '✗' : '⚙'
  ) : HOOK_ICON[wt.claude] ?? '·';

  const updatedAt = agent?.last_updated_at ?? wt.claude_updated_at;
  const needsAttention = agent?.status === 'blocked' || agent?.status === 'done' || agent?.status === 'error' || wt.claude === 'waiting';

  return (
    <div
      onClick={(e) => {
        if (e.metaKey) {
          // Cmd+click → focus VS Code window
          onFocusVSCode();
        } else {
          onOpen();
        }
      }}
      title={`Click to open terminal · Cmd+click to focus VS Code`}
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          8,
        padding:      '6px 12px 6px 0',
        cursor:       'pointer',
        borderLeft:   `3px solid ${isOpen ? wt.color : 'transparent'}`,
        paddingLeft:  9,
        background:   isOpen ? '#141414' : 'transparent',
        borderRadius: '0 4px 4px 0',
      }}
      onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = '#0f0f0f'; }}
      onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Ctrl+N shortcut badge */}
      {shortcutKey && (
        <span style={{
          flexShrink: 0, fontSize: 9, color: '#2a2a2a',
          background: '#1a1a1a', borderRadius: 3,
          padding: '1px 4px', fontVariantNumeric: 'tabular-nums',
        }}>
          ⌥{shortcutKey}
        </span>
      )}

      {/* Branch name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: isOpen ? 600 : 400,
          color: isOpen ? '#e2e2e2' : '#aaa',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {wt.branch}
        </div>
        {agent && agent.current_activity && agent.current_activity !== 'Starting...' && (
          <div style={{
            fontSize: 10, color: '#3a3a3a',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginTop: 1,
          }}>
            {agent.current_activity}
          </div>
        )}
      </div>

      {/* Git badges */}
      {(wt.git.dirty || wt.git.ahead > 0 || wt.git.behind > 0) && (
        <div style={{ display: 'flex', gap: 3, flexShrink: 0, fontSize: 10 }}>
          {wt.git.dirty  && <span style={{ color: '#f59e0b' }}>M</span>}
          {wt.git.ahead  > 0 && <span style={{ color: '#22c55e' }}>↑{wt.git.ahead}</span>}
          {wt.git.behind > 0 && <span style={{ color: '#ef4444' }}>↓{wt.git.behind}</span>}
        </div>
      )}

      {/* Status */}
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: statusColor, fontWeight: needsAttention ? 700 : 400 }}>
          {statusIcon}
        </div>
        {updatedAt && (
          <div style={{ fontSize: 9, color: '#2a2a2a' }}>{timeAgo(updatedAt)}</div>
        )}
      </div>

    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

interface Props {
  state:             DashState | null;
  connected:         boolean;
  focusingId:        string | null;
  openTerminalPaths: string[];
  onFocusStart:      (id: string) => void;
  onFocusDone:       () => void;
  onOpenTerminal:    (path: string) => void;
  colorOp:           null | 'apply' | 'clear';
  onApplyColors:     () => void;
  onClearColors:     () => void;
  isOpen:            boolean;
}

export default function Sidebar({
  state, connected, focusingId, openTerminalPaths,
  onFocusStart, onFocusDone, onOpenTerminal,
  colorOp, onApplyColors, onClearColors,
  isOpen,
}: Props) {
  const allWorktrees  = state?.repos.flatMap(r => r.worktrees) ?? [];
  const needAttention = allWorktrees.filter(w =>
    w.agent?.status === 'done' || w.agent?.status === 'blocked' ||
    w.agent?.status === 'error' || w.claude === 'waiting'
  );
  const working = allWorktrees.filter(w => w.claude === 'working' || w.agent?.status === 'running').length;
  const waiting = allWorktrees.filter(w => w.claude === 'waiting' || w.agent?.status === 'blocked').length;

  return (
    <div style={{
      width:         isOpen ? 300 : 0,
      flexShrink:    0,
      display:       'flex',
      flexDirection: 'column',
      background:    '#0a0a0a',
      borderRight:   isOpen ? '1px solid #1a1a1a' : 'none',
      overflow:      'hidden',
      // No animation — instant toggle, no reflow during resize
    }}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        padding:     '10px 12px 8px',
        borderBottom:'1px solid #1a1a1a',
        flexShrink:  0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#fff' }}>
            WORKTREE DASH
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: connected ? '#22c55e' : '#ef4444',
              display: 'inline-block',
            }} />
            <span style={{ fontSize: 10, color: connected ? '#22c55e' : '#ef4444' }}>
              {connected ? 'live' : 'reconnecting'}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#444' }}>
          <span>{allWorktrees.length} trees</span>
          {working > 0 && <span style={{ color: '#22c55e' }}>{working} working</span>}
          {waiting > 0 && <span style={{ color: '#f59e0b', fontWeight: 700 }}>{waiting} needs input</span>}
        </div>

        {/* Color buttons */}
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {(['clear', 'apply'] as const).map(op => (
            <button
              key={op}
              onClick={op === 'apply' ? onApplyColors : onClearColors}
              disabled={colorOp !== null}
              style={{
                flex: 1, fontSize: 10, padding: '3px 0', borderRadius: 3,
                cursor: colorOp ? 'not-allowed' : 'pointer',
                background: '#1a1a1a', border: '1px solid #222',
                color: colorOp === op ? '#888' : colorOp ? '#2a2a2a' : '#555',
              }}
            >
              {op === 'apply' && colorOp === 'apply' ? 'Applying…' :
               op === 'clear' && colorOp === 'clear' ? 'Clearing…' :
               op === 'apply' ? 'Apply colors' : 'Clear colors'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable content ──────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* Attention queue */}
        {needAttention.length > 0 && (
          <div style={{ padding: '8px 0 4px' }}>
            <AttentionQueue
              worktrees={needAttention}
              focusingId={focusingId}
              onFocusStart={onFocusStart}
              onFocusDone={onFocusDone}
            />
          </div>
        )}

        {/* Worktree list */}
        {state?.repos.map(repo => (
          <div key={repo.root} style={{ padding: '8px 0 4px' }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
              color: '#333', paddingLeft: 12, paddingBottom: 4,
            }}>
              {repo.repo.toUpperCase()}
            </div>
            {repo.worktrees.map(wt => {
              const flatIdx = allWorktrees.indexOf(wt);
              const shortcutKey = flatIdx >= 0 && flatIdx < 9 ? flatIdx + 1 : null;
              return (
              <SidebarRow
                key={wt.id}
                wt={wt}
                shortcutKey={shortcutKey}
                isOpen={openTerminalPaths.includes(wt.id)}
                onOpen={() => onOpenTerminal(wt.id)}
                onFocusVSCode={() => {
                  onFocusStart(wt.id);
                  fetch('/api/focus', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: wt.id }),
                  });
                  setTimeout(onFocusDone, 1500);
                }}
                focusingId={focusingId}
              />
              );
            })}
          </div>
        ))}
      </div>

    </div>
  );
}
