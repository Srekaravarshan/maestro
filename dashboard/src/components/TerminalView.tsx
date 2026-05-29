/**
 * TerminalView — xterm.js terminal backed by a native Rust PTY via Tauri IPC.
 *
 * No WebSocket, no Node.js server in the critical path.
 * PTY output arrives as Tauri events; input is sent via invoke().
 *
 * Tauri events used:
 *   "terminal-output"  { terminal_id, data }  — PTY output → xterm.js
 *   "terminal-exit"    { terminal_id, code }   — shell exited
 */
import { useEffect, useRef, CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface TerminalOutputEvent { terminal_id: string; data: string; }
interface TerminalExitEvent   { terminal_id: string; code: number; }

interface Props {
  worktreePath:    string;
  branch:          string;
  color:           string;
  style?:          CSSProperties;
  isActive:        boolean;
  /** When true: canvas is hidden, only the compact header + status shows.
   *  The PTY keeps running — no resize is sent. */
  isMinimized:     boolean;
  /** Last activity string to show in minimized state */
  lastActivity:    string;
  onTerminalReady: (terminal_id: string) => void;
  onClose:         () => void;
  onClick:         () => void;
  /** Parent calls this after the expand transition to re-fit the terminal */
  registerRefit:   (fn: () => void) => void;
}

export default function TerminalView({
  worktreePath, branch, color, style, isActive, isMinimized, lastActivity,
  onTerminalReady, onClose, onClick, registerRefit,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const fitRef       = useRef<FitAddon | null>(null);
  const termIdRef    = useRef<string | null>(null);
  const mountedRef   = useRef(true);

  // Register the refit function so TerminalPane can call it after expand transition
  useEffect(() => {
    registerRefit(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { fitRef.current?.fit(); } catch { /* ignore */ }
        if (termIdRef.current) {
          invoke('resize_terminal', {
            terminalId: termIdRef.current,
            cols: termRef.current?.cols ?? 80,
            rows: termRef.current?.rows ?? 24,
          }).catch(() => {});
        }
      }));
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const container = containerRef.current;
    if (!container) return;

    // ── xterm.js ──────────────────────────────────────────────────
    const term = new Terminal({
      theme: {
        background:          '#0d0d0d',
        foreground:          '#e2e2e2',
        cursor:              '#e2e2e2',
        cursorAccent:        '#0d0d0d',
        selectionBackground: '#ffffff25',
        black: '#1a1a1a', brightBlack: '#555555',
        red:   '#ef4444', brightRed:   '#f87171',
        green: '#22c55e', brightGreen: '#4ade80',
        yellow:'#f59e0b', brightYellow:'#fbbf24',
        blue:  '#3b82f6', brightBlue:  '#60a5fa',
        magenta:'#a855f7',brightMagenta:'#c084fc',
        cyan:  '#06b6d4', brightCyan:  '#22d3ee',
        white: '#e2e2e2', brightWhite: '#f5f5f5',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
      fontSize:   13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback:  5000,
      allowProposedApi: true,
    });

    const fit   = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(container);

    termRef.current = term;
    fitRef.current  = fit;

    // ── Tauri event listeners ─────────────────────────────────────
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit:   UnlistenFn | null = null;

    // ── Spawn PTY via Tauri command ───────────────────────────────
    (async () => {
      try {
        // Wait two animation frames so the CSS grid fully applies its
        // dimensions before we measure cols/rows. Without this, fit()
        // reads a stale container size and the PTY gets the wrong width,
        // which causes \r-based progress animations to overlap text.
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
        if (!mountedRef.current) return;

        fit.fit();

        // Register listeners BEFORE invoking so we don't miss early output
        unlistenOutput = await listen<TerminalOutputEvent>('terminal-output', (event) => {
          if (!mountedRef.current) return;
          if (event.payload.terminal_id !== termIdRef.current) return;
          term.write(event.payload.data);
        });

        unlistenExit = await listen<TerminalExitEvent>('terminal-exit', (event) => {
          if (!mountedRef.current) return;
          if (event.payload.terminal_id !== termIdRef.current) return;
          term.write(`\r\n\x1b[90m─── process exited (code ${event.payload.code}) ───\x1b[0m\r\n`);
        });

        const terminal_id = await invoke<string>('create_terminal', {
          worktreePath,
          cols: term.cols,
          rows: term.rows,
        });

        if (!mountedRef.current) {
          invoke('kill_terminal', { terminalId: terminal_id }).catch(() => {});
          return;
        }

        termIdRef.current = terminal_id;
        onTerminalReady(terminal_id);

      } catch (err) {
        term.write(`\r\n\x1b[31mFailed to start terminal:\x1b[0m\r\n${String(err)}\r\n`);
      }
    })();

    // ── Input ─────────────────────────────────────────────────────
    term.onData((data) => {
      if (termIdRef.current) {
        invoke('write_terminal', { terminalId: termIdRef.current, data }).catch(() => {});
      }
    });

    // ── Resize ────────────────────────────────────────────────────
    // Debounce: wait 60ms after the last resize event before telling the PTY.
    // This prevents a flood of resize calls when the split pane is being
    // dragged or the window is being resized, which would corrupt the display.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try { fit.fit(); } catch { /* ignore during unmount */ }
        if (termIdRef.current) {
          invoke('resize_terminal', {
            terminalId: termIdRef.current,
            cols: term.cols,
            rows: term.rows,
          }).catch(() => {});
        }
      }, 60);
    });
    ro.observe(container);

    return () => {
      mountedRef.current = false;
      ro.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      unlistenOutput?.();
      unlistenExit?.();
      if (termIdRef.current) {
        invoke('kill_terminal', { terminalId: termIdRef.current }).catch(() => {});
      }
      term.dispose();
    };
  }, []);

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column',
        height: '100%', overflow: 'hidden',
        border: `1px solid ${isActive ? `${color}55` : '#1e1e1e'}`,
        borderRadius: 4, cursor: isMinimized ? 'pointer' : 'default',
        ...style,
      }}
    >
      {/* Header — always visible */}
      <div style={{
        display: 'flex', alignItems: 'center',
        height: 30, flexShrink: 0,
        background: '#111', borderBottom: '1px solid #1e1e1e',
      }}>
        <div style={{ width: 3, background: color, alignSelf: 'stretch', flexShrink: 0 }} />
        <span style={{
          flex: 1, fontSize: 12,
          color: isMinimized ? color : '#888',
          fontWeight: isMinimized ? 600 : 400,
          marginLeft: 8,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {branch}
        </span>
        {!isMinimized && (
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 14, padding: '0 10px', lineHeight: '30px' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#888'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#444'; }}
          >×</button>
        )}
      </div>

      {/* Minimized body — last activity, no canvas */}
      {isMinimized && (
        <div style={{
          flex: 1, background: '#0a0a0a', padding: '8px 6px',
          display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden',
        }}>
          <div style={{ fontSize: 10, color: '#2a2a2a', letterSpacing: 0.5 }}>PAUSED</div>
          {lastActivity && (
            <div style={{
              fontSize: 10, color: '#3a3a3a', lineHeight: 1.4,
              overflow: 'hidden', display: '-webkit-box',
              WebkitLineClamp: 4, WebkitBoxOrient: 'vertical',
            }}>
              {lastActivity}
            </div>
          )}
          <div style={{ marginTop: 'auto', fontSize: 10, color: `${color}88` }}>
            click to expand
          </div>
        </div>
      )}

      {/* Terminal canvas — hidden when minimized but kept mounted so PTY runs */}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflow: 'hidden', padding: '2px 4px',
          display: isMinimized ? 'none' : 'block',
        }}
      />
    </div>
  );
}
