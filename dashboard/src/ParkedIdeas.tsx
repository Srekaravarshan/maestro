import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface QueueItem { id: string; text: string; ts: number; cwd?: string | null; }

const stop = (e: ReactMouseEvent) => e.stopPropagation();

/**
 * Inline "park an idea" panel for a single worktree. Ideas are stored globally
 * (Rust prompt-queue.json) but tagged with this worktree's cwd, so each row
 * shows only its own parked ideas.
 */
export function ParkedIdeas({ cwd, items, onChange, compact }: {
  cwd: string;
  items: QueueItem[];            // already filtered to this cwd by the caller
  onChange: (all: QueueItem[]) => void;
  compact?: boolean;
}) {
  const [input, setInput]       = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fs = compact ? 10.5 : 11;

  const add = () => {
    const text = input.trim();
    if (!text) return;
    invoke<QueueItem[]>('add_to_queue', { text, cwd }).then(onChange).catch(() => {});
    setInput('');
  };
  const remove = (id: string) =>
    invoke<QueueItem[]>('remove_from_queue', { id }).then(onChange).catch(() => {});
  const copy = (it: QueueItem) =>
    navigator.clipboard.writeText(it.text).then(() => {
      setCopiedId(it.id); setTimeout(() => setCopiedId(null), 1200);
    }).catch(() => {});

  return (
    <div onClick={stop} style={{ padding: '5px 12px 8px 30px', background: '#141414', borderBottom: '1px solid #161616' }}>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); add(); } }}
        onClick={stop}
        placeholder="Park an idea… (↵)"
        style={{ width: '100%', boxSizing: 'border-box', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, color: '#ccc', fontSize: fs, padding: '3px 7px', outline: 'none' }}
      />
      {items.map(it => (
        <div key={it.id} onClick={stop} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
          <span onClick={() => copy(it)} title="Copy" style={{ cursor: 'pointer', color: copiedId === it.id ? '#22c55e' : '#555', fontSize: fs }}>
            {copiedId === it.id ? '✓' : '⊙'}
          </span>
          <span onClick={() => copy(it)} style={{ flex: 1, fontSize: fs, color: '#aaa', lineHeight: 1.4, cursor: 'pointer', wordBreak: 'break-word' }}>
            {it.text}
          </span>
          <span onClick={() => remove(it.id)} title="Remove" style={{ cursor: 'pointer', color: '#3a3a3a', fontSize: fs + 2, lineHeight: 1 }}>×</span>
        </div>
      ))}
    </div>
  );
}
