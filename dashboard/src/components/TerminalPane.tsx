import { useState, useEffect, useRef, CSSProperties } from 'react';
import { OpenTerminal, WorktreeInfo } from '../types';
import TerminalView from './TerminalView';

interface Props {
  allWorktrees:     WorktreeInfo[];
  pendingOpen:      string | null;
  onPendingHandled: () => void;
  restoreTerminals: string[];
  onTerminalClosed: (path: string) => void;
}

type ViewMode = 'split' | 'tabs';

let slotCounter = 0;
function newSlotId() { return `slot-${++slotCounter}`; }

function worktreeInfo(path: string, all: WorktreeInfo[]) {
  const wt = all.find(w => w.id === path);
  const parts = path.split('/');
  return {
    branch:       wt?.branch ?? parts[parts.length - 1] ?? 'terminal',
    color:        wt?.color  ?? '#555',
    lastActivity: wt?.agent?.current_activity ?? '',
    agentStatus:  wt?.agent?.status ?? null,
  };
}

export default function TerminalPane({
  allWorktrees, pendingOpen, onPendingHandled, restoreTerminals, onTerminalClosed,
}: Props) {
  const [terminals, setTerminals]   = useState<OpenTerminal[]>([]);
  const [viewMode, setViewMode]     = useState<ViewMode>('split');
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  /** The slot that is currently expanded (clicked to fill most space) */
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  /** Whether click-to-expand is enabled. Only available when 3+ terminals. */
  const [expandEnabled, setExpandEnabled] = useState(true);
  const [restored, setRestored]     = useState(false);
  const refitRef = useRef<Record<string, () => void>>({});

  // Restore terminals from last session once
  useEffect(() => {
    if (restored || restoreTerminals.length === 0) return;
    setRestored(true);
    restoreTerminals.forEach(path => openTerminal(path));
  }, [restoreTerminals]);

  useEffect(() => {
    if (!pendingOpen) return;
    openTerminal(pendingOpen);
    onPendingHandled();
  }, [pendingOpen]);

  function openTerminal(worktree_path: string) {
    const existing = terminals.find(t => t.worktree_path === worktree_path);
    if (existing) {
      setActiveSlot(existing.slotId);
      setExpandedSlot(existing.slotId);
      return;
    }
    const info  = worktreeInfo(worktree_path, allWorktrees);
    const slot: OpenTerminal = {
      slotId: newSlotId(), worktree_path,
      terminal_id: null,
      branch: info.branch, color: info.color,
    };
    setTerminals(prev => [...prev, slot]);
    setActiveSlot(slot.slotId);
    // Don't auto-expand on open — let the user click to expand
  }

  function closeTerminal(slotId: string) {
    setTerminals(prev => {
      const closing   = prev.find(t => t.slotId === slotId);
      const remaining = prev.filter(t => t.slotId !== slotId);
      if (activeSlot  === slotId) setActiveSlot(remaining[remaining.length - 1]?.slotId ?? null);
      if (expandedSlot === slotId) setExpandedSlot(null);
      if (closing) onTerminalClosed(closing.worktree_path);
      return remaining;
    });
  }

  function handleTerminalReady(slotId: string, terminal_id: string) {
    setTerminals(prev => prev.map(t =>
      t.slotId === slotId ? { ...t, terminal_id } : t
    ));
  }

  // Expand is only meaningful when 3+ terminals and enabled
  const canExpand = terminals.length > 2 && expandEnabled && viewMode === 'split';

  function handleTerminalClick(slotId: string) {
    setActiveSlot(slotId);
    if (!canExpand) return;

    if (expandedSlot === slotId) {
      setExpandedSlot(null);
    } else {
      setExpandedSlot(slotId);
      setTimeout(() => refitRef.current[slotId]?.(), 220);
    }
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (terminals.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#0d0d0d', gap: 16, color: '#333',
      }}>
        <div style={{ fontSize: 32 }}>⌨</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No terminals open</div>
        <div style={{ fontSize: 12, color: '#2a2a2a', textAlign: 'center', maxWidth: 280 }}>
          Click a worktree in the sidebar to open a shell in that directory.
        </div>
      </div>
    );
  }

  const activeTerminal = terminals.find(t => t.slotId === activeSlot) ?? terminals[0]!;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d0d0d' }}>

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', height: 34, flexShrink: 0,
        borderBottom: '1px solid #1e1e1e', background: '#0f0f0f', gap: 4, paddingRight: 8,
      }}>
        {/* Tabs mode tab bar */}
        {viewMode === 'tabs' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 2, paddingLeft: 4 }}>
            {terminals.map(t => (
              <div
                key={t.slotId}
                onClick={() => setActiveSlot(t.slotId)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '0 10px 0 0', height: 34, cursor: 'pointer', flexShrink: 0,
                  borderBottom: t.slotId === activeSlot ? `2px solid ${t.color}` : '2px solid transparent',
                  opacity: t.slotId === activeSlot ? 1 : 0.5,
                }}
              >
                <div style={{ width: 2, background: t.color, height: 16, borderRadius: 1, marginLeft: 4 }} />
                <span style={{ fontSize: 12, color: '#aaa', whiteSpace: 'nowrap' }}>{t.branch}</span>
                <button
                  onClick={e => { e.stopPropagation(); closeTerminal(t.slotId); }}
                  style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#888'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#444'; }}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {viewMode === 'split' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: 10, gap: 10 }}>
            <span style={{ fontSize: 11, color: '#333' }}>
              {terminals.length} terminal{terminals.length !== 1 ? 's' : ''}
            </span>
            {/* Expand toggle — only shown when 3+ terminals */}
            {terminals.length > 2 && (
              <button
                onClick={() => { setExpandEnabled(p => !p); setExpandedSlot(null); }}
                title={expandEnabled ? 'Disable click-to-expand' : 'Enable click-to-expand (click any terminal to fill the pane)'}
                style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 3,
                  cursor: 'pointer', border: 'none',
                  background: expandEnabled ? '#22c55e22' : '#1e1e1e',
                  color:      expandEnabled ? '#22c55e'   : '#444',
                }}
              >
                {expandEnabled ? '⊕ expand on' : '⊕ expand off'}
              </button>
            )}
            {canExpand && expandedSlot && (
              <span style={{ fontSize: 10, color: '#444' }}>click expanded terminal to restore</span>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 2 }}>
          {(['split', 'tabs'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => { setViewMode(mode); setExpandedSlot(null); }}
              style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                border: 'none',
                background: viewMode === mode ? '#2a2a2a' : 'transparent',
                color:      viewMode === mode ? '#ccc'    : '#444',
              }}
            >
              {mode === 'split' ? '⊞ Split' : '⊟ Tabs'}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal area */}
      {viewMode === 'split' ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'row',
          gap: 4, padding: 4, overflow: 'hidden',
        }}>
          {terminals.map(t => {
            const isExpanded  = canExpand && expandedSlot === t.slotId;
            const isMinimized = canExpand && expandedSlot !== null && expandedSlot !== t.slotId;
            const info        = worktreeInfo(t.worktree_path, allWorktrees);

            return (
              <div
                key={t.slotId}
                style={{
                  // Expand/minimize using flex — no resize during transition
                  flex:       isMinimized ? '0 0 180px' : '1 1 0',
                  minWidth:   0,
                  overflow:   'hidden',
                  transition: 'flex 0.2s ease',
                }}
              >
                <TerminalView
                  worktreePath={t.worktree_path}
                  branch={t.branch}
                  color={t.color}
                  isActive={t.slotId === activeSlot}
                  isMinimized={isMinimized}
                  lastActivity={info.lastActivity}
                  onTerminalReady={(tid) => handleTerminalReady(t.slotId, tid)}
                  onClose={() => closeTerminal(t.slotId)}
                  onClick={() => handleTerminalClick(t.slotId)}
                  registerRefit={(fn) => { refitRef.current[t.slotId] = fn; }}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden', padding: 4 }}>
          {terminals.map(t => (
            <div key={t.slotId} style={{ display: t.slotId === activeTerminal.slotId ? 'block' : 'none', height: '100%' }}>
              <TerminalView
                worktreePath={t.worktree_path}
                branch={t.branch}
                color={t.color}
                isActive isMinimized={false} lastActivity=""
                onTerminalReady={(tid) => handleTerminalReady(t.slotId, tid)}
                onClose={() => closeTerminal(t.slotId)}
                onClick={() => {}}
                registerRefit={(fn) => { refitRef.current[t.slotId] = fn; }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
