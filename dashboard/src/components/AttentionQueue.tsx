import { WorktreeInfo } from '../types';

interface Props {
  worktrees: WorktreeInfo[];
  focusingId: string | null;
  onFocusStart: (id: string) => void;
  onFocusDone:  () => void;
}

const STATUS_COLOR: Record<string, string> = {
  done:    '#3b82f6',
  blocked: '#f59e0b',
  error:   '#ef4444',
  waiting: '#f59e0b',
};
const STATUS_ICON: Record<string, string> = {
  done:    '✓',
  blocked: '⚠',
  error:   '✗',
  waiting: '⚠',
};
const STATUS_LABEL: Record<string, string> = {
  done:    'done',
  blocked: 'blocked',
  error:   'error',
  waiting: 'needs input',
};

function waitingTime(ms: number | null | undefined): string {
  if (!ms) return '';
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60)  return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function getMessage(wt: WorktreeInfo): string {
  if (wt.agent) {
    if (wt.agent.status === 'blocked')  return wt.agent.question   ?? wt.agent.current_activity;
    if (wt.agent.status === 'done')     return wt.agent.summary     ?? wt.agent.current_activity;
    if (wt.agent.status === 'error')    return wt.agent.error_msg   ?? wt.agent.current_activity;
  }
  return wt.claude === 'waiting' ? 'Claude is waiting for your input in this terminal' : '';
}

function getStatusKey(wt: WorktreeInfo): string {
  if (wt.agent?.status === 'done')    return 'done';
  if (wt.agent?.status === 'blocked') return 'blocked';
  if (wt.agent?.status === 'error')   return 'error';
  return 'waiting';
}

function getUpdatedAt(wt: WorktreeInfo): number | null {
  return wt.agent?.last_updated_at ?? wt.claude_updated_at ?? null;
}

export default function AttentionQueue({ worktrees, focusingId, onFocusStart, onFocusDone }: Props) {
  // Sort: longest waiting first
  const sorted = [...worktrees].sort((a, b) =>
    (getUpdatedAt(a) ?? 0) - (getUpdatedAt(b) ?? 0)
  );

  return (
    <div style={{
      border: '1px solid #f59e0b33',
      borderRadius: 6,
      overflow: 'hidden',
      background: '#0f0d00',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 14px',
        background: '#141200',
        borderBottom: '1px solid #f59e0b22',
      }}>
        <span style={{ fontSize: 13 }}>⚡</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#f59e0b' }}>
          NEEDS YOUR ATTENTION
        </span>
        <span style={{
          background: '#f59e0b', color: '#000',
          borderRadius: 9, padding: '0 6px', fontSize: 11, fontWeight: 700,
        }}>
          {sorted.length}
        </span>
      </div>

      {/* Rows */}
      {sorted.map((wt, i) => {
        const statusKey   = getStatusKey(wt);
        const color       = STATUS_COLOR[statusKey] ?? '#888';
        const isFocusing  = focusingId === wt.id;
        const isOther     = focusingId !== null && focusingId !== wt.id;
        const parts       = wt.id.split('/');
        const folderName  = parts[parts.length - 1] ?? wt.id;
        const updatedAt   = getUpdatedAt(wt);
        const message     = getMessage(wt);

        return (
          <div
            key={wt.id}
            onClick={() => {
              if (focusingId) return;
              onFocusStart(wt.id);
              fetch('/api/focus', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: wt.id }),
              });
              setTimeout(onFocusDone, 1500);
            }}
            style={{
              display: 'grid',
              gridTemplateColumns: '3px 1fr auto',
              borderTop: i > 0 ? '1px solid #1a1800' : undefined,
              cursor: focusingId ? 'not-allowed' : 'pointer',
              opacity: isOther ? 0.5 : 1,
              background: isFocusing ? '#1a1800' : 'transparent',
              transition: 'opacity 0.2s',
              pointerEvents: focusingId ? 'none' : 'auto',
            }}
            onMouseEnter={e => { if (!focusingId) e.currentTarget.style.background = '#141200'; }}
            onMouseLeave={e => { if (!isFocusing)  e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ background: wt.color, alignSelf: 'stretch' }} />

            <div style={{ padding: '9px 14px', minWidth: 0 }}>
              {/* Branch + status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, color: '#e2e2e2', fontSize: 13 }}>{wt.branch}</span>
                <span style={{ color: '#3a3a3a', fontSize: 11 }}>{folderName !== wt.branch ? folderName : ''}</span>
                <span style={{
                  marginLeft: 'auto', flexShrink: 0,
                  fontSize: 11, fontWeight: 700, color,
                }}>
                  {STATUS_ICON[statusKey]} {STATUS_LABEL[statusKey]}
                </span>
                {updatedAt && (
                  <span style={{ flexShrink: 0, fontSize: 11, color: '#555' }}>
                    {waitingTime(updatedAt)} ago
                  </span>
                )}
              </div>
              {/* Message */}
              {message && (
                <div style={{
                  marginTop: 3, fontSize: 11, color,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {message}
                </div>
              )}
            </div>

            <div style={{ paddingRight: 12, alignSelf: 'center', color: '#333', fontSize: 12 }}>
              {isFocusing ? '…' : '→'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
