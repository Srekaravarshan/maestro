import { ActivityEntry } from '../types';

interface Props {
  entries: ActivityEntry[];
}

const EVENT_COLOR: Record<string, string> = {
  registered: '#6366f1',
  status:     '#555',
  done:       '#3b82f6',
  blocked:    '#f59e0b',
  error:      '#ef4444',
  working:    '#22c55e',
  idle:       '#3b82f6',
  waiting:    '#f59e0b',
};

const EVENT_ICON: Record<string, string> = {
  registered: '◎',
  status:     '›',
  done:       '✓',
  blocked:    '⚠',
  error:      '✗',
  working:    '⚙',
  idle:       '·',
  waiting:    '⚠',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function ActivityFeed({ entries }: Props) {
  return (
    <div style={{
      flexShrink: 0,
      borderTop: '1px solid #1a1a1a',
      background: '#0c0c0c',
      display: 'flex',
      flexDirection: 'column',
      maxHeight: 180,
    }}>
      {/* Header */}
      <div style={{
        padding: '5px 20px',
        borderBottom: '1px solid #141414',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1,
        color: '#333',
        flexShrink: 0,
      }}>
        ACTIVITY
      </div>

      {/* Scrollable log */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {entries.length === 0 ? (
          <div style={{ padding: '10px 20px', fontSize: 11, color: '#2a2a2a' }}>
            No activity yet — waiting for agent events…
          </div>
        ) : (
          entries.map(entry => (
            <div
              key={entry.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '68px 14px 100px 1fr',
                gap: '0 8px',
                padding: '3px 20px',
                fontSize: 11,
                borderBottom: '1px solid #111',
                alignItems: 'center',
              }}
            >
              {/* Time */}
              <span style={{ color: '#333', fontVariantNumeric: 'tabular-nums', fontSize: 10 }}>
                {formatTime(entry.ts)}
              </span>

              {/* Icon */}
              <span style={{ color: EVENT_COLOR[entry.event] ?? '#555', fontSize: 11 }}>
                {EVENT_ICON[entry.event] ?? '·'}
              </span>

              {/* Branch */}
              <span style={{
                color: '#555',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 11,
              }}>
                {entry.branch}
              </span>

              {/* Message */}
              <span style={{
                color: entry.event === 'status' ? '#444' : (EVENT_COLOR[entry.event] ?? '#555'),
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
