import { useState, useEffect, CSSProperties } from 'react';
import { OpenTerminal, WorktreeInfo } from '../types';
import TerminalView from './TerminalView';

interface Props {
  allWorktrees:      WorktreeInfo[];
  pendingOpen:       string | null;
  onPendingHandled:  () => void;
  restoreTerminals:  string[];
  onTerminalClosed:  (path: string) => void;
}

type ViewMode = 'split' | 'tabs';

let slotCounter = 0;
function newSlotId() { return `slot-${++slotCounter}`; }

function worktreeInfo(path: string, all: WorktreeInfo[]) {
  const wt = all.find(w => w.id === path);
  const parts = path.split('/');
  return {
    branch: wt?.branch ?? parts[parts.length - 1] ?? 'terminal',
    color:  wt?.color  ?? '#555',
  };
}

// ── Grid layout helpers ────────────────────────────────────────────────────

function gridStyle(count: number): CSSProperties {
  if (count <= 1) return { gridTemplateColumns: '1fr',     gridTemplateRows: '1fr' };
  if (count <= 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
  return              { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
}

function cellStyle(index: number, total: number): CSSProperties {
  // For 3 terminals: first takes left column, 2+3 stack on right
  if (total === 3 && index === 0) return { gridRow: 'span 2' };
  return {};
}

// ── Component ─────────────────────────────────────────────────────────────

export default function TerminalPane({
  allWorktrees, pendingOpen, onPendingHandled, restoreTerminals, onTerminalClosed,
}: Props) {
  const [terminals, setTerminals]   = useState<OpenTerminal[]>([]);
  const [viewMode, setViewMode]     = useState<ViewMode>('split');
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [restored, setRestored]     = useState(false);

  // Restore terminals from last session (once, on first render)
  useEffect(() => {
    if (restored || restoreTerminals.length === 0) return;
    setRestored(true);
    for (const path of restoreTerminals) openTerminal(path);
  }, [restoreTerminals]);

  // Handle sidebar click — open or focus terminal
  useEffect(() => {
    if (!pendingOpen) return;
    openTerminal(pendingOpen);
    onPendingHandled();
  }, [pendingOpen]);

  function openTerminal(worktree_path: string) {
    // Focus existing if already open
    const existing = terminals.find(t => t.worktree_path === worktree_path);
    if (existing) { setActiveSlot(existing.slotId); return; }

    const { branch, color } = worktreeInfo(worktree_path, allWorktrees);
    const slot: OpenTerminal = {
      slotId:       newSlotId(),
      worktree_path,
      terminal_id:  null,
      branch,
      color,
    };
    setTerminals(prev => [...prev, slot]);
    setActiveSlot(slot.slotId);
  }

  function closeTerminal(slotId: string) {
    setTerminals(prev => {
      const closing  = prev.find(t => t.slotId === slotId);
      const remaining = prev.filter(t => t.slotId !== slotId);
      if (activeSlot === slotId) {
        setActiveSlot(remaining[remaining.length - 1]?.slotId ?? null);
      }
      if (closing) onTerminalClosed(closing.worktree_path);
      return remaining;
    });
  }

  function handleTerminalReady(slotId: string, terminal_id: string) {
    setTerminals(prev => prev.map(t =>
      t.slotId === slotId ? { ...t, terminal_id } : t
    ));
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
          Click a worktree in the sidebar to open a terminal in that directory.
        </div>
      </div>
    );
  }

  // ── Tab view ─────────────────────────────────────────────────────────────
  const activeTerminal = terminals.find(t => t.slotId === activeSlot) ?? terminals[0]!;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d0d0d' }}>
      {/* Top bar: view toggle + tabs (tab mode) */}
      <div style={{
        display:       'flex',
        alignItems:    'center',
        height:        34,
        flexShrink:    0,
        borderBottom:  '1px solid #1e1e1e',
        background:    '#0f0f0f',
        gap:           4,
        paddingRight:  8,
      }}>
        {/* Tab mode: show tabs */}
        {viewMode === 'tabs' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 2, paddingLeft: 4 }}>
            {terminals.map(t => (
              <div
                key={t.slotId}
                onClick={() => setActiveSlot(t.slotId)}
                style={{
                  display:       'flex',
                  alignItems:    'center',
                  gap:           6,
                  padding:       '0 10px 0 0',
                  height:        34,
                  cursor:        'pointer',
                  borderBottom:  t.slotId === activeSlot ? `2px solid ${t.color}` : '2px solid transparent',
                  opacity:       t.slotId === activeSlot ? 1 : 0.5,
                  flexShrink:    0,
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
          <div style={{ flex: 1, paddingLeft: 10, fontSize: 11, color: '#333' }}>
            {terminals.length} terminal{terminals.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 2 }}>
          {(['split', 'tabs'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                fontSize:   11,
                padding:    '2px 8px',
                borderRadius: 3,
                cursor:     'pointer',
                border:     'none',
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
          flex:    1,
          display: 'grid',
          gap:     4,
          padding: 4,
          overflow:'hidden',
          ...gridStyle(terminals.length),
        }}>
          {terminals.map((t, i) => (
            <TerminalView
              key={t.slotId}
              worktreePath={t.worktree_path}
              branch={t.branch}
              color={t.color}
              isActive={t.slotId === activeSlot}
              style={cellStyle(i, terminals.length)}
              onTerminalReady={(tid) => handleTerminalReady(t.slotId, tid)}
              onClose={() => closeTerminal(t.slotId)}
              onClick={() => setActiveSlot(t.slotId)}
            />
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden', padding: 4 }}>
          {terminals.map(t => (
            <div
              key={t.slotId}
              style={{ display: t.slotId === activeTerminal.slotId ? 'block' : 'none', height: '100%' }}
            >
              <TerminalView
                worktreePath={t.worktree_path}
                branch={t.branch}
                color={t.color}
                isActive
                onTerminalReady={(tid) => handleTerminalReady(t.slotId, tid)}
                onClose={() => closeTerminal(t.slotId)}
                onClick={() => {}}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
