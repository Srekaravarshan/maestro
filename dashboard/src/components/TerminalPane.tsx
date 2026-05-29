import { useState, useEffect, useRef, CSSProperties } from 'react';
import { OpenTerminal, WorktreeInfo } from '../types';
import TerminalView from './TerminalView';

interface Props {
  allWorktrees:     WorktreeInfo[];
  pendingOpen:      string | null;
  onPendingHandled: () => void;
  restoreTerminals: string[];
  onTerminalClosed: (path: string) => void;
  sidebarOpen:      boolean;
  onToggleSidebar:  () => void;
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
  sidebarOpen, onToggleSidebar,
}: Props) {
  const [terminals, setTerminals]   = useState<OpenTerminal[]>([]);
  const [viewMode, setViewMode]     = useState<ViewMode>('split');
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  // Default OFF — user opts in via Cmd+E or the button
  const [expandEnabled, setExpandEnabled] = useState(false);
  const [restored, setRestored]     = useState(false);
  const refitRef  = useRef<Record<string, () => void>>({});
  const focusRef  = useRef<Record<string, () => void>>({});

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.metaKey) return;

      // Cmd+E — toggle expand mode (only meaningful with 3+ terminals)
      if (e.key === 'e') {
        e.preventDefault();
        setExpandEnabled(p => !p);
        setExpandedSlot(null);
        return;
      }

      // Cmd+1-9 — switch to the Nth open terminal by position
      if (!e.ctrlKey) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 9) {
          const slot = terminals[n - 1];
          if (slot) { e.preventDefault(); activateSlot(slot.slotId); }
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allWorktrees, terminals]);

  // Restore terminals from last session once
  useEffect(() => {
    if (restored || restoreTerminals.length === 0) return;
    setRestored(true);
    restoreTerminals.forEach(path => openTerminalByPath(path));
  }, [restoreTerminals]);

  useEffect(() => {
    if (!pendingOpen) return;
    openTerminalByPath(pendingOpen);
    onPendingHandled();
  }, [pendingOpen]);

  function activateSlot(slotId: string) {
    setActiveSlot(slotId);

    // Expand if mode is on — same behaviour whether triggered by direct click,
    // sidebar click, or Cmd+N
    if (expandEnabled && viewMode === 'split') {
      setExpandedSlot(slotId);
      setTimeout(() => refitRef.current[slotId]?.(), 220);
    }

    // Steal keyboard focus after a short paint delay
    setTimeout(() => focusRef.current[slotId]?.(), 50);
  }

  function openTerminalByPath(worktree_path: string) {
    const existing = terminals.find(t => t.worktree_path === worktree_path);
    if (existing) {
      activateSlot(existing.slotId);
      return;
    }
    const info = worktreeInfo(worktree_path, allWorktrees);
    const slot: OpenTerminal = {
      slotId: newSlotId(), worktree_path,
      terminal_id: null,
      branch: info.branch, color: info.color,
    };
    setTerminals(prev => [...prev, slot]);
    setActiveSlot(slot.slotId);
    // Expand + focus fires in handleTerminalReady once the PTY is ready
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
    // New terminal just became ready — activate it (expand + focus)
    activateSlot(slotId);
  }

  // Expand is only meaningful when 3+ terminals and enabled
  const canExpand = terminals.length > 2 && expandEnabled && viewMode === 'split';

  function handleTerminalClick(slotId: string) {
    if (canExpand && expandedSlot === slotId) {
      // Click the already-expanded terminal → collapse back to equal
      setExpandedSlot(null);
      setActiveSlot(slotId);
      setTimeout(() => focusRef.current[slotId]?.(), 50);
    } else {
      // Same path as sidebar + Cmd+N: expand + focus
      activateSlot(slotId);
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
        {/* Sidebar toggle — top left like Warp. Cmd+B also works. */}
        <button
          onClick={onToggleSidebar}
          title={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (⌘B)`}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: sidebarOpen ? '#555' : '#333',
            fontSize: 14, padding: '0 10px', height: 34,
            display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#aaa'; }}
          onMouseLeave={e => { e.currentTarget.style.color = sidebarOpen ? '#555' : '#333'; }}
        >
          ☰
        </button>
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
          {terminals.map((t, i) => {
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
                  position={i + 1}
                  isActive={t.slotId === activeSlot}
                  isMinimized={isMinimized}
                  lastActivity={info.lastActivity}
                  onTerminalReady={(tid) => handleTerminalReady(t.slotId, tid)}
                  onClose={() => closeTerminal(t.slotId)}
                  onClick={() => handleTerminalClick(t.slotId)}
                  registerRefit={(fn) => { refitRef.current[t.slotId] = fn; }}
                  registerFocus={(fn) => { focusRef.current[t.slotId] = fn; }}
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
                position={terminals.indexOf(t) + 1}
                isActive isMinimized={false} lastActivity=""
                onTerminalReady={(tid) => handleTerminalReady(t.slotId, tid)}
                onClose={() => closeTerminal(t.slotId)}
                onClick={() => activateSlot(t.slotId)}
                registerRefit={(fn) => { refitRef.current[t.slotId] = fn; }}
                registerFocus={(fn) => { focusRef.current[t.slotId] = fn; }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
