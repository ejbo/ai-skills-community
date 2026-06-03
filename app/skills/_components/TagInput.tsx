'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

/** Chip-style multi-value input used for tags and triggers. */
export function TagInput({
  value,
  onChange,
  placeholder,
  mono = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    const parts = raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft('');
  }

  return (
    <div className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-lg border border-zinc-300 bg-[rgb(var(--surface))] px-2 py-1.5 transition focus-within:border-accent-500 focus-within:shadow-[0_0_0_3px_rgb(var(--accent)/0.15)] dark:border-zinc-700">
      {value.map((tag) => (
        <span
          key={tag}
          className={`inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800 ${mono ? 'font-mono' : ''}`}
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="text-muted transition hover:text-danger"
            aria-label={`移除 ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? placeholder : ''}
        className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
      />
    </div>
  );
}
