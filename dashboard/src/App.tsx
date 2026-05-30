import { useState, useEffect, useRef } from 'react';
import { DashState } from './types';
import Sidebar from './components/Sidebar';
import TerminalPane from './components/TerminalPane';

export default function App() {
  const [state, setState]         = useState<DashState | null>(null);
  const [connected, setConnected] = useState(false);

  // Focus lock for VS Code focus button in sidebar
  const [focusingId, setFocusingId]     = useState<string | null>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleFocusStart(id: string) {
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    setFocusingId(id);
  }
  function handleFocusDone() { setFocusingId(null); }

  // Color operations
  const [colorOp, setColorOp] = useState<null | 'apply' | 'clear'>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const toggleSidebar = () => setSidebarOpen(p => !p);

  // Cmd+B — global sidebar toggle
  // Ctrl+1-9 — open/activate the Nth worktree from the sidebar
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      // Ctrl+1-9 → open/focus Nth worktree from sidebar list
      if (e.ctrlKey && !e.metaKey) {
        const match = e.code.match(/^Digit([1-9])$/);
        if (match) {
          const n = parseInt(match[1], 10);
          const allWorktrees = state?.repos.flatMap(r => r.worktrees) ?? [];
          const wt = allWorktrees[n - 1];
          if (wt) { e.preventDefault(); handleOpenTerminal(wt.id); }
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state]);

  // Terminal open request — sidebar sets this, TerminalPane handles it
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  // Track which worktree paths currently have open terminals (for sidebar highlight)
  const [openTerminalPaths, setOpenTerminalPaths] = useState<string[]>([]);

  // SSE connection
  useEffect(() => {
    let es: EventSource;
    let retry: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource('/events');
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

  async function applyColors() {
    if (colorOp) return;
    setColorOp('apply');
    try {
      await fetch('/api/set-colors-all', { method: 'POST' });
      alert('Colors applied!\nReload each VS Code window: Cmd+Shift+P → Reload Window');
    } finally { setColorOp(null); }
  }

  async function clearColors() {
    if (colorOp) return;
    setColorOp('clear');
    try {
      await fetch('/api/clear-colors-all', { method: 'POST' });
      alert('Colors cleared!\nReload each VS Code window: Cmd+Shift+P → Reload Window');
    } finally { setColorOp(null); }
  }

  function handleOpenTerminal(path: string) {
    setPendingOpen(path);
    // Optimistically mark as open for sidebar highlight
    setOpenTerminalPaths(prev => prev.includes(path) ? prev : [...prev, path]);
  }

  function handleTerminalClosed(path: string) {
    setOpenTerminalPaths(prev => prev.filter(p => p !== path));
  }

  const allWorktrees    = state?.repos.flatMap(r => r.worktrees) ?? [];
  const restoreTerminals = state?.restoreTerminals ?? [];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0d0d0d' }}>
      <Sidebar
        isOpen={sidebarOpen}
        state={state}
        connected={connected}
        focusingId={focusingId}
        openTerminalPaths={openTerminalPaths}
        onFocusStart={handleFocusStart}
        onFocusDone={handleFocusDone}
        onOpenTerminal={handleOpenTerminal}
        colorOp={colorOp}
        onApplyColors={applyColors}
        onClearColors={clearColors}
      />

      <TerminalPane
        allWorktrees={allWorktrees}
        pendingOpen={pendingOpen}
        onPendingHandled={() => setPendingOpen(null)}
        restoreTerminals={restoreTerminals}
        onTerminalClosed={handleTerminalClosed}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />
    </div>
  );
}
