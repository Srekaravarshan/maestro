import { SERVER_URL } from './config.js';
import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import { DashState, WorktreeInfo } from './types';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { type AgentStatus, getWorktreeStatus, worstStatus, STATUS_DOT, bucket } from './status';
import { setPinned, resumeCommand, reorderPins } from './actions';
import { ParkedIdeas, type QueueItem } from './ParkedIdeas';

type DragHandlers = {
  draggable: true;
  onDragStart: (e: ReactDragEvent) => void;
  onDragEnter: (e: ReactDragEvent) => void;
  onDragOver: (e: ReactDragEvent) => void;
  onDrop: () => void;
};

// ── WorktreeRow ───────────────────────────────────────────────────────────────

function WorktreeRow({ wt, onOpen, onTogglePin, onCopyResume, copied, queue, onQueueChange, dragHandlers }: {
  wt: WorktreeInfo; onOpen: () => void; onTogglePin: () => void; onCopyResume: () => void; copied: boolean;
  queue: QueueItem[]; onQueueChange: (all: QueueItem[]) => void; dragHandlers?: DragHandlers;
}) {
  const [hovered, setHovered]     = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const status   = getWorktreeStatus(wt);
  const dot      = STATUS_DOT[status];
  const folder   = wt.id.split('/').pop() || wt.branch || wt.id;
  const sub      = [wt.repoName, wt.branch].filter(Boolean).join(' · ');
  const activity = wt.agent?.current_activity || wt.title || '';
  const needsAttention = status === 'waiting' || status === 'blocked' || status === 'error';
  const ideas    = queue.filter(q => q.cwd === wt.id);

  const iconBtn = (onClick: (e: ReactMouseEvent) => void, title: string, color: string, children: ReactNode) => (
    <span onClick={(e) => { e.stopPropagation(); onClick(e); }} title={title}
      style={{ cursor: 'pointer', color, fontSize: 12, flexShrink: 0, lineHeight: 1, padding: '0 1px' }}>
      {children}
    </span>
  );

  return (
    <div {...(dragHandlers ?? {})}>
      <div
        onClick={onOpen}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '8px 12px', cursor: dragHandlers ? 'grab' : 'pointer',
          background: hovered ? '#1e1e1e' : needsAttention ? 'rgba(245,158,11,0.05)' : 'transparent',
          borderBottom: ideasOpen ? 'none' : '1px solid #161616', transition: 'background 0.1s',
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot.color, flexShrink: 0,
          animation: dot.pulse ? 'pulse 2s ease-in-out infinite' : 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }} title={`${wt.id}${activity ? '\n' + activity : ''}`}>
          <div style={{ fontWeight: 500, fontSize: 13, color: '#e0e0e0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {folder}
            {wt.pooled && <span style={{ fontSize: 9, color: '#555', marginLeft: 6, letterSpacing: 0.3 }}>pooled</span>}
          </div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activity || sub}
          </div>
        </div>

        {/* Park-idea toggle — shows count when it has ideas */}
        {(ideas.length > 0 || hovered) &&
          iconBtn(() => setIdeasOpen(o => !o), 'Park an idea for this worktree',
            ideas.length > 0 ? '#f59e0b' : '#555', ideas.length > 0 ? `▤ ${ideas.length}` : '▤')}
        {/* Resume-copy — on hover */}
        {hovered && iconBtn(onCopyResume, 'Copy resume command', copied ? '#22c55e' : '#666', copied ? '✓' : '⤾')}
        {/* Pin toggle — always when pinned, else on hover */}
        {(wt.pinned || hovered) && iconBtn(onTogglePin, wt.pinned ? 'Unpin' : 'Pin', wt.pinned ? '#f59e0b' : '#555', wt.pinned ? '★' : '☆')}

        <div style={{ fontSize: 10, color: dot.color, opacity: 0.85, flexShrink: 0, letterSpacing: 0.3 }}>
          {dot.label}
        </div>
      </div>

      {ideasOpen && <ParkedIdeas cwd={wt.id} items={ideas} onChange={onQueueChange} />}
    </div>
  );
}

// ── Section header ──────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '6px 12px 3px', fontSize: 9.5, color: '#555', letterSpacing: 0.6, textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState]         = useState<DashState | null>(null);
  const [connected, setConnected] = useState(false);
  const prevTrayRef               = useRef<string>('idle');
  // Track each worktree's previous status so we only notify on transitions
  const prevStatusesRef           = useRef<Record<string, AgentStatus>>({});

  // Parked ideas — global store, each item tagged with a worktree cwd
  const [queue, setQueue]         = useState<QueueItem[]>([]);

  // SSE connection to Maestro server
  useEffect(() => {
    let es: EventSource;
    let retry: ReturnType<typeof setTimeout>;
    function connect() {
      es = new EventSource(`${SERVER_URL}/events`);
      es.addEventListener('state', (e) => {
        setState(JSON.parse(e.data) as DashState);
        setConnected(true);
      });
      es.onerror = () => {
        setConnected(false);
        es.close();
        retry = setTimeout(connect, 3000);
      };
    }
    connect();
    return () => { es?.close(); clearTimeout(retry); };
  }, []);

  // Request macOS notification permission once on startup
  useEffect(() => {
    isPermissionGranted()
      .then(granted => { if (!granted) requestPermission().catch(() => {}); })
      .catch(() => {});
  }, []);

  // Update tray icon + fire notifications on status transitions
  useEffect(() => {
    const all  = state?.repos.flatMap(r => r.worktrees) ?? [];
    const prev = prevStatusesRef.current;

    // Collect transitions before updating the ref
    const transitions: { wt: WorktreeInfo; from: AgentStatus; to: AgentStatus }[] = [];
    const next: Record<string, AgentStatus> = {};
    for (const wt of all) {
      const to  = getWorktreeStatus(wt);
      next[wt.id] = to;
      const from = prev[wt.id];
      if (from !== undefined && from !== to) {
        transitions.push({ wt, from, to });
      }
    }
    prevStatusesRef.current = next;

    // Update tray icon
    const tray = worstStatus(all.map(getWorktreeStatus));
    if (tray !== prevTrayRef.current) {
      prevTrayRef.current = tray;
      invoke('set_tray_status', { status: tray }).catch(() => {});
    }

    // Fire native notifications for interesting transitions
    if (transitions.length > 0) {
      isPermissionGranted().then(granted => {
        if (!granted) return;
        for (const { wt, to } of transitions) {
          const branch = wt.branch || wt.id.split('/').pop() || wt.id;
          // sendNotification returns void in plugin-notification v2 — no .catch()
          if (to === 'waiting' || to === 'blocked') {
            sendNotification({
              title: '⚠ Needs input',
              body: `${branch}: ${wt.agent?.question || 'Claude is waiting for you'}`,
            });
          } else if (to === 'done') {
            sendNotification({
              title: '✓ Done',
              body: `${branch}: ${wt.agent?.summary || 'Task completed'}`,
            });
          } else if (to === 'error') {
            sendNotification({
              title: '✗ Error',
              body: `${branch}: ${wt.agent?.error_msg || 'An error occurred'}`,
            });
          }
        }
      }).catch(() => {});
    }
  }, [state]);

  // Escape: if an input is focused (e.g. a park-idea box), blur it; else hide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && el.tagName === 'INPUT') { el.blur(); return; }
      invoke('hide_window').catch(() => {});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load parked ideas on mount
  useEffect(() => {
    invoke<QueueItem[]>('get_queue').then(setQueue).catch(() => {});
  }, []);

  // Resize window to exactly fit popup content — eliminates any gap below.
  // Uses offsetHeight (includes border) so the window matches the card exactly.
  // The window starts at 600px hidden so content lays out at full natural
  // height before the first measurement fires.
  useEffect(() => {
    const el = document.getElementById('maestro-popup');
    if (!el) return;
    const sync = () => {
      const h = el.offsetHeight;
      if (h > 10) getCurrentWindow().setSize(new LogicalSize(320, h)).catch(() => {});
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync(); // fire immediately — element may already be laid out
    return () => ro.disconnect();
  }, []);

  const allWorktrees = state?.repos.flatMap(r => r.worktrees) ?? [];

  // ── Tiering + row actions ───────────────────────────────────────────────
  const [showOther, setShowOther]       = useState(false);
  const [copiedResume, setCopiedResume] = useState<string | null>(null);
  const { pinned, active, other } = bucket(allWorktrees);

  const openWt    = (wt: WorktreeInfo) => { invoke('open_worktree', { worktreePath: wt.id, host: wt.host }).catch(() => {}); invoke('hide_window').catch(() => {}); };
  const togglePin = (wt: WorktreeInfo) => { setPinned(wt.id, !wt.pinned); };
  const copyResume = (wt: WorktreeInfo) => {
    navigator.clipboard.writeText(resumeCommand(wt)).then(() => {
      setCopiedResume(wt.id); setTimeout(() => setCopiedResume(null), 1500);
    }).catch(() => {});
  };
  const renderRow = (wt: WorktreeInfo, dragHandlers?: DragHandlers) => (
    <WorktreeRow key={wt.id} wt={wt}
      onOpen={() => openWt(wt)} onTogglePin={() => togglePin(wt)}
      onCopyResume={() => copyResume(wt)} copied={copiedResume === wt.id}
      queue={queue} onQueueChange={setQueue} dragHandlers={dragHandlers} />
  );

  // Drag-to-reorder within the Pinned section (persists new priority order)
  const dragIndexRef = useRef<number | null>(null);
  const pinnedDrag = (i: number): DragHandlers => ({
    draggable: true,
    onDragStart: (e) => { dragIndexRef.current = i; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* noop */ } },
    onDragEnter: (e) => e.preventDefault(),
    onDragOver:  (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    onDrop: () => {
      const from = dragIndexRef.current;
      dragIndexRef.current = null;
      if (from == null || from === i) return;
      const ids = pinned.map(w => w.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(i, 0, moved);
      reorderPins(ids);
    },
  });

  return (
    <div id="maestro-popup" style={{
      width: 320,
      background: '#111',
      borderRadius: 12,
      border: '1px solid #2a2a2a',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
      fontSize: 13,
      color: '#e0e0e0',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      userSelect: 'none',
    }}>
      {/* animation keyframes */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px 9px',
        borderBottom: '1px solid #1e1e1e',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#fff', letterSpacing: 0.2 }}>
          Maestro
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: connected ? '#22c55e' : '#444',
            display: 'inline-block',
          }} />
          <span style={{ color: connected ? '#22c55e' : '#555' }}>
            {connected ? 'connected' : 'reconnecting…'}
          </span>
        </span>
      </div>

      {/* Worktree list — pinned + active by default, rest behind search */}
      <div style={{ overflowY: 'auto', maxHeight: 360 }}>
        {allWorktrees.length === 0 ? (
          <div style={{ padding: '28px 14px', color: '#555', fontSize: 12, textAlign: 'center' }}>
            {connected ? 'No Claude sessions found' : 'Waiting for server…'}
          </div>
        ) : (
          <>
            {pinned.length > 0 && (<><SectionLabel>Pinned</SectionLabel>{pinned.map((wt, i) => renderRow(wt, pinnedDrag(i)))}</>)}
            {active.length > 0 && (<><SectionLabel>Active</SectionLabel>{active.map(wt => renderRow(wt))}</>)}
            {pinned.length === 0 && active.length === 0 && (
              <div style={{ padding: '18px 14px', color: '#555', fontSize: 11, textAlign: 'center' }}>
                Nothing active right now — search below
              </div>
            )}
            {other.length > 0 && (
              <div style={{ borderTop: '1px solid #1a1a1a' }}>
                <div
                  onClick={() => setShowOther(v => !v)}
                  style={{ cursor: 'pointer', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6, color: '#777', fontSize: 11 }}
                >
                  <span style={{ fontSize: 9, width: 8 }}>{showOther ? '▾' : '▸'}</span>
                  {other.length} more session{other.length > 1 ? 's' : ''}
                </div>
                {showOther && other.map(wt => renderRow(wt))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '6px 14px',
        borderTop: '1px solid #1a1a1a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: '#444' }}>esc to close · ▤ to park an idea</span>
        <span style={{ fontSize: 11, color: '#333' }}>
          {allWorktrees.length} wt
        </span>
      </div>
    </div>
  );
}
