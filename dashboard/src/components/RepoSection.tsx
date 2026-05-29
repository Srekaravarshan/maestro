import { RepoGroup } from '../types';
import WorktreeRow from './WorktreeRow';

interface Props {
  repo: RepoGroup;
  focusingId: string | null;
  onFocusStart: (id: string) => void;
  onFocusDone:  () => void;
}

export default function RepoSection({ repo, focusingId, onFocusStart, onFocusDone }: Props) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 0 8px 0', marginBottom: 4,
        borderBottom: '1px solid #1e1e1e',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#555' }}>
          {repo.repo.toUpperCase()}
        </span>
        <span style={{ fontSize: 11, color: '#2a2a2a' }}>{repo.root}</span>
        {repo.error && (
          <span style={{
            marginLeft: 'auto', fontSize: 11, color: '#ef4444',
            background: '#ef444415', padding: '1px 6px', borderRadius: 4,
          }}>
            {repo.error}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {repo.worktrees.length === 0 && !repo.error && (
          <div style={{ color: '#444', padding: '8px 0', fontSize: 12 }}>No worktrees found.</div>
        )}
        {repo.worktrees.map(wt => (
          <WorktreeRow
            key={wt.id}
            worktree={wt}
            focusingId={focusingId}
            onFocusStart={onFocusStart}
            onFocusDone={onFocusDone}
          />
        ))}
      </div>
    </div>
  );
}
