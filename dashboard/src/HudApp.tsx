import { SERVER_URL } from './config.js';
import { useState, useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent } from 'react';
import { DashState, WorktreeInfo } from './types';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi';
import { type AgentStatus, getWorktreeStatus, bucket } from './status';
import { setPinned, resumeCommand, setPins } from './actions';
import { type QueueItem } from './ParkedIdeas';

// ── Console design tokens ─────────────────────────────────────────────────────
const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';

interface ScreenInfo { width: number; height: number; scale: number; notch: boolean; originX: number; originY: number; }
type Mode = 'collapsed' | 'attention' | 'expanded';
type DragHandlers = { draggable: true; onDragStart: (e: ReactDragEvent) => void; onDragEnter: (e: ReactDragEvent) => void; onDragOver: (e: ReactDragEvent) => void; onDrop: (e: ReactDragEvent) => void; onDragEnd: () => void; };

const HUD_PILL_W = 200;
const ANIM_MS    = 260;
const ATTENTION_MS = 3000;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// Status → short code + rail color (never icon-only; word + hue = color-blind safe)
const STATUS: Record<AgentStatus, { short: string; color: string; phrase: string }> = {
  working: { short: 'WORK',  color: 'oklch(0.70 0.14 245)', phrase: 'working' },
  waiting: { short: 'BLOCK', color: 'oklch(0.83 0.15 80)',  phrase: 'input needed' },
  blocked: { short: 'BLOCK', color: 'oklch(0.83 0.15 80)',  phrase: 'input needed' },
  done:    { short: 'DONE',  color: 'oklch(0.76 0.15 150)', phrase: 'done' },
  error:   { short: 'ERR',   color: 'oklch(0.67 0.20 25)',  phrase: 'failed' },
  idle:    { short: 'IDLE',  color: 'oklch(0.70 0.02 260)', phrase: 'idle' },
};

const HOST_LABEL: Record<string, string> = {
  vscode: 'VS Code', app: 'Claude', iterm: 'iTerm', terminal: 'Terminal', tmux: 'tmux',
};

const sectionLabel: CSSProperties = {
  fontSize: 10.5, letterSpacing: '0.09em', color: 'oklch(0.62 0.01 265)',
  padding: '16px 20px 8px', background: 'oklch(0.14 0.01 230 / 0.4)',
};

const stop = (e: ReactMouseEvent) => e.stopPropagation();
const alpha = (oklch: string, a: number) => oklch.replace(')', ` / ${a})`);

const CopyIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="oklch(0.76 0.15 150)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const PinIcon = ({ filled }: { filled: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);
const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H2v6h4l5 4z" />
    {muted
      ? <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
      : <path d="M15.5 8.5a5 5 0 0 1 0 7" />}
  </svg>
);

// ── Ideas accordion (Console) ──────────────────────────────────────────────────
function ConsoleIdeas({ cwd, items, onChange, draft, onDraft }: {
  cwd: string; items: QueueItem[]; onChange: (all: QueueItem[]) => void;
  draft: string; onDraft: (text: string) => void;   // lifted to the parent so it survives collapse
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []); // focus the input as the accordion opens
  const add = () => {
    const t = draft.trim(); if (!t) return;
    invoke<QueueItem[]>('add_to_queue', { text: t, cwd }).then(onChange).catch(() => {});
    onDraft('');
  };
  const remove = (id: string) => invoke<QueueItem[]>('remove_from_queue', { id }).then(onChange).catch(() => {});
  const copy = (it: QueueItem) => navigator.clipboard.writeText(it.text).then(() => {
    setCopiedId(it.id); setTimeout(() => setCopiedId(null), 1200);
  }).catch(() => {});

  return (
    <div onClick={stop} style={{ padding: '12px 20px 16px 30px', background: 'oklch(0.14 0.01 230 / 0.6)', borderBottom: '1px solid oklch(0.5 0.01 230 / 0.08)' }}>
      <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {items.length === 0 && <div style={{ fontSize: 11.5, color: 'oklch(0.6 0.01 265)', padding: '6px 12px', fontStyle: 'italic' }}>no ideas parked</div>}
        {items.map(it => (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => copy(it)} title="Click to copy"
              style={{ all: 'unset', boxSizing: 'border-box', flex: '1 1 auto', minWidth: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, borderLeft: '2px solid oklch(0.5 0.01 230 / 0.4)', background: 'oklch(0.1 0.01 230 / 0.5)' }}>
              <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12, lineHeight: 1.45, color: 'oklch(0.84 0.006 265)', fontFamily: MONO }}>{it.text}</span>
              <span style={{ flex: '0 0 auto', fontSize: 10, fontWeight: 700, color: copiedId === it.id ? 'oklch(0.76 0.15 150)' : 'oklch(0.62 0.01 265)' }}>{copiedId === it.id ? 'Copied' : 'Copy'}</span>
            </button>
            <button onClick={() => remove(it.id)} title="Remove idea"
              style={{ all: 'unset', flex: '0 0 auto', cursor: 'pointer', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, color: 'oklch(0.66 0.01 265)', fontSize: 15 }}>×</button>
          </div>
        ))}
      </div>
      <input ref={inputRef} value={draft} onClick={stop} onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); add(); } }}
        placeholder="park idea… ↵ add"
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 7, border: '1px solid oklch(0.72 0.14 245 / 0.5)', background: 'oklch(0.1 0.01 230 / 0.7)', color: 'oklch(0.95 0.004 265)', outline: 'none', fontSize: 12, fontFamily: MONO }} />
    </div>
  );
}

// ── Row (Console) ────────────────────────────────────────────────────────────────
function HudRow({ wt, onOpen, onTogglePin, onCopyResume, copied, queue, onQueueChange, dragHandlers, draft, onDraft, selected }: {
  wt: WorktreeInfo; onOpen: () => void; onTogglePin: () => void; onCopyResume: () => void; copied: boolean;
  queue: QueueItem[]; onQueueChange: (all: QueueItem[]) => void; dragHandlers?: DragHandlers;
  draft: string; onDraft: (text: string) => void; selected?: boolean;
}) {
  const [hover, setHover]         = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const status   = getWorktreeStatus(wt);
  const meta     = STATUS[status];
  const folder   = wt.id.split('/').pop() || wt.branch || wt.id;
  const activity = wt.agent?.current_activity || wt.title || '';
  const meta2    = [wt.repoName, wt.branch].filter(Boolean).join(':');
  const ideas    = queue.filter(q => q.cwd === wt.id);

  const c = meta.color;
  const rowBg = ideasOpen ? 'oklch(0.6 0.01 230 / 0.08)' : 'transparent';
  const rail  = `linear-gradient(90deg, ${alpha(c, 0.24)} 0, ${alpha(c, 0.08)} 40px, ${alpha(c, 0.02)} 120px, transparent 200px), ${rowBg}`;
  const ideaLabel = ideas.length > 0 ? `${ideas.length} idea${ideas.length > 1 ? 's' : ''}` : '+ idea';

  return (
    <div {...(dragHandlers ?? {})}>
      <div
        onClick={onOpen}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 20px',
          cursor: dragHandlers ? 'grab' : 'pointer',
          borderBottom: ideasOpen ? 'none' : '1px solid oklch(0.5 0.01 230 / 0.08)',
          background: rail,
          boxShadow: (hover || selected) ? 'inset 0 0 0 999px oklch(0.72 0.04 245 / 0.12)' : 'none',
          transition: 'box-shadow 0.14s',
        }}
      >
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Line 1 — folder · eph · copy */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={wt.id}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'oklch(0.96 0.004 265)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{folder}</span>
            {wt.host && <span title={`Runs in ${HOST_LABEL[wt.host] || wt.host}`} style={{ flex: '0 0 auto', fontSize: 9, padding: '1px 6px', borderRadius: 5, background: 'oklch(0.5 0.01 230 / 0.16)', color: 'oklch(0.62 0.01 265)' }}>{HOST_LABEL[wt.host] || wt.host}</span>}
            {wt.pooled && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 5, background: 'oklch(0.5 0.01 230 / 0.2)', color: 'oklch(0.66 0.01 265)' }}>eph</span>}
            <button onClick={(e) => { stop(e); onCopyResume(); }} title="Copy resume command"
              style={{ all: 'unset', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 5, color: 'oklch(0.7 0.008 265)', cursor: 'pointer', opacity: hover ? 1 : 0, transition: 'opacity 0.14s' }}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
          {/* Line 2 — repo:branch · activity · ideas toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12, color: 'oklch(0.70 0.008 265)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {meta2 || folder}{activity ? <> · <span style={{ color: 'oklch(0.78 0.008 265)' }}>{activity}</span></> : null}
            </span>
            <button onClick={(e) => { stop(e); setIdeasOpen(o => !o); }}
              style={{ all: 'unset', flex: '0 0 auto', cursor: 'pointer', fontSize: 10.5, color: ideas.length > 0 ? 'oklch(0.83 0.12 80)' : 'oklch(0.66 0.01 265)', padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>{ideaLabel}</button>
          </div>
        </div>
        {/* Right — pin icon (top) + status short-code */}
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <button onClick={(e) => { stop(e); onTogglePin(); }} title={wt.pinned ? 'Unpin' : 'Pin'}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, color: wt.pinned ? 'oklch(0.8 0.12 150)' : 'oklch(0.58 0.01 265)' }}>
            <PinIcon filled={!!wt.pinned} />
          </button>
          <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, width: 52, textAlign: 'right' }}>{meta.short}</span>
        </div>
      </div>
      {ideasOpen && <ConsoleIdeas cwd={wt.id} items={ideas} onChange={onQueueChange} draft={draft} onDraft={onDraft} />}
    </div>
  );
}

// ── Main HUD ──────────────────────────────────────────────────────────────────────
export default function HudApp() {
  const [state, setState]         = useState<DashState | null>(null);
  const [connected, setConnected] = useState(false);
  const [mode, setMode]           = useState<Mode>('collapsed');
  const [attention, setAttention] = useState<{ id: string; folder: string; status: AgentStatus; time: string; host?: string } | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [copiedResume, setCopiedResume] = useState<string | null>(null);
  const [queue, setQueue]         = useState<QueueItem[]>([]);
  const [muted, setMuted]         = useState(() => { try { return localStorage.getItem('hud.muted') === '1'; } catch { return false; } });
  const mutedRef = useRef(muted);
  // Unsent idea drafts, keyed by worktree — lifted here (and mirrored to
  // localStorage) so nothing is lost when the pill collapses or the app restarts.
  const [drafts, setDrafts] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem('hud.drafts') || '{}'); } catch { return {}; } });
  const setDraft = (cwd: string, text: string) => setDrafts(d => {
    const n = { ...d, [cwd]: text };
    if (!text) delete n[cwd];
    try { localStorage.setItem('hud.drafts', JSON.stringify(n)); } catch { /* noop */ }
    return n;
  });

  const prevStatusesRef = useRef<Record<string, AgentStatus>>({});
  const attnTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef       = useRef<ScreenInfo | null>(null);
  const curDims         = useRef({ w: HUD_PILL_W, h: 32 });
  const rafRef          = useRef<number | null>(null);
  const modeRef         = useRef<Mode>('collapsed');
  const customRef       = useRef<{ cx: number; y: number } | null>(null);
  const firstGeomRef    = useRef(true);
  const dragCwdRef      = useRef<string | null>(null);
  const [selIdx, setSelIdx] = useState(0);   // keyboard row selection
  const selIdxRef       = useRef(0);
  const visibleRef      = useRef<WorktreeInfo[]>([]);

  const allWorktrees = state?.repos.flatMap(r => r.worktrees) ?? [];
  const { pinned, active, other } = bucket(allWorktrees);

  // Collapsed segmented counts (by status)
  let nWork = 0, nBlock = 0, nDone = 0, nErr = 0;
  for (const wt of allWorktrees) {
    const s = getWorktreeStatus(wt);
    if (s === 'working') nWork++;
    else if (s === 'waiting' || s === 'blocked') nBlock++;
    else if (s === 'done') nDone++;
    else if (s === 'error') nErr++;
  }
  const segments: { text: string; n?: number; unit?: string; color: string }[] = [];
  if (nWork)  segments.push({ n: nWork,  unit: 'wk',    text: `${nWork} wk`,    color: 'oklch(0.70 0.14 245)' });
  if (nBlock) segments.push({ n: nBlock, unit: 'block', text: `${nBlock} block`, color: 'oklch(0.83 0.15 80)' });
  if (nErr)   segments.push({ n: nErr,   unit: 'err',   text: `${nErr} err`,    color: 'oklch(0.67 0.20 25)' });
  if (nDone)  segments.push({ n: nDone,  unit: 'done',  text: `${nDone} done`,  color: 'oklch(0.76 0.15 150)' });
  if (segments.length === 0) segments.push({ text: 'idle', color: 'oklch(0.66 0.01 265)' });

  const collapsedW = Math.min(Math.max(
    Math.round(30 + segments.reduce((a, s) => a + 24 + s.text.length * 7.4, 0) + 6), 96), 340);
  const dims = mode === 'expanded' ? { w: 380, h: 480 }
             : mode === 'attention' ? { w: 400, h: 42 }
             : { w: collapsedW, h: 32 };

  // ── Geometry ────────────────────────────────────────────────────────────────
  const topY = () => (screenRef.current?.notch ? 40 : 26);
  const applyGeom = (w: number, h: number) => {
    const s = screenRef.current;
    const win = getCurrentWindow();
    win.setSize(new LogicalSize(w, h)).catch(() => {});
    if (!s) return; // don't move until we know the display — avoids off-screen flashes
    const c = customRef.current;
    let x = c ? c.cx - w / 2 : s.originX + (s.width - w) / 2;
    let y = c ? c.y          : s.originY + topY();
    // Clamp so the pill can never be lost off-screen.
    const minX = s.originX + 4, maxX = s.originX + s.width - w - 4;
    const minY = s.originY + 2, maxY = s.originY + s.height - h - 4;
    x = Math.min(Math.max(x, minX), Math.max(minX, maxX));
    y = Math.min(Math.max(y, minY), Math.max(minY, maxY));
    win.setPosition(new LogicalPosition(Math.round(x), Math.round(y))).catch(() => {});
  };
  const animateTo = (w: number, h: number) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const from = { ...curDims.current };
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ANIM_MS);
      const e = easeOutCubic(t);
      const cw = from.w + (w - from.w) * e;
      const ch = from.h + (h - from.h) * e;
      curDims.current = { w: cw, h: ch };
      applyGeom(cw, ch);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else { rafRef.current = null; curDims.current = { w, h }; }
    };
    rafRef.current = requestAnimationFrame(step);
  };

  // ── Drag / reset ──────────────────────────────────────────────────────────────
  const startDrag = (e: ReactMouseEvent) => {
    e.stopPropagation();
    getCurrentWindow().startDragging().catch(() => {});
  };
  const resetPos = (e: ReactMouseEvent) => {
    e.stopPropagation();
    customRef.current = null;
    applyGeom(curDims.current.w, curDims.current.h);
  };

  // ── SSE ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let es: EventSource;
    let retry: ReturnType<typeof setTimeout>;
    function connect() {
      es = new EventSource(`${SERVER_URL}/events`);
      es.addEventListener('state', (e) => { setState(JSON.parse(e.data) as DashState); setConnected(true); });
      es.onerror = () => { setConnected(false); es.close(); retry = setTimeout(connect, 3000); };
    }
    connect();
    return () => { es?.close(); clearTimeout(retry); };
  }, []);

  // ── Screen geometry + restore position + load ideas ─────────────────────────
  useEffect(() => {
    // Always start centered — position is never persisted across launches.
    invoke<ScreenInfo>('get_screen').then((s) => { screenRef.current = s; applyGeom(curDims.current.w, curDims.current.h); }).catch(() => {});
    invoke<QueueItem[]>('get_queue').then(setQueue).catch(() => {});
  }, []);


  // ── Attention nudge on status transition ────────────────────────────────────
  useEffect(() => {
    const prev = prevStatusesRef.current;
    const next: Record<string, AgentStatus> = {};
    let flash: { id: string; folder: string; status: AgentStatus; host?: string } | null = null;
    for (const wt of allWorktrees) {
      const to = getWorktreeStatus(wt);
      next[wt.id] = to;
      const from = prev[wt.id];
      if (from !== undefined && from !== to) {
        let kind: AgentStatus | null = null;
        if (to === 'waiting' || to === 'blocked' || to === 'error' || to === 'done') kind = to;
        else if (to === 'idle' && (from === 'working' || from === 'waiting')) kind = 'done'; // finished → done
        if (kind) flash = { id: wt.id, folder: wt.id.split('/').pop() || wt.branch || wt.id, status: kind, host: wt.host };
      }
    }
    prevStatusesRef.current = next;
    if (flash && modeRef.current !== 'expanded') {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      setAttention({ ...flash, time });
      setMode('attention');
      if (!mutedRef.current) invoke('play_sound', { kind: flash.status }).catch(() => {});
      if (attnTimerRef.current) clearTimeout(attnTimerRef.current);
      attnTimerRef.current = setTimeout(() => {
        if (modeRef.current === 'attention') { setMode('collapsed'); setAttention(null); }
      }, ATTENTION_MS);
    }
  }, [state]);

  // ── Animate window to current mode's dims ───────────────────────────────────
  useEffect(() => {
    modeRef.current = mode;
    // First placement centers (via applyGeom's default). Afterwards, capture the
    // window's actual current position so expand/collapse/resize grow & shrink
    // IN PLACE — honoring wherever the user dragged it (native drag doesn't emit
    // reliable move events, so we read the real position here instead).
    if (firstGeomRef.current) { firstGeomRef.current = false; animateTo(dims.w, dims.h); return; }
    getCurrentWindow().outerPosition()
      .then(pos => {
        const scale = screenRef.current?.scale ?? 2;
        customRef.current = { cx: pos.x / scale + curDims.current.w / 2, y: pos.y / scale };
      })
      .catch(() => {})
      .finally(() => animateTo(dims.w, dims.h));
  }, [mode, dims.w, dims.h]);

  // ── Escape collapses (unless typing) ────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && el.tagName === 'INPUT') { el.blur(); return; }
      if (modeRef.current === 'expanded') collapse();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Click-outside (blur) collapses ──────────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      // Don't collapse while a drag is in progress (drag can briefly blur the window).
      if (!focused && modeRef.current === 'expanded' && !dragCwdRef.current) collapse();
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const expand = () => {
    if (attnTimerRef.current) clearTimeout(attnTimerRef.current);
    setSelIdx(0);
    setMode('expanded');
    getCurrentWindow().setFocus().catch(() => {});
  };
  const collapse = () => { setMode('collapsed'); setAttention(null); };
  const openPath = (id: string, host?: string) => { invoke('open_worktree', { worktreePath: id, host }).catch(() => {}); collapse(); };
  const openWorktree = (wt: WorktreeInfo) => openPath(wt.id, wt.host);
  const toggleMute = (e: ReactMouseEvent) => {
    e.stopPropagation();
    const n = !mutedRef.current;
    mutedRef.current = n;
    setMuted(n);
    try { localStorage.setItem('hud.muted', n ? '1' : '0'); } catch { /* noop */ }
  };
  const togglePin  = (wt: WorktreeInfo) => { setPinned(wt.id, !wt.pinned); };
  const copyResume = (wt: WorktreeInfo) => {
    navigator.clipboard.writeText(resumeCommand(wt)).then(() => {
      setCopiedResume(wt.id); setTimeout(() => setCopiedResume(null), 1200);
    }).catch(() => {});
  };
  const renderRow = (wt: WorktreeInfo, dragHandlers?: DragHandlers) => (
    <HudRow key={wt.id} wt={wt}
      onOpen={() => openWorktree(wt)} onTogglePin={() => togglePin(wt)}
      onCopyResume={() => copyResume(wt)} copied={copiedResume === wt.id}
      queue={queue} onQueueChange={setQueue} dragHandlers={dragHandlers}
      draft={drafts[wt.id] || ''} onDraft={(t) => setDraft(wt.id, t)}
      selected={wt.id === selCwd} />
  );
  // ── Drag to pin / unpin / reorder ─────────────────────────────────────────
  // Any row is draggable. Drop into PINNED → pin (at the drop position); drop
  // into ACTIVE/MORE → unpin. setPins() writes the whole ordered pinned list.
  const pinnedCwds = pinned.map(w => w.id);
  const allowDrop = (e: ReactDragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const beginDrag = (cwd: string) => (e: ReactDragEvent) => {
    dragCwdRef.current = cwd;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', cwd); } catch { /* noop */ }
  };
  const endDrag = () => { dragCwdRef.current = null; };
  const dropReorder = (targetCwd: string) => (e: ReactDragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const drag = dragCwdRef.current; dragCwdRef.current = null;
    if (!drag || drag === targetCwd) return;
    const order = pinnedCwds.filter(c => c !== drag);
    const idx = order.indexOf(targetCwd);
    order.splice(idx < 0 ? order.length : idx, 0, drag);
    setPins(order);
  };
  const dropPin = (e: ReactDragEvent) => {
    e.preventDefault();
    const drag = dragCwdRef.current; dragCwdRef.current = null;
    if (!drag || pinnedCwds.includes(drag)) return;
    setPins([...pinnedCwds, drag]);
  };
  const dropUnpin = (e: ReactDragEvent) => {
    e.preventDefault();
    const drag = dragCwdRef.current; dragCwdRef.current = null;
    if (!drag || !pinnedCwds.includes(drag)) return;
    setPins(pinnedCwds.filter(c => c !== drag));
  };
  const rowHandlers = (wt: WorktreeInfo): DragHandlers => ({
    draggable: true,
    onDragStart: beginDrag(wt.id),
    onDragEnter: allowDrop,
    onDragOver:  allowDrop,
    onDrop:      wt.tier === 'pinned' ? dropReorder(wt.id) : dropUnpin,
    onDragEnd:   endDrag,
  });

  // Flat list of visible rows for keyboard navigation (order matches render).
  const visibleRows = [...pinned, ...active, ...(showOther ? other : [])];
  visibleRef.current = visibleRows;
  const selClamped = Math.min(selIdx, Math.max(0, visibleRows.length - 1));
  selIdxRef.current = selClamped;
  const selCwd = visibleRows[selClamped]?.id;

  const attnColor = attention ? STATUS[attention.status].color : 'oklch(0.83 0.15 80)';

  // ── Keyboard navigation (panel open): ↑/↓ select, ↵ open, p pin ─────────────
  useEffect(() => {
    const onNav = (e: KeyboardEvent) => {
      if (modeRef.current !== 'expanded') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && el.tagName === 'INPUT') return; // let the idea box type freely
      const rows = visibleRef.current;
      if (!rows.length) return;
      if (e.key === 'ArrowDown')      { e.preventDefault(); setSelIdx(i => Math.min(rows.length - 1, i + 1)); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setSelIdx(i => Math.max(0, i - 1)); }
      else if (e.key === 'Enter')     { e.preventDefault(); const wt = rows[selIdxRef.current]; if (wt) openWorktree(wt); }
      else if (e.key === 'p' || e.key === 'P') { const wt = rows[selIdxRef.current]; if (wt) togglePin(wt); }
    };
    window.addEventListener('keydown', onNav);
    return () => window.removeEventListener('keydown', onNav);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      onClick={() => { if (mode !== 'expanded') expand(); }}
      style={{
        width: '100vw', height: '100vh', overflow: 'hidden', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', position: 'relative',
        fontFamily: MONO, color: 'oklch(0.9 0.005 265)', userSelect: 'none',
        cursor: mode === 'expanded' ? 'default' : 'pointer',
        background: mode === 'expanded' ? 'oklch(0.13 0.008 230 / 0.98)' : 'oklch(0.14 0.01 230 / 0.97)',
        backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
        border: '1px solid oklch(0.5 0.01 230 / 0.28)',
        borderLeft: mode === 'attention' ? `3px solid ${attnColor}` : undefined,
        borderRadius: mode === 'expanded' ? 16 : mode === 'attention' ? 10 : 9,
        boxShadow: mode === 'expanded' ? '0 24px 60px rgba(0,0,0,0.6)' : '0 8px 24px rgba(0,0,0,0.45)',
        animation: mode === 'attention' ? 'm-glow 2s ease-in-out infinite' : undefined,
      }}
    >
      <style>{`
        @keyframes m-glow { 0%,100% { box-shadow: 0 8px 24px rgba(0,0,0,.45), 0 0 0 0 rgba(240,190,90,0); } 50% { box-shadow: 0 8px 24px rgba(0,0,0,.45), 0 0 14px 1px rgba(240,190,90,.35); } }
        @keyframes m-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: oklch(0.4 0.01 265); border-radius: 3px; }
      `}</style>

      {/* ── Collapsed: segmented count pill ── */}
      {mode === 'collapsed' && (
        <div style={{ display: 'flex', alignItems: 'stretch', width: '100%', height: '100%', fontSize: 13 }}>
          <span onMouseDown={startDrag} onClick={stop} onDoubleClick={resetPos} title="Drag to move · double-click to re-center"
            style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 9px', borderRight: '1px solid oklch(0.5 0.01 230 / 0.25)', cursor: 'grab' }}>
            <span style={{ width: 2, height: 11, borderRadius: 1, background: 'oklch(0.62 0.01 265)', opacity: 0.6 }} />
            <span style={{ width: 2, height: 11, borderRadius: 1, background: 'oklch(0.62 0.01 265)', opacity: 0.6 }} />
          </span>
          {segments.map((s, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', padding: '0 12px', borderRight: i < segments.length - 1 ? '1px solid oklch(0.5 0.01 230 / 0.25)' : 'none', color: s.color, whiteSpace: 'nowrap' }}>
              {s.n !== undefined ? <><b>{s.n}</b>&nbsp;{s.unit}</> : s.text}
            </span>
          ))}
        </div>
      )}

      {/* ── Attention: timed nudge ── */}
      {mode === 'attention' && attention && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', height: '100%', padding: '0 10px 0 16px', fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <span style={{ flex: '0 0 auto', color: 'oklch(0.66 0.01 265)' }}>[{attention.time}]</span>
          <b style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{attention.folder}</b>
          <span style={{ flex: '0 0 auto', color: attnColor, fontWeight: 700 }}>{STATUS[attention.status].short} · {STATUS[attention.status].phrase}</span>
          <button onClick={(e) => { stop(e); openPath(attention.id, attention.host); }} title="Open"
            style={{ all: 'unset', marginLeft: 'auto', flex: '0 0 auto', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 7, color: attnColor, background: alpha(attnColor, 0.16), border: `1px solid ${alpha(attnColor, 0.5)}` }}>
            Open
          </button>
        </div>
      )}

      {/* ── Expanded: triage panel ── */}
      {mode === 'expanded' && (
        <>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid oklch(0.5 0.01 230 / 0.2)', background: 'oklch(0.15 0.01 230 / 0.6)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span onMouseDown={startDrag} onClick={stop} onDoubleClick={resetPos} title="Drag to move · double-click to re-center"
                style={{ width: 16, height: 5, borderRadius: 2, background: 'oklch(0.5 0.01 230 / 0.5)', cursor: 'grab' }} />
              <b style={{ letterSpacing: '0.05em' }}>MAESTRO</b>
              <span style={{ color: 'oklch(0.66 0.01 265)' }}>{allWorktrees.length} trees</span>
              <span title={connected ? 'connected' : 'reconnecting'} style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? 'oklch(0.76 0.15 150)' : 'oklch(0.5 0.01 265)' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span onClick={toggleMute} title={muted ? 'Unmute alerts' : 'Mute alerts'}
                style={{ cursor: 'pointer', display: 'flex', color: muted ? 'oklch(0.67 0.16 25)' : 'oklch(0.62 0.01 265)' }}>
                <SoundIcon muted={muted} />
              </span>
              <span onClick={(e) => { stop(e); collapse(); }} title="Close" style={{ cursor: 'pointer', fontSize: 13, color: 'oklch(0.62 0.01 265)' }}>⎋</span>
            </div>
          </div>

          {/* Body */}
          <div style={{ maxHeight: 388, overflowY: 'auto', flex: '1 1 auto' }}>
            {allWorktrees.length === 0 ? (
              <div style={{ padding: '28px 20px', color: 'oklch(0.6 0.01 265)', fontSize: 12, textAlign: 'center' }}>
                {connected ? 'no claude sessions found' : 'waiting for server…'}
              </div>
            ) : (
              <>
                {/* PINNED — always a drop zone; drag any row here to pin it */}
                <div onDragEnter={allowDrop} onDragOver={allowDrop} onDrop={dropPin}>
                  <div style={sectionLabel}>PINNED</div>
                  {pinned.length === 0
                    ? <div style={{ padding: '10px 20px', fontSize: 11, color: 'oklch(0.5 0.01 265)', fontStyle: 'italic' }}>drag a row here to pin</div>
                    : pinned.map(wt => renderRow(wt, rowHandlers(wt)))}
                </div>

                {active.length > 0 && (
                  <div onDragEnter={allowDrop} onDragOver={allowDrop} onDrop={dropUnpin}>
                    <div style={sectionLabel}>ACTIVE</div>
                    {active.map(wt => renderRow(wt, rowHandlers(wt)))}
                  </div>
                )}

                {other.length > 0 && (
                  <div onDragEnter={allowDrop} onDragOver={allowDrop} onDrop={dropUnpin} style={{ borderTop: '1px solid oklch(0.5 0.01 230 / 0.15)' }}>
                    <button onClick={() => setShowOther(v => !v)}
                      style={{ all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '14px 20px', cursor: 'pointer', fontSize: 11, letterSpacing: '0.06em', color: 'oklch(0.66 0.01 265)', background: 'oklch(0.15 0.01 230 / 0.4)' }}>
                      <span style={{ fontSize: 9, display: 'inline-block', transition: 'transform 0.2s', transform: showOther ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                      MORE <span style={{ color: 'oklch(0.56 0.01 265)' }}>· {other.length} more</span>
                    </button>
                    {showOther && other.map(wt => renderRow(wt, rowHandlers(wt)))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid oklch(0.5 0.01 230 / 0.15)', fontSize: 11, color: 'oklch(0.6 0.01 265)', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
            <span>row → editor · +idea to park</span>
            <span>drag ⠿ to move</span>
          </div>
        </>
      )}
    </div>
  );
}
