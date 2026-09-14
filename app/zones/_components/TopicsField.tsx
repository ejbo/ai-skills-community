'use client';

// 主题词 chip input (版块设置 → 基本信息, create wizard step 1). Enter / comma /
// 添加 adds, ✕ removes; the count and length caps come from lib/zones/shared.ts so
// the client refuses exactly what the PATCH route would 400 on. Ink chrome only —
// topics are metadata, never coloured (配色契约).

import { useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { MAX_ZONE_TOPICS, ZONE_TOPIC_MAX, sanitizeZoneTopics } from '@/lib/zones/shared';
import { pushToast } from '@/components/Toaster';
import { BTN_SECONDARY, HINT_CLS, INPUT_CLS, LABEL_CLS } from './ui';

export function TopicsField({
  value,
  onChange,
  disabled = false,
  idPrefix = 'zone-topics',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const t = useTranslations('zones');
  const [draft, setDraft] = useState('');
  const full = value.length >= MAX_ZONE_TOPICS;

  function add() {
    const pieces = draft.split(/[,，]/);
    const next = sanitizeZoneTopics([...value, ...pieces]);
    if (next.length === value.length && pieces.some((p) => p.trim())) {
      // Nothing was added: either a duplicate or the cap — say which.
      if (full) pushToast('error', t('topics_limit', { max: MAX_ZONE_TOPICS }));
      setDraft('');
      return;
    }
    onChange(next);
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div>
      <label className={LABEL_CLS} htmlFor={`${idPrefix}-input`}>
        {t('topics_label')}
        <span className="ml-2 font-mono text-[11px] font-normal tabular-nums text-zinc-400">
          {value.length}/{MAX_ZONE_TOPICS}
        </span>
      </label>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t('topics_label')}>
          {value.map((topic) => (
            <li
              key={topic}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-300 py-0.5 pl-2.5 pr-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              {topic}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((v) => v !== topic))}
                aria-label={t('topics_remove', { topic })}
                className="rounded-full p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={`${idPrefix}-input`}
          value={draft}
          disabled={disabled || full}
          maxLength={ZONE_TOPIC_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add()}
          placeholder={full ? t('topics_limit', { max: MAX_ZONE_TOPICS }) : t('topics_placeholder')}
          autoComplete="off"
          className={INPUT_CLS}
        />
        <button type="button" onClick={add} disabled={disabled || full || !draft.trim()} className={BTN_SECONDARY}>
          <Plus className="h-4 w-4" />
          {t('topics_add')}
        </button>
      </div>
      <p className={HINT_CLS}>{t('topics_hint', { max: MAX_ZONE_TOPICS, len: ZONE_TOPIC_MAX })}</p>
    </div>
  );
}
