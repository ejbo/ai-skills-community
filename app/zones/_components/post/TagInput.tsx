'use client';

// Chip-style tag input: Enter / comma / blur adds, Backspace on an empty
// field removes the last chip; the list is normalized by `normalizeTags`
// (trim, collapse spaces, ≤24 chars, case-insensitive dedupe, ≤8).

import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Tag, X } from 'lucide-react';
import { MAX_ZONE_POST_TAGS, normalizeTags } from '@/lib/zones/shared';

export function TagInput({
  value,
  onChange,
  disabled = false,
  placeholder,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const t = useTranslations('zones');
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const full = value.length >= MAX_ZONE_POST_TAGS;

  function commit() {
    const raw = draft.trim();
    if (!raw) return;
    const next = normalizeTags([...value, ...raw.split(/[,，]/)]);
    onChange(next);
    setDraft('');
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={`flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm transition focus-within:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-500 ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <Tag className="h-3.5 w-3.5 shrink-0 text-muted" />
      {value.map((tag) => (
        <span key={tag.toLowerCase()} className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-px text-xs dark:border-zinc-700">
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((x) => x !== tag));
              }}
              aria-label={t('composer_tag_remove', { tag })}
              className="rounded-full text-muted transition hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        disabled={disabled || full}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        maxLength={24}
        placeholder={full ? t('composer_tags_full', { max: MAX_ZONE_POST_TAGS }) : placeholder ?? t('composer_tags_placeholder')}
        className="min-w-[8rem] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted disabled:cursor-not-allowed"
      />
      <span className="ml-auto font-mono text-[11px] tabular-nums text-muted">
        {value.length}/{MAX_ZONE_POST_TAGS}
      </span>
    </div>
  );
}
