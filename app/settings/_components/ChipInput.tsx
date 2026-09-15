'use client';

// 兴趣标签 chip input. Enter / comma (either width) / 顿号 commits; pasting
// "RAG, Agent、评测" commits all three; Backspace on an empty input removes the
// last chip; × removes one. Every add goes through `addInterests` →
// `sanitizeInterests`, the server's own rule, so what the chips show is exactly
// what gets stored. A duplicate flashes the chip it collided with instead of
// silently swallowing the text.
//
// A FULL list keeps the input enabled: disabling the focused input the moment
// the last allowed tag is committed dropped keyboard focus to <body> and took
// Backspace-to-remove with it. Typing past the cap is refused by addInterests
// and answered with the pf_interests_full notice instead.

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Hash, X } from 'lucide-react';
import { addInterests } from './editor-shared';
import { COUNTER_CLS, HINT_CLS, LABEL_CLS } from './ui';

export function ChipInput({
  value,
  onChange,
  max,
  label,
  placeholder,
  hint,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  label: string;
  placeholder: string;
  hint?: string;
}) {
  const t = useTranslations('settings');
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const full = value.length >= max;

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 700);
    return () => window.clearTimeout(timer);
  }, [flash]);

  /** Commit typed text; false when the list was full and NOTHING was added (the text stays for after a removal). */
  function commit(raw: string): boolean {
    const r = addInterests(value, raw);
    const added = r.next.length !== value.length;
    if (added) onChange(r.next);
    if (r.duplicate) setFlash(r.duplicate.toLowerCase());
    setNotice(r.full ? t('pf_interests_full', { max }) : null);
    return added || !r.full;
  }

  function remove(tag: string) {
    onChange(value.filter((v) => v !== tag));
    setNotice(null);
    inputRef.current?.focus();
  }

  return (
    <div>
      <label htmlFor={id} className={LABEL_CLS}>
        <span>{label}</span>
        <span className={COUNTER_CLS}>
          {value.length}/{max}
        </span>
      </label>
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-[2.75rem] cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 transition focus-within:border-zinc-900 focus-within:ring-2 focus-within:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-within:border-zinc-300 dark:focus-within:ring-zinc-100/10"
      >
        {value.map((tag) => (
          <span
            key={tag}
            className={`inline-flex max-w-full items-center gap-0.5 rounded-full border py-0.5 pl-2 pr-0.5 text-xs font-medium transition-colors duration-200 ${
              flash === tag.toLowerCase()
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
            }`}
          >
            <Hash className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
            <span className="truncate">{tag}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(tag);
              }}
              aria-label={t('pf_interest_remove', { tag })}
              className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          ref={inputRef}
          value={text}
          placeholder={full ? t('pf_interests_full', { max }) : value.length === 0 ? placeholder : t('pf_interests_more')}
          onChange={(e) => {
            const v = e.target.value;
            // A separator typed or pasted mid-string commits everything before it.
            if (/[,，、;；\n]/.test(v)) {
              setText(commit(v) ? '' : v);
              return;
            }
            setText(v);
            if (notice) setNotice(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.nativeEvent.isComposing) return; // IME candidate confirm, not a commit
              e.preventDefault();
              if (text.trim() && commit(text)) setText('');
            } else if (e.key === 'Backspace' && !text && value.length > 0) {
              e.preventDefault();
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (text.trim() && commit(text)) setText('');
          }}
          className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
        />
      </div>
      <p className={HINT_CLS} aria-live="polite">
        {notice ?? hint}
      </p>
    </div>
  );
}
