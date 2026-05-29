/**
 * TerminalView — a single xterm.js terminal connected to a server-side PTY.
 *
 * Lifecycle:
 *   mount   → open WebSocket → send 'create' → receive 'created' (terminal_id)
 *   running → stream output / send input / handle resize
 *   unmount → send 'kill' → close WebSocket → dispose xterm
 */
import { useEffect, useRef, CSSProperties } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const WS_URL = `ws://${window.location.hostname}:3444/terminal`;

interface Props {
  worktreePath:      string;
  branch:            string;
  color:             string;
  style?:            CSSProperties;
  isActive:          boolean;
  onTerminalReady:   (terminal_id: string) => void;
  onClose:           () => void;
  onClick:           () => void;
}

export default function TerminalView({
  worktreePath, branch, color, style, isActive,
  onTerminalReady, onClose, onClick,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const termRef       = useRef<Terminal | null>(null);
  const wsRef         = useRef<WebSocket | null>(null);
  const fitRef        = useRef<FitAddon | null>(null);
  const termIdRef     = useRef<string | null>(null);
  const mountedRef    = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const container = containerRef.current;
    if (!container) return;

    // ── xterm instance ───────────────────────────────────────────────
    const term = new Terminal({
      theme: {
        background:          '#0d0d0d',
        foreground:          '#e2e2e2',
        cursor:              '#e2e2e2',
        cursorAccent:        '#0d0d0d',
        selectionBackground: '#ffffff25',
        black:   '#1a1a1a', brightBlack:   '#555555',
        red:     '#ef4444', brightRed:     '#f87171',
        green:   '#22c55e', brightGreen:   '#4ade80',
        yellow:  '#f59e0b', brightYellow:  '#fbbf24',
        blue:    '#3b82f6', brightBlue:    '#60a5fa',
        magenta: '#a855f7', brightMagenta: '#c084fc',
        cyan:    '#06b6d4', brightCyan:    '#22d3ee',
        white:   '#e2e2e2', brightWhite:   '#f5f5f5',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
      fontSize:    13,
      lineHeight:  1.4,
      letterSpacing: 0,
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
    fit.fit();

    termRef.current = term;
    fitRef.current  = fit;

    // ── WebSocket ────────────────────────────────────────────────────
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type:         'create',
        worktree_path: worktreePath,
        cols:         term.cols,
        rows:         term.rows,
      }));
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(e.data as string) as Record<string, unknown>;
        if (msg['type'] === 'created') {
          termIdRef.current = msg['terminal_id'] as string;
          onTerminalReady(msg['terminal_id'] as string);
        } else if (msg['type'] === 'output') {
          term.write(msg['data'] as string);
        } else if (msg['type'] === 'exit') {
          term.write('\r\n\x1b[90m─── process exited ───\x1b[0m\r\n');
        } else if (msg['type'] === 'error') {
          term.write(`\r\n\x1b[31mFailed to start terminal:\x1b[0m\r\n${msg['message'] as string}\r\n\r\n`);
          term.write('\x1b[90mPossible fixes:\x1b[0m\r\n');
          term.write('  1. Make sure node-pty is installed: cd server && npm install node-pty\r\n');
          term.write('  2. Rebuild native bindings: npm rebuild node-pty\r\n');
          term.write('  3. Restart the server after installing\r\n');
        }
      } catch { /* ignore malformed */ }
    };

    ws.onerror = () => {
      if (mountedRef.current) {
        term.write('\r\n\x1b[31m[connection error — is the server running?]\x1b[0m\r\n');
      }
    };

    // ── Input ────────────────────────────────────────────────────────
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN && termIdRef.current) {
        ws.send(JSON.stringify({ type: 'input', terminal_id: termIdRef.current, data }));
      }
    });

    // ── Resize ───────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* ignore during unmount */ }
      if (ws.readyState === WebSocket.OPEN && termIdRef.current) {
        ws.send(JSON.stringify({
          type:        'resize',
          terminal_id: termIdRef.current,
          cols:        term.cols,
          rows:        term.rows,
        }));
      }
    });
    ro.observe(container);

    return () => {
      mountedRef.current = false;
      ro.disconnect();
      if (termIdRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'kill', terminal_id: termIdRef.current }));
      }
      ws.close();
      term.dispose();
    };
  }, []); // intentionally empty — terminal is tied to mount lifecycle

  return (
    <div
      onClick={onClick}
      style={{
        display:      'flex',
        flexDirection:'column',
        height:       '100%',
        overflow:     'hidden',
        border:       `1px solid ${isActive ? `${color}55` : '#1e1e1e'}`,
        borderRadius: 4,
        ...style,
      }}
    >
      {/* Header */}
      <div style={{
        display:       'flex',
        alignItems:    'center',
        height:        30,
        flexShrink:    0,
        background:    '#111',
        borderBottom:  `1px solid #1e1e1e`,
        gap:           8,
      }}>
        <div style={{ width: 3, background: color, alignSelf: 'stretch', flexShrink: 0 }} />
        <span style={{
          flex:         1,
          fontSize:     12,
          color:        '#888',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>
          {branch}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close terminal"
          style={{
            background: 'none',
            border:     'none',
            color:      '#444',
            cursor:     'pointer',
            fontSize:   14,
            padding:    '0 10px',
            lineHeight: '30px',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#888'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#444'; }}
        >
          ×
        </button>
      </div>

      {/* Terminal canvas */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', padding: '2px 4px' }}
      />
    </div>
  );
}
