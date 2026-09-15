'use client';

// 外链 rows: label + URL, reorder with ↑/↓, remove, add up to `max`.
// Validation is the server's own `sanitizeProfileLink` (via linkRowState) and
// is shown only once a row has been touched — an error on a row the member is
// still typing into reads as nagging. The host blocks the save while any row is
// invalid (linksForSave → invalidIds) and passes `showAllErrors` so every bad
// row lights up at once.
//
// Keyboard focus survives every row action: ↑/↓ are MoveButtons, 添加链接 at the
// cap is aria-disabled rather than disabled, and removing a row hands focus to
// 添加链接 instead of letting it fall to <body>.

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Globe, Plus, Trash2 } from 'lucide-react';
import { LINK_LABEL_MAX, LINK_URL_MAX, linkHostname, sliceCodePoints } from '@/lib/profile/shared';
import { linkRowState, moveItem, type LinkRow } from './editor-shared';
import { MoveButton, refocusIfLost } from './MoveButton';
import { BTN_ICON, BTN_SECONDARY, COUNTER_CLS, INPUT_CLS, INPUT_INVALID_CLS } from './ui';

let rowSeq = 0;
/** Client-only row id (React key + error targeting); never persisted. */
export function newLinkRowId(): string {
  rowSeq += 1;
  return `link-${Date.now().toString(36)}-${rowSeq}`;
}

export function LinksEditor({
  rows,
  onChange,
  max,
  showAllErrors = false,
}: {
  rows: LinkRow[];
  onChange: (next: LinkRow[]) => void;
  max: number;
  showAllErrors?: boolean;
}) {
  const t = useTranslations('settings');
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const addRef = useRef<HTMLButtonElement>(null);
  const full = rows.length >= max;

  function patch(id: string, p: Partial<Pick<LinkRow, 'label' | 'url'>>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  function touch(id: string) {
    setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  return (
    <div>
      {rows.length > 0 && (
        <ol className="space-y-2">
          {rows.map((row, i) => {
            const state = linkRowState(row);
            const showError = state === 'invalid' && (showAllErrors || touched.has(row.id));
            const host = state === 'valid' ? linkHostname(row.url.trim()) : '';
            const errId = `${row.id}-err`;
            return (
              <li
                key={row.id}
                className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-900/40"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2 sm:w-44 sm:shrink-0">
                    <span
                      aria-hidden
                      className={`flex h-10 w-8 shrink-0 items-center justify-center ${
                        state === 'valid' ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-300 dark:text-zinc-600'
                      }`}
                    >
                      <Globe className="h-4 w-4" />
                    </span>
                    <input
                      value={row.label}
                      onChange={(e) => patch(row.id, { label: sliceCodePoints(e.target.value, LINK_LABEL_MAX) })}
                      placeholder={host || t('pf_link_label_placeholder')}
                      aria-label={t('pf_link_label')}
                      className={INPUT_CLS}
                    />
                  </div>
                  <input
                    value={row.url}
                    inputMode="url"
                    type="url"
                    spellCheck={false}
                    autoCapitalize="off"
                    onChange={(e) => patch(row.id, { url: e.target.value.slice(0, LINK_URL_MAX) })}
                    onBlur={() => touch(row.id)}
                    placeholder="https://"
                    aria-label={t('pf_link_url')}
                    aria-invalid={showError || undefined}
                    aria-describedby={showError ? errId : undefined}
                    className={`${INPUT_CLS} min-w-0 font-mono text-[13px] sm:flex-1 ${showError ? INPUT_INVALID_CLS : ''}`}
                  />
                  <div className="flex shrink-0 items-center justify-end gap-0.5">
                    <MoveButton atEnd={i === 0} onMove={() => onChange(moveItem(rows, i, i - 1))} label={t('pf_move_up')}>
                      <ArrowUp className="h-4 w-4" />
                    </MoveButton>
                    <MoveButton
                      atEnd={i === rows.length - 1}
                      onMove={() => onChange(moveItem(rows, i, i + 1))}
                      label={t('pf_move_down')}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </MoveButton>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(rows.filter((r) => r.id !== row.id));
                        refocusIfLost(addRef.current);
                      }}
                      aria-label={t('pf_link_remove')}
                      className={`${BTN_ICON} hover:!text-danger`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {showError && (
                  <p id={errId} className="mt-1.5 pl-10 text-xs text-danger">
                    {t('pf_link_invalid')}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className={`flex flex-wrap items-center gap-3 ${rows.length > 0 ? 'mt-3' : ''}`}>
        <button
          ref={addRef}
          type="button"
          onClick={() => {
            if (!full) onChange([...rows, { id: newLinkRowId(), label: '', url: '' }]);
          }}
          aria-disabled={full || undefined}
          className={`${BTN_SECONDARY} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
        >
          <Plus className="h-4 w-4" />
          {t('pf_link_add')}
          <span className={COUNTER_CLS}>
            {rows.length}/{max}
          </span>
        </button>
        {rows.length === 0 && <span className="text-xs text-muted">{t('pf_links_empty')}</span>}
      </div>
    </div>
  );
}
