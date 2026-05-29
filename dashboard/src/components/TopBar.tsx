interface Props {
  repoCount: number;
  treeCount: number;
  working: number;
  waiting: number;
  serversUp: number;
  connected: boolean;
  colorOp: null | 'apply' | 'clear';
  onApplyColors: () => void;
  onClearColors: () => void;
}

export default function TopBar({ repoCount, treeCount, working, waiting, serversUp, connected, colorOp, onApplyColors, onClearColors }: Props) {
  const busy = colorOp !== null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '9px 20px', background: '#111', borderBottom: '1px solid #1e1e1e',
      flexShrink: 0,
    }}>
      <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 1, color: '#fff' }}>
        WORKTREE DASH
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, color: '#666', fontSize: 12 }}>
        <Stat n={repoCount} label={repoCount === 1 ? 'repo' : 'repos'} />
        <Sep />
        <Stat n={treeCount} label="trees" />
        {working > 0 && <><Sep /><Stat n={working} label="working" color="#22c55e" /></>}
        {waiting > 0 && <><Sep /><Stat n={waiting} label="needs input" color="#f59e0b" bold /></>}
        {serversUp > 0 && <><Sep /><Stat n={serversUp} label="servers up" color="#3b82f6" /></>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ActionButton
          onClick={onClearColors}
          disabled={busy}
          loading={colorOp === 'clear'}
          title="Remove color identity from all .vscode/settings.json"
        >
          {colorOp === 'clear' ? 'Clearing…' : 'Clear colors'}
        </ActionButton>

        <ActionButton
          onClick={onApplyColors}
          disabled={busy}
          loading={colorOp === 'apply'}
          title="Write stable color into .vscode/settings.json for every worktree"
        >
          {colorOp === 'apply' ? 'Applying…' : 'Apply VS Code colors'}
        </ActionButton>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginLeft: 4 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
            background: connected ? '#22c55e' : '#ef4444',
            boxShadow: connected ? '0 0 5px #22c55e88' : undefined,
          }} />
          <span style={{ color: connected ? '#22c55e' : '#ef4444' }}>
            {connected ? 'live' : 'reconnecting…'}
          </span>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ onClick, disabled, loading, title, children }: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        fontSize: 11, padding: '3px 10px', borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: '#1e1e1e',
        color: loading ? '#888' : disabled ? '#3a3a3a' : '#777',
        border: `1px solid ${disabled ? '#222' : '#2a2a2a'}`,
        opacity: disabled && !loading ? 0.5 : 1,
        transition: 'color 0.15s, opacity 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.color = '#ccc'; e.currentTarget.style.borderColor = '#444'; }}}
      onMouseLeave={e => { if (!disabled) { e.currentTarget.style.color = '#777'; e.currentTarget.style.borderColor = '#2a2a2a'; }}}
    >
      {children}
    </button>
  );
}

function Stat({ n, label, color, bold }: { n: number; label: string; color?: string; bold?: boolean }) {
  return (
    <span style={{ color: color ?? '#666', fontWeight: bold ? 700 : 400 }}>
      <span style={{ fontSize: 13, color: color ?? '#aaa' }}>{n}</span> {label}
    </span>
  );
}
function Sep() {
  return <span style={{ color: '#2a2a2a' }}>•</span>;
}
